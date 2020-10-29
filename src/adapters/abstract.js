'use strict';

const AdapterFactory = require('./factory');
const Redis = require('redis');
const kue = require('kue');
const queue = kue.createQueue();

class AbstractAdapter {

  validateConfig(config) {
    if (!config['db']['url'])
      throw Error('db.url must be set up in config');
  }

  constructor(app_config) {
    this.config = app_config;

    let factory = new AdapterFactory(app_config);
    this.db = factory.getAdapter('nosql', app_config.db.driver);

    if (global.cache == null) {
      this.cache = Redis.createClient(this.config.redis); // redis client
      this.cache.on('error', (err) => { // workaround for https://github.com/NodeRedis/node_redis/issues/713
        this.cache = Redis.createClient(this.config.redis); // redis client
      });
      // redis auth if provided
      if (this.config.redis.auth) {
        this.cache.auth(this.config.redis.auth);
      }
      global.cache = this.cache;
    } else this.cache = global.cache;

    this.update_document = true; // should we update database with new data from API? @see productcategory where this is disabled

    this.total_count = 0;
    this.page_count = 0;
    this.page_size = 50;
    this.page = 1;
    this.current_context = {};

    // Local
    this.index = 0;
    this.count = 0;

    this.use_paging = false;
    this.is_federated = false;
    this.is_running = false;

    this.validateConfig(this.config);

    this.tasks_count = 0;
  }

  isValidFor(entity_type) {
    throw Error('isValidFor must be implemented in specific class');
  }

  getCurrentContext() {
    return this.current_context;
  }

  /**
   * Default done callback called after all main items are processed by processItems
   */
  defaultDoneCallback() {
    return;
  }

  /**
   * Run products/categories/ ... import
   * @param {Object} context import context with parameter such "page", "size" and other search parameters
   */
  run(context) {
    this.current_context = context;

    if (!(this.current_context.transaction_key))
      this.current_context.transaction_key = new Date().getTime(); // the key used to filter out records NOT ADDED by this import

    this.db.connect(async () => {
      logger.info('Connected correctly to server');
      logger.info(`TRANSACTION KEY = ${this.current_context.transaction_key}`);

      this.onDone = this.current_context.done_callback ? (
        () => {
          this.defaultDoneCallback();
          this.current_context.done_callback();
        }
      ): this.defaultDoneCallback;

      try {
        await this.rerunUnstable();
      } catch (e) {
        logger.warn(`Running only unstable tasks! If you want to run full reindex. Clear elasticsearch index and redis queue`);
        process.exit(1);
      }

      let exitCallback = this.onDone;
      this.getSourceData(this.current_context)
        .then(this.processItems.bind(this))
        .catch((err) => {
          logger.error(err);
          exitCallback();
        });
    });
  }

  /**
   * Implement some item related operations - executed BEFORE saving to the database
   * @param {Object} item
   */
  preProcessItem(item) {
    return new Promise((done, reject) => { done(); });
  }

  /**
   * Remove records from database other than specific transaction_key
   * @param {int} transaction_key
   */
  cleanUp(transaction_key) {
    this.db.connect(() => {
      logger.info(`Cleaning up with tsk = ${transaction_key}`);
      this.db.cleanupByTransactionkey(this.getCollectionName(), transaction_key);
    });
  }

  prepareItems(items) {
    if(!items)
      return items;

    if (items.total_count)
      this.total_count = items.total_count;

    if (!Array.isArray(items))
      items = new Array(items);

    return items;
  }

  isFederated() {
    return this.is_federated;
  }

  processItems (items, level) {
    items = this.prepareItems(items);
    this.index = 0;
    let db = this.db;
    this.count = items.length;

    if (isNaN(level)) { level = 0; }
    if (!items) {
      logger.error('No items given to processItems call!');
      return;
    }
    if (this.count == 0) {
      logger.warn('No records to process!');
      return this.onDone(this);
    } else {
      this.tasks_count += this.count;
    }
    if (!db) { throw new Error('No db adapter connection established!'); }
    if (this.total_count) { logger.info(`Total count is: ${this.total_count}`); }

    items.forEach((item) => {
      this.appendItemToQueue(item);
      if (item.children_data && item.children_data.length > 0) {
        logger.info(`--L:${level} Processing child items ...`);
        this.processItems(item.children_data, level + 1);
      }
    });

    if (!this.is_running) {
      this.processBulk();
    }
  }

  /**
   * Appends jobs to the Redis queue - it is used for further processing
   * @param item Magento response object
   */
  appendItemToQueue (item) {
    const taskTransactionKey = this.getCurrentContext().transaction_key;
    queue.createJob('mage2-import-job', { ...item, title: item.name || item.id })
        .attempts(3)
        .backoff( { delay: 60 * 1000, type:'fixed' })
        .save((err) => {
          if (err) {
            logger.debug('Import job cannot be queued within redis. Terminating...');
          } else {
            logger.info(`Job ${item.id || taskTransactionKey} queued to further process`);
          }
        });
  }

  /**
   * Bulk processes queue elements
   */
  processBulk () {
    this.is_running = true;
    queue.process('mage2-import-job', Number(this.current_context.maxActiveJobs || 10), (job, done) => {
      const item = job.data;
      this.preProcessItem(item)
          .then((item) => {
            item.tsk = this.getCurrentContext().transaction_key;
            this.tasks_count--;
            logger.info(`Importing ${this.getLabel(item)}`);

            // Invalidate document in elasticsearch and update it once again
            if (this.update_document) {
              this.db.updateDocument(this.getCollectionName(), this.normalizeDocumentFormat(item), (err, res) => {
                if (err) {
                  logger.error(res.body ? res.body.error.reason : JSON.stringify(res));
                  process.exit(0);
                }
              });
            } else {
              logger.debug('Skipping database update');
            }

            this.index++;
            done();
          })
          .catch((reason) => {
            logger.error(reason);
            done(reason);
          });
    });

    queue.on('job complete', (jobId) => {
      queue.inactiveCount('mage2-import-job', (err, inactive) => {
        logger.info(`Completed: ${this.index}. Remaining: ${inactive}`);
        if (inactive === 0) {
          if (!this.use_paging) {
            logger.info('Completed!');
            this.db.close();
            this.onDone(this);
          } else {

            if (this.use_paging && !this.isFederated()) {
              if (this.page >= (this.page_count)) {
                logger.info('All pages processed!');
                this.rerunUnstable()
                    .then(() => {
                      this.db.close();
                      this.onDone(this);
                    });
              } else {
                // Increment page and rerun
                const context = this.getCurrentContext();
                if (context.page) {
                  context.page++;
                  this.page++;
                } else {
                  context.page = ++this.page;
                }

                logger.debug(`Switching page to ${this.page}`);
                let exitCallback = this.onDone;
                this.getSourceData(context)
                    .then(this.processItems.bind(this))
                    .catch((err) => {
                      logger.error(err);
                      exitCallback();
                    });
              }
            }
          }
        }
      });

      kue.Job.get(jobId, (err, job) => {
        if (err) return;
        job.remove((err) => {
          if (err) throw err;
        });
      });
    });
  }

}

module.exports = AbstractAdapter;
