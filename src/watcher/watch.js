const Worker = require('./worker');

(async () => {
    const worker = new Worker();
    worker.start(async () => {
        console.warn('Status: ', await worker.status());
    });

    console.warn('Worker is running in background');
})();
