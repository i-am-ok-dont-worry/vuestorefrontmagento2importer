const Redis = require('redis');

class ReindexUtils {
    static createReindexKey (entityType) {
        return `i:${entityType}`;
    }

    static JobStatus = {
        NIL: 'nil',
        SCHEDULED: 'scheduled',
        PENDING: 'pending',
        DONE: 'done'
    };

    constructor (app_config) {
        this._redisClient = Redis.createClient(app_config.redis);
    }

    /**
     * Returns job status data about entity reindex
     * @param {string} entity
     * @returns {Promise<JobData>}
     */
    getReindexStatus (entity) {
        return new Promise((resolve, reject) => {
            this._redisClient.hgetall(ReindexUtils.createReindexKey(entity), (err, job) => {
                if (err || !job) {
                    resolve({ status: ReindexUtils.JobStatus.NIL });
                } else {
                    resolve(job);
                }
            });
        });
    }

    /**
     * Sets new job status
     * @param {string} entityType
     * @param {JobStatus} status
     * @returns {Promise<JobData>}
     */
    setReindexStatus (entityType, status) {
        return new Promise((resolve, reject) => {
            if (!Object.values(ReindexUtils.JobStatus).includes(status)) {
                reject(`Unknown job status`);
            }

            this._redisClient.hmset(ReindexUtils.createReindexKey(entityType), { status }, (err, job) => {
                if (err || !job) {
                    reject(`Cannot update status for entity '${entity}'`);
                } else {
                    resolve(job);
                }
            });
        });
    }

    setCleanupData (entityType) {
        const finishedAt = new Date();
        return new Promise((resolve, reject) => {
            this._redisClient.hmset(ReindexUtils.createReindexKey(entityType), { finished_at: finishedAt }, (err, job) => {
                if (err || !job) {
                    reject(`Cannot update status for entity '${entity}'`);
                } else {
                    resolve(job);
                }
            });
        });
    }
}

module.exports = ReindexUtils;
