const { EntityType } = require('./entity');
const kue = require('kue');
const config = require('../config');
const queue = kue.createQueue(Object.assign(config.kue, { redis: config.redis }));
const JobManager = require('./job-manager');
const difference = require('lodash/difference');
const MultiStoreUtils = require('../helpers/multistore-utils');


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

    async createReindexJob ({ entity, ids, storeCode, priority = 'normal' }) {
        if (!entity || entity.length === 0) { throw new Error(`Invalid entity argument. Entity must be one of following: ${Object.values(EntityType).join(', ')}`); }
        if (!ids || !(ids instanceof Array) || ids.length === 0) { throw new Error(`Invalid ids argument. Argument must be an array`); }
        if (!Object.values(EntityType).includes(entity)) { throw new Error('Entity type not supported'); }
        if (priority && !Object.keys(ReindexJobCreator.Priority).includes(priority)) { throw new Error('Priority not supported'); }
        ids = ids.map(i => String(i));

        const allowedJobs = await this._jobManager.getUniqueJobs({ entity, ids, storeCode });
        const shouldAbort = this[_shouldAbort](ids, allowedJobs);

        if (shouldAbort) { return Promise.resolve(); }
        await this._jobManager.enqueueReindexForEntity({ entity, ids, storeCode });

        return this[_createJobDataFunc]({ entity, storeCode, priority, allowedJobs });
    };

    /***
     * Creates a new reimport job. This will fetch all inactive pending tasks from que
     * and try to return a list of uniq non-duplicated objects ids.
     * IDS that were appended to queue processing earlier should not be processed again.
     * For this task `difference` lodash function is used. It compares list of ids that were
     * saved in que before with ids from current job.
     * @param entity - value of enum 'EntityType'
     * @param storeCode
     * @param priority
     * @param allowedJobs - list of ids that were compared against 'i:{{entity}}:queue' redis set
     * @returns {Promise<any>}
     */
    [_createJobDataFunc] ({ entity, storeCode, priority, allowedJobs }) {
        return new Promise(async (resolve, reject) => {
            const jobData = {
                title: `mage import`,
                data: {
                    entity
                }
            };

            /**
             * This function is a second step for job duplication check.
             * This method returns ids that are not present in queue.
             * @returns {Promise<any>}
             */
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
            jobData.data.storeCode = storeCode;
            const isDefaultStore = MultiStoreUtils.isDefaultStoreView(storeCode);

            queue.create(storeCode && !isDefaultStore ? `i:mage-data-${storeCode}` : 'i:mage-data', jobData).priority(ReindexJobCreator.Priority[priority] || ReindexJobCreator.Priority.normal)
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


