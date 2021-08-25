const Creator = require('./creator');
const Worker = require('./worker');

const testUniqJobs = async () => {
    const creator = new Creator();

    /*for (let i = 0; i < 300; i++) {
        const nextIds = Array(50).fill(0).map((el, index) => index + (i * 50));
        await creator.createReindexJob({ entity: 'product', ids: nextIds });
    }*/

    await creator.createReindexJob({ entity: 'category', ids: [67], storeCode: 'lm_pl' });
    testWatcher();
};

const testWatcher = async () => {
    const worker = new Worker({ storeCode: 'lm_pl' });
    worker.start();
};

testUniqJobs();
// testWatcher();
