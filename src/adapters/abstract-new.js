const AdapterFactory = require('./factory');
const Redis = require('redis');
const kue = require('kue');
const config = require('../config');
const queue = kue.createQueue(Object.assign(config.kue, { redis: config.redis }));


class AbstractAdapterNew {

    constructor(config) {
        this.config = config;

        let factory = new AdapterFactory(config);
        this.db = factory.getAdapter('nosql', config.db.driver);
        this.total_count = 0;
        this.page_count = 0;
        this.page_size = 500;
        this.tasks_count = 0;
        this.page = 1;
        this.index = 0;
        this.use_pagination = true;
        this.is_done = false;
        this.audit_counter = 0;
        this.audit_counter_prev = -1;
        this.current_context = {};

        this.cache = Redis.createClient(this.config.redis);
        global.cache = this.cache;

        this.validateConfig(this.config);
        this.assertCanRun();
    }

    assertCanRun() {
        try {
            if (!this.db) {
                throw new Error('No db adapter connection established!');
            }
        } catch (e) {
            logger.error('Cannot run: ', e.message);
            this.done();
        }
    }

    validateConfig(config) {
        if (!config['db']['url']) {
            logger.warn(`db.url must be set up in config`);
            process.exit(1);
        }
    }

    run(context) {
        this.current_context = context;
        this.db.connect(async () => {
            this.current_context.db = this.db;
        });

        this.probeProcess();
        this.getSourceData(this.current_context)
            .then(this.processItems.bind(this))
            .catch((err) => {
                logger.error(err);
                this.done();
            });
    }

    probeProcess () {
        this.probe = setInterval(() => {
            if (this.audit_counter === this.audit_counter_prev) {
                logger.warn(`Process inactive for 120s. Killing...`);
                process.exit(1);
            } else {
                this.audit_counter_prev = this.audit_counter_prev + 1;
            }
        }, 120000);
    }

    markProcessActive() {
        this.audit_counter = this.audit_counter + 1;
    }

    prepareItems(items) {
        if (!items || !Array.isArray(items))
            items = new Array(items);

        return items;
    }

    getCurrentContext() {
        return this.current_context;
    }

    preProcessItem(item) {
        return new Promise((done, reject) => { done(); });
    }

    async processItems (items, level) {
        items = this.prepareItems(items);

        this.is_done = this.use_paging ? items.length < this.page_size : true;
        this.page_count = Math.ceil(this.total_count / this.page_size);
        this.tasks_count += items.length;

        if (isNaN(level)) { level = 0; }

        if (this.total_count === 0) {
            logger.info('No records to process');
            this.done();

        }

        for (let item of (items || [])) {
            await this.appendItemToQueue(item);
        }

        if (this.is_done) {
            this.processBulk();
        } else {

            // Increment page and rerun
            const context = this.getCurrentContext();
            if (context.page) {
                context.page++;
                this.page++;
            } else {
                context.page = ++this.page;
            }

            const result = await this.getSourceData(context);

            await this.processItems(result, level);
        }
    }

    canProcess(itemId) {
        if (!this.current_context.ids || !this.current_context.ids instanceof Array) {
            return Promise.resolve(true);
        }

        const getJob = (id) => new Promise((resolve, reject) => {
            kue.Job.get( id, ( err, job ) => {
                resolve(job);
            });
        });

        return new Promise((resolve, reject) => {
            queue.inactive(async( err, ids ) => {
                for (let id of ids) {
                    const job = await getJob(id);
                    if (job.type === `mage2-import-job-${this.getCollectionName(true)}` && String(job.data.id) === String(itemId)) {
                        resolve(false);
                        return;
                    }
                }

                resolve(true);
            });
        });
    }

    /**
     * Appends jobs to the Redis queue - it is used for further processing
     * @param item Magento response object
     */
    async appendItemToQueue (item) {
        const canProcess = await this.canProcess(item.id);
        if (!canProcess) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            queue.createJob(`mage2-import-job-${this.getCollectionName(true)}`, {...item, title: item.name || item.id})
                .attempts(3)
                .backoff({delay: 60 * 1000, type: 'fixed'})
                .removeOnComplete(true)
                .save((err) => {
                    if (err) {
                        logger.info('Import job cannot be queued within redis. Terminating...');
                    } else {
                        logger.info(`Job ${item.id} queued to further process`);
                    }

                    resolve(item.id);
                });
        });
    }

    done() {
        try {
            logger.info('Done');
            clearInterval(this.probe);
        } catch (e) {}

        process.exit(0);
    }


    /**
     * Bulk processes queue elements
     */
    processBulk () {
        queue.process(`mage2-import-job-${this.getCollectionName(true)}`, Number(this.current_context.maxActiveJobs || 10), (job, done) => {
            const item = job.data;

            this.preProcessItem(item)
                .then((item) => {
                    logger.info(`Importing ${this.getLabel(item)}`);
                    this.markProcessActive();

                    // Invalidate document in elasticsearch and update it once again
                    this.db.updateDocument(this.getCollectionName(true), this.normalizeDocumentFormat(item), !/stock/.test(this.getEntityType()), (err, res) => {
                        if (err) {
                            logger.error(res.body ? res.body.error.reason : JSON.stringify(res));
                            done(err);
                        } else {
                            this.tasks_count--;
                            this.index = this.index + 1;
                            logger.info(`Completed: ${this.index}. Remaining: ${this.tasks_count}`);
                            done();
                        }
                    });
                })
                .catch((reason) => {
                    logger.error(reason);
                    done(reason);
                });
        });

        queue.on('job complete', (jobId) => {
            queue.inactiveCount(`mage2-import-job-${this.getCollectionName(true)}`, (err, inactive) => {
                if (this.tasks_count === 0) {
                    this.done();
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

module.exports = AbstractAdapterNew;
