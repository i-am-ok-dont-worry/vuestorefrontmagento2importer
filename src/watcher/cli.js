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
    .action((cmd) => {
        const worker = new Worker({ maxActiveJobs: cmd.maxActiveJobs, env: cmd.env });
        worker.start();
        console.warn('Worker is running in background');
    });

program.command('health')
    .action(async () => {
        const worker = new Worker();
        console.warn(await worker.status());
        process.exit(0);
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

program.parse(process.argv);
