const Creator = require('./creator');
const Worker = require('./worker');

const testUniqJobs = async () => {
    const creator = new Creator();

    /*for (let i = 0; i < 300; i++) {
        const nextIds = Array(50).fill(0).map((el, index) => index + (i * 50));
        await creator.createReindexJob({ entity: 'product', ids: nextIds });
    }*/

    await creator.createReindexJob({ entity: 'product', ids: [1,3,4,4,5,5,5,5,5,6,7,8,9,123] });
    testWatcher();
};

const testWatcher = async () => {
    const worker = new Worker({});
    worker.start();
};

testUniqJobs();
// testWatcher();
