const kue = require('kue');
const config = require('config');
const queue = kue.createQueue(Object.assign({}, { redis: config.redis }));
const ReindexExecutor = require('./executor');
const Manager = require('./job-manager');
const MultistoreUtils = require('../helpers/multistore-utils');

const _process = Symbol();
const safeCallback = (callback) => {
    if (callback && typeof callback === 'function') { callback(); }
};

class Worker {

    constructor ({ maxActiveJobs = 1, env, storeCode } = {}) {
        this.busy = false;
        this.ctx = null;
        this.storeCode = storeCode;
        this.maxActiveJobs = maxActiveJobs;
        this.handler = new ReindexExecutor(env, storeCode);
        this.manager= new Manager();
    }

    /**
     * Starts observing queue
     * @param callback Callback function called when job has been processed
     */
    start(callback) {
        const isDefaultStore = MultistoreUtils.isDefaultStoreView(this.storeCode);
        queue.process(this.storeCode && !isDefaultStore ? `i:mage-data-${this.storeCode}` : 'i:mage-data', Number(this.maxActiveJobs), async (job, ctx, done) => {
            let entity, ids;
            try {
                entity = job.data.data.entity;
                ids = await this.manager.getQueuedIdsForEntity({ entity, storeCode: this.storeCode });

                if (!ids || (ids instanceof Array && ids.length === 0)) {
                    done();
                    return;
                }

                this.busy = true;
                this.ctx = ctx;
                await this[_process]({ data: { entity, ids }});
                await this.manager.clearReindexQueueForEntity({ entity, ids });

                this.busy = false;
                safeCallback(callback);
                done();
            } catch (e) {
                this.busy = false;
                await this.manager.clearReindexQueueForEntity({ entity, ids });
                console.warn('Error while running job: ', e);
                done(e);
            }
        });
    }

    /**
     * Pauses queue execution
     * until resume() method is called
     */
    pause() {
        if (this.ctx) {
            this.ctx.pause(0, function(err) {
                console.log('Worker is paused...');
            });
        }
    }

    /**
     * Resumes queue execution
     */
    resume () {
        if (this.ctx) {
            this.ctx.resume();
            console.log('Worker is resumed...');
        }
    }

    /**
     * Returns queue health status
     * @returns {Promise<unknown>}
     */
    health () {
        let status = { inactiveJobs: 0, activeJobs: 0, delayedJobs: 0, failedJobs: 0, busy: this.busy };
        return new Promise((resolve) => {
            queue.inactiveCount('i:mage-data', (err, total) => {
                if (total === 0) { this.busy = false; }
                status.inactiveJobs = total || 0;
                queue.activeCount('i:mage-data',(err, total) => {
                    status.activeJobs = total || 0;
                    queue.delayedCount('i:mage-data',(err, total) => {
                        status.delayedJobs = total || 0;
                        queue.failedCount('i:mage-data', (err, total) => {
                            status.failedJobs = total || 0;
                            resolve(status);
                        });
                    });
                });
            });
        });
    }

    /**
     * Recover queued stuck jobs.
     * @returns {Promise<unknown>}
     */
    requeue () {
        return new Promise((resolve, reject) => {
            queue.active(( err, ids ) => {
                ids.forEach(( id, index ) => {
                    kue.Job.get(id, ( err, job ) => {
                        job.inactive();
                        if (index === ids.length - 1) { resolve(); }
                    });
                });
            });
        });
    }

    /**
     * Delete stuck jobs
     */
    remove () {
        return new Promise((resolve, reject) => {
            queue.active(( err, ids ) => {
                if (err || !ids.length) { resolve(); }
                ids.forEach((id, index) => {
                    kue.Job.remove(id, (err) => {
                       if (index === ids.length - 1) { resolve(); }
                    });
                });
            });
        });
    }

    /**
     * Clear jobs
     */
    clear () {
        return new Promise(async (resolve, reject) => {
           await this.manager.clearAll();

           queue.inactive((err, ids) => {
               if (err || !ids.length) { resolve(); }
               ids.forEach((id, index) => {
                   kue.Job.remove(id, () => {
                       if (index === ids.length - 1) {
                           resolve();
                       }
                   });
               });
           });
        });
    }

    /**
     * Runs appropriate indexer for a job
     * @param context
     */
    [_process] (context) {
        return this.handler.run(context.data);
    }
}



module.exports = Worker;
