const { EntityType } = require('./entity');
const config = require('../config');
const Redis = require('redis');
const client = Redis.createClient({ ...config.redis });
const difference = require('lodash/difference');
const isEmpty = require('lodash/isEmpty');
const kue = require('kue');
const TagCache = require('redis-tag-cache').default;
const cache = new TagCache({
    redis: config.redis,
    defaultTimeout: 86400
});

class JobManager {

    /**
     * Returns ids of entities for which reindexer should be run
     * Jobs that are running for the same objects will not be added
     * to the queue
     * @param entity
     * @param ids
     * @returns {Promise<unknown>}
     */
    getUniqueJobs ({ entity, ids }) {
        return new Promise((resolve, reject) => {
            client.hgetall(`i:${entity}:status`, (err, data) => {
                if (err) { reject(new Error(`Cannot create job: ` + err)); }
                else if (data && ids && ids.length > 0 && !isEmpty(data)) {
                    resolve(difference(Object.keys(data), ids));
                } else if (ids && ids.length > 0) {
                    resolve(ids);
                } else {
                    resolve(['full']);
                }
            });
        });
    }

    /**
     * Saves metadata info about import job
     * @param entity
     * @param ids
     * @param jobId
     * @returns {Promise<unknown>}
     */
    saveJob ({ entity, ids, jobId }) {
        return new Promise((resolve, reject) => {
            if (!ids || !(ids instanceof Array)) {
                client.hmset(`i:${entity}:status`, 'full', jobId, (err) => {
                    if (err) { reject(); }
                    else {
                        resolve({ 'full': jobId });
                    }
                });
                return;
            }

            ids.forEach((id, index) => {
                client.hmset(`i:${entity}:status`, id, jobId, (err) => {
                    if (err) { reject(); }
                    else {
                        resolve({ [id]: jobId });
                    }
                });
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
        console.log('Clearing job metadata: ', entity, ids);
        const invalidateCache = async () => {
            for (let id of ids) {
                try {
                     const prefix = entity.indexOf(0).toUpperCase();
                     await cache.invalidate(`${prefix}${id}`);
                     console.log('Invalidated cache tag: ', `${prefix}${id}`);
                } catch (e) {}
            }
        };

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

            await invalidateCache();

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
