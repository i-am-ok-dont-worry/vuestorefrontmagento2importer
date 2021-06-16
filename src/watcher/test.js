const Creator = require('./creator');
const Worker = require('./worker');

const testUniqJobs = async () => {
    const creator = new Creator();

    for (let i = 0; i < 300; i++) {
        const nextIds = Array(50).fill(0).map((el, index) => index + (i * 50));
        await creator.createReindexJob({ entity: 'product', ids: nextIds });
    }

    testWatcher();
};

const testWatcher = async () => {
    const worker = new Worker({});
    worker.start();
};

testUniqJobs();
// testWatcher();
