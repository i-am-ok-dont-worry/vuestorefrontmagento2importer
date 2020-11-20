const { EntityType } = require('./entity');
const kue = require('kue');
const queue = kue.createQueue();
const JobManager = require('./job-manager');


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

        const allowedJobs = await this._jobManager.getUniqueJobs({ entity, ids });
        const shouldAbort = this[_shouldAbort](ids, allowedJobs);

        if (shouldAbort) { return Promise.resolve(); }

        return this[_createJobDataFunc]({ entity, ids, priority, allowedJobs });
    };

    [_createJobDataFunc] ({ entity, ids, priority, allowedJobs }) {
        return new Promise((resolve, reject) => {
            const jobData = {
                title: `mage import`,
                data: {
                    entity,
                    ...(ids && ids.length && { ids })
                }
            };

            if (allowedJobs) { jobData.data.ids = allowedJobs }
            if (ids.includes('full')) { jobData.data.ids = []; }

            const job = queue.create('i:mage-data', jobData).priority(ReindexJobCreator.Priority[priority] || ReindexJobCreator.Priority.normal)
                .removeOnComplete( true )
                .attempts(2)
                .backoff( { delay: 20*1000, type:'fixed' } )
                .save(async (err) => {
                    if (err) { reject(err); }
                    else {
                        await this._jobManager.saveJob({ entity, ids, jobId: job.id });
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


