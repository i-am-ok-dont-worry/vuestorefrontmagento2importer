const program = require('commander');
const Creator = require('./creator');
const Worker = require('./worker');
const JobManager = require('./job-manager');

program.command('createjob')
    .option('--entity <entity>', 'Entity name')
    .option('--ids <ids>', 'Coma separated ids', (value) => value.split(','))
    .action(async (cmd) => {
        const creator = new Creator();
        await creator.createReindexJob({ entity: cmd.entity, ids: cmd.ids });
        process.exit(0);
    });

program.command('watch')
    .option('--maxActiveJobs <maxActiveJobs>', 'Maximum number of parallel workers', (value) => parseInt(value, 10))
    .option('--env <env>', 'Environment configuration')
    .option('--storeCode <storeCode>', 'Store code')
    .action((cmd) => {
        const worker = new Worker({ maxActiveJobs: cmd.maxActiveJobs, env: cmd.env, storeCode: cmd.storeCode });
        worker.start();
        console.warn('Worker is running in the background. ', cmd.storeCode ? 'Store code: ' + cmd.storeCode : '');
    });

program.command('health')
    .action(async () => {
        const worker = new Worker();
        console.warn(await worker.health());
        process.exit(0);
    });

program.command('pause')
    .action(() => {
        const worker = new Worker();
        worker.pause();
    });

program.command('resume')
    .action(() => {
        const worker = new Worker();
        worker.resume();
    });

program.command('status')
    .option('--entity <entity>', 'Entity name')
    .option('--ids <ids>', 'Entity identifiers', (value) => value.split(','))
    .action(async (cmd) => {
        try {
            const jobManger = new JobManager();
            console.warn(await jobManger.isRunning(cmd.entity, cmd.ids));
            process.exit(0);
        } catch (e) {
            console.error('Cannot read status: ', e.message);
            process.exit(0);
        }
    });

program.command('requeue')
    .action(async () => {
       try {
           const worker = new Worker();
           await worker.requeue();
           process.exit(0);
       } catch (e) {
        console.error(`Error while requeue: `, e.message);
        process.exit(0);
       }
    });

program.command('remove')
    .action(async () => {
       try {
           const worker = new Worker();
           await worker.remove();
           process.exit(0);
       } catch (e) {
           console.error('Cannot remove stuck jobs: ', e.message);
           process.exit(1);
       }
    });

program.command('clear')
    .action(async () => {
        try {
            const worker = new Worker();
            await worker.clear();
            const mage = new JobManager();
            await mage.clearAll();
            process.exit(0);
        } catch (e) {
            console.error('Cannot remove stuck jobs: ', e.message);
            process.exit(1);
        }
    });

program.command('cache-clear')
    .option('--prefix <prefix>', 'Prefix')
    .action(async (cmd) => {
        try {
            const jobManager = new JobManager();
            await jobManager.clearCache(cmd.prefix);
            process.exit(0);
        } catch (e) {
            console.error('Cannot clear cache: ', e.message);
            process.exit(1);
        }
    });

program.parse(process.argv);
