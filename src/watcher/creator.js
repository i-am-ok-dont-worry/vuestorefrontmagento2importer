const { EntityType } = require('./entity');
const kue = require('kue');
const config = require('../config');
const queue = kue.createQueue(Object.assign(config.kue, { redis: config.redis }));
const JobManager = require('./job-manager');
const difference = require('lodash/difference');


const _createJobDataFunc = Symbol();
const _shouldAbort = Symbol();
class ReindexJobCreator {
    static Priority = {
        low: 10,
        normal: 0,
        medium: -5,
        high: -10,
        critical: -15
    };

    constructor () {
        this._jobManager = new JobManager();
    }

    async createReindexJob ({ entity, ids, priority = 'normal' }) {
        if (!entity || entity.length === 0) { throw new Error(`Invalid entity argument. Entity must be one of following: ${Object.values(EntityType).join(', ')}`); }
        if (!ids || !(ids instanceof Array) || ids.length === 0) { throw new Error(`Invalid ids argument. Argument must be an array`); }
        if (!Object.values(EntityType).includes(entity)) { throw new Error('Entity type not supported'); }
        if (priority && !Object.keys(ReindexJobCreator.Priority).includes(priority)) { throw new Error('Priority not supported'); }
        ids = ids.map(i => String(i));

        const allowedJobs = await this._jobManager.getUniqueJobs({ entity, ids });
        const shouldAbort = this[_shouldAbort](ids, allowedJobs);

        if (shouldAbort) { return Promise.resolve(); }
        await this._jobManager.enqueueReindexForEntity({ entity, ids });

        return this[_createJobDataFunc]({ entity, ids, priority, allowedJobs });
    };

    [_createJobDataFunc] ({ entity, ids, priority, allowedJobs }) {
        return new Promise(async (resolve, reject) => {
            const jobData = {
                title: `mage import`,
                data: {
                    entity
                }
            };

            const getUniqJobIds = () => {
                return new Promise((resolve, reject) => {
                    queue.inactive((err, ids) => {
                        if (!err) {
                            if (ids && ids instanceof Array && ids.length === 0) {
                                resolve(allowedJobs);
                            } else {
                                ids.forEach(( id ) => {
                                    kue.Job.get( id, (err, { data }) => {
                                        try {
                                            const { data: jobData } = data;
                                            const diff = difference(jobData.ids.map(String), allowedJobs.map(String));
                                            resolve(diff);
                                        } catch (e) {
                                            resolve(allowedJobs);
                                        }
                                    });
                                });
                            }
                        }
                    });
                });
            };

            jobData.data.ids = await getUniqJobIds();

            queue.create('i:mage-data', jobData).priority(ReindexJobCreator.Priority[priority] || ReindexJobCreator.Priority.normal)
                .removeOnComplete( true )
                .attempts(2)
                .backoff( { delay: 20*1000, type:'fixed' } )
                .save(async (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
        });
    };

    /**
     * Returns true if job can be created
     * @param ids
     * @param allowedIds
     */
    [_shouldAbort] (ids, allowedIds) {
        if (ids && ids instanceof Array && ids.length > 0) {
            if (allowedIds.length > 0) {
                return false;
            }
        }

        return true;
    }
}

module.exports = ReindexJobCreator;


