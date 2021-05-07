process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
const AdapterFactory = require('./factory');
const config = require('config');
const Redis = require('redis');
const logger = require('../log');

class MagentoImporter {

    constructor (options = {}) {
        this.options = Object.assign({
            page: 1,
            page_size: 500,
            page_count: 1,
            use_paging: false
        }, options);
        this.pending = [];
        this.done_count = 0;
        this.total_count = 0;
        this.start_time = Date.now();

        let factory = new AdapterFactory(config);
        this.db = factory.getAdapter('nosql', 'elasticsearch');
        this.db.connect(async () => {
            this.options.db = this.db;
        });

        this.cache = Redis.createClient(config.redis);
        this.adapter = this.getAdapter(options.adapter);
    }

    getAdapter (adapterName) {
        try {
            const factory = new AdapterFactory(config);
            const adapterInstance = factory.getAdapter('magento', adapterName);

            adapterInstance.db = this.db;
            adapterInstance.cache = this.cache;

            return adapterInstance;
        } catch (e) {
            logger.error(`Cannot run importer. Unknown adapter '${adapterName}'`, e);
            return null;
        }
    }

    async run (callback = () => {}) {
        this.callback = callback;

        if (!this.options.use_paging) {
            const data = await this.adapter.getSourceData(this.options);
            const items = this.adapter.prepareItems(data);
            this.total_count = items.length;

            for (let job of items) {
                this.pending.push(job);
            }

            await this.start();
        } else {
            const data = await this.adapter.getSourceData(this.options);
            this.total_count = data.total_count;

            const isDone = Math.ceil(this.total_count / this.options.page_size) === this.options.page;
            const items = this.adapter.prepareItems(data);

            for (let job of items) {
                this.pending.push(job);
            }

            await this.startPaged();

            if (isDone) {
                this.done();
            } else {
                logger.info(`Switching to page ${this.options.page}`);
                this.run(callback);
            }
        }
    }

    async start () {
        try {
            while (this.pending.length > 0) {
                await this.processSingle(this.pending.pop());
            }

            this.done();
        } catch (e) {
            logger.error('Cannot process jobs: ', e);
        }
    }

    async startPaged () {
        return new Promise(async (resolve) => {
            try {
                while (this.pending.length > 0) {
                    await this.processSingle(this.pending.pop());
                }

                this.options.page = (this.options.page || 0) + 1;

                resolve();
            } catch (e) {
                logger.error('Cannot process jobs: ', e);
            }
        })
    }

    async done () {
        const finishedIn = (Date.now() - this.start_time) / 1000;
        await this.clearCache(this.options.adapter.charAt(0));
        await this.clearCache(this.options.adapter.charAt(0).toUpperCase());
        logger.info(`Done. ${this.done_count} jobs in ${finishedIn}s.`);

        this.callback();
    }

    async processSingle (item) {
        try {
            const result = await this.adapter.preProcessItem(item);
            await this.updateDocument(result);

            return result;
        } catch (e) {
            logger.warn(`Cannot process job ${item.id}. Error: `, e);
            this.pending.push(item);
            return null;
        }
    }

    async updateDocument (item) {
        return new Promise((resolve, reject) => {

            // Invalidate document in elasticsearch and update it once again
            this.db.updateDocument(this.adapter.getCollectionName(true), this.adapter.normalizeDocumentFormat(item), this.shouldOverwrite(), async (err, res) => {
                if (err) {
                    logger.error(res.body ? res.body.error.reason : JSON.stringify(res));
                    return resolve();
                }

                this.done_count += 1;
                logger.info(`Completed: ${this.done_count} ${this.adapter.getLabel(item)}. Pending: ${this.pending.length}`);

                resolve();
            });
        });
    }

    shouldOverwrite () {
        if (/stock/.test(this.adapter.getEntityType())) return false;
        if (/category/.test(this.adapter.getEntityType())) return false;

        return true;
    }

    /**
     * Clears redis cache for reindexed entity
     * @returns {Promise<void>}
     */
    clearCache (prefix) {
        return new Promise((resolve, reject) => {
            this.cache.keys(`tags:${prefix}*`, async (err, keys) => {
                const deletePromise = (key) => new Promise((resolve, reject) => {
                    this.cache.del(key, (err) => {
                        if (err) { resolve(); }
                        else { resolve(); }
                    });
                });
                const membersPromise = (tag) => new Promise((resolve, reject) => {
                    this.cache.smembers(`tags:${tag}`, async (err, data) => {
                        if (data) {
                            if (data instanceof Array) {
                                for (const d of data) {
                                    await deletePromise(d);
                                }
                            } else {
                                await deletePromise(data);
                            }
                        }

                        resolve();
                    });
                });

                const catalogToPromise = () => new Promise((resolve, reject) => {
                    this.cache.keys('data:catalog:*', async (err, catKeys) => {
                        if (catKeys && catKeys instanceof Array) {
                            for (const ckey of catKeys) {
                                try {
                                    await deletePromise(ckey);
                                } catch (e) {}
                            }
                        }
                        resolve();
                    });
                });

                if (keys && keys instanceof Array) {
                    for (const key of keys) {
                        try {
                            const tag = key.split(':')[1];
                            await membersPromise(tag);
                            await deletePromise(key);
                        } catch (e) {}
                    }
                }

                await catalogToPromise();
                resolve();
            });
        });
    }
}

module.exports = MagentoImporter;
