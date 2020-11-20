const Creator = require('./creator');
const Worker = require('./worker');
const JobManager = require('./job-manager');

(async () => {
    const creator = new Creator();
    const worker = new Worker();
    // await creator.createReindexJob({ entity: 'block', priority: 'normal', ids: ['123'] });
    // await creator.createReindexJob({ entity: 'block', priority: 'normal', ids: ['123'] });

    await creator.createReindexJob({ entity: 'block', priority: 'normal', ids: ['123'] });
    const status = await new JobManager.isRunning('block', ['123']);
    debugger;

    worker.start(async () => {
        console.warn('Status: ', await worker.status());
    });

})();
