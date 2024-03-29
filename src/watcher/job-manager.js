const { EntityType } = require('./entity');
const config = require('config');
const Redis = require('redis');
const client = Redis.createClient({ ...config.redis });
const difference = require('lodash/difference');
const take = require('lodash/take');
const isEmpty = require('lodash/isEmpty');
const kue = require('kue');
const MultistoreUtils = require('../helpers/multistore-utils');

class JobManager {

    /**
     * Returns ids of entities for which reindexer should be run
     * Jobs that are running for the same objects will not be added
     * to the queue.
     * @param entity
     * @param ids
     * @returns {Promise<unknown>}
     */
    getUniqueJobs ({ entity, ids, storeCode = '' }) {
        return new Promise((resolve, reject) => {
            client.smembers(`i:${entity}:queue`, (err, data) => {
                if (err) {
                    reject(new Error(`Cannot create job: ` + err));
                } else if (data && ids && ids.length > 0 && !isEmpty(data)) {
                    data = data
                        .filter(id => id.split(':')[1] === storeCode)
                        .map(id => id.split(':')[0]);

                    let diff = data.length ? difference(data, ids) : ids;
                    diff = diff.map(id => storeCode ? `${id}:${storeCode}` : id);

                    resolve(diff);
                } else if (ids && ids.length > 0) {
                    resolve(ids);
                } else {
                    resolve(['full']);
                }
            });
        });
    }

    /**
     * Appends ids to `i:{{entity}}:queue` redis set.
     * This set contains a collection of ids for entities that are scheduled for reindex.
     * @param entity
     * @param ids
     * @returns {Promise<*>}
     */
    async enqueueReindexForEntity ({ entity, ids, storeCode = '' }) {
        const saddToPromise = (id) => new Promise((resolve, reject) => {
            const data = storeCode ? `${id}:${storeCode}` : id;
            client.sadd(`i:${entity}:queue`, data, (err) => {
                if (err) reject();
                else resolve();
            });
        });

        return new Promise(async (resolve, reject) => {
            for (let id of ids) {
                try { await saddToPromise(id); } catch (e) {
                    console.warn('Error while adding promise: ', e);
                    reject(e);
                }
            }

            resolve();
        });
    }

    async clearReindexQueueForEntity ({ entity, ids }) {
        if (!entity || !ids || ids.length === 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            client.srem(`i:${entity}:queue`, ...ids, (err) => {
                if (err) reject();
                else resolve();
            });
        });
    }

    async getQueuedIdsForEntity({ entity, storeCode }) {
        const isDefaultStore = MultistoreUtils.isDefaultStoreView(storeCode);
        const defaultStoreCode = MultistoreUtils.getDefaultStoreCode();
        return new Promise((resolve, reject) => {
            client.smembers(`i:${entity}:queue`, (err, members) => {
                if (err) reject();
                else {
                    const queuedIds = take(members, 50)
                        .filter(id => {
                            const idStoreCode = id.split(':')[1];
                            if (!storeCode && defaultStoreCode === idStoreCode) return true;
                            if (!idStoreCode && isDefaultStore) return true;
                            if (idStoreCode === storeCode) return true;
                            return false;
                        });

                    resolve(queuedIds);
                }
            });
        });
    }

    /**
     * Clears redis cache for reindexed entity
     * @returns {Promise<void>}
     */
    clearCache (prefix) {
        return new Promise((resolve, reject) => {
            client.keys(`tags:${prefix}*`, async (err, keys) => {
                const deletePromise = (key) => new Promise((resolve, reject) => {
                    client.del(key, (err) => {
                       if (err) { resolve(); }
                       else { resolve(); }
                    });
                });
                const membersPromise = (tag) => new Promise((resolve, reject) => {
                    client.smembers(`tags:${tag}`, async (err, data) => {
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
                    client.keys('data:catalog:*', async (err, catKeys) => {
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
                console.log(`Cache cleared for prefix: `, prefix);
                resolve();
            });
        });
    }

    /**
     * Clears status metadata
     * @param entity
     * @param ids
     * @returns {Promise<unknown>}
     */
    clearJobMetadata ({ entity, ids }) {
        return new Promise(async (resolve, reject) => {
            let index = 0;
            const deleteEntityStatusToPromise = (id) => new Promise((res, rej) => {
                client.hdel (`i:${entity}:status`, id, (err) => {
                    if (err) { rej(new Error(`Cannot delete entry: ${id}`)); }
                    else {
                        console.log('Cleared entity status for: ', entity, ids);
                        res();
                    }
                });
            });

            if (!ids) { ids = ['full']; }

            client.hgetall(`i:${entity}:status`, async (err, data) => {
                if (err) {
                    console.log('Cannot get status for entity: ', entity);
                    resolve();
                    return;
                }

                if (!data) {
                    console.log('Cannot get data for task: ', entity);
                    resolve();
                    return;
                }

                for (let id of ids) {
                    try {
                        const job = data[id];
                        if (job) {
                            await deleteEntityStatusToPromise(id);
                        }
                    } catch (e) {
                        console.error(e.message);
                    }

                    index++;
                    if (index === ids.length - 1) { resolve(); }
                }

                resolve();
            });
        });
    }

    /**
     * Resolves running status of entities
     * @param entity
     * @param ids
     * @returns {Promise<unknown>}
     */
    isRunning (entity, ids) {
        if (!entity) { throw new Error(`Entity is required to fetch kue state`); }
        if (!Object.values(EntityType).includes(entity)) { throw new Error('Entity type not supported'); }
        return new Promise((resolve, reject) => {
            client.hgetall(`i:${entity}:status`, (err, data) => {
                if (err || !data) {
                    reject(new Error(`No job enqueued for entity: ${entity}`));
                    return;
                }

                if (!ids || !(ids instanceof Array)) {
                    ids = ['full'];
                }

                let outputStatus = {};
                ids.forEach((id, index) => {
                   const jobId = data[id];
                   if (jobId) {
                       kue.Job.get(jobId, (err, job) => {
                           if (job) {
                               Object.assign(outputStatus, {[id]: job._state});
                           }

                           if (index === ids.length - 1) {
                               resolve(outputStatus);
                               return;
                           }
                       });
                   } else {
                       resolve({});
                   }
                });
            });
        })
            .then(result => {
                if (isEmpty(result)) {
                    throw new Error(`Not found enqueued jobs for objects: ${ids}`);
                }

                return result;
            });
    }

    clearAll () {
        return new Promise((resolve, reject) => {
            Object.values(EntityType).forEach((key, index) => {
                client.del(`i:${key}:status`, (err) => {
                   if (!err) { console.warn('Cleared'); }
                   if (index === Object.values(EntityType).length - 1) {
                       resolve();
                   }
                });
            });
        });
    }
}

module.exports = JobManager;
