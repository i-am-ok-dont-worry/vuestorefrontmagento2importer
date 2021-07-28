process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

const program = require('commander');
const ESRemapper = require('./helpers/es-remapper');
const MagentoImporter = require('./adapters/importer');
let logger = require('./log');


program
    .command('attributes')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let importer = new MagentoImporter({ ids, adapter: 'attribute' });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('categories')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let importer = new MagentoImporter({ ids, adapter: 'category' });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('products')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let importer = new MagentoImporter({ ids, adapter: 'product', use_paging: !ids });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('stocks')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let importer = new MagentoImporter({ ids, adapter: 'stock' });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('pages')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let importer = new MagentoImporter({ ids, adapter: 'cms_page' });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('taxrule')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let importer = new MagentoImporter({ ids, adapter: 'taxrule' });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('reviews')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let importer = new MagentoImporter({ ids, adapter: 'review' });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('remap')
    .action(async (cmd) => {
        let mapper = new ESRemapper();
        await mapper.updateElasticSearchMapping();
        process.exit();
    });

program.parse(process.argv);

program
    .on('command:*', () => {
        console.error('Invalid command: %s\nSee --help for a list of available commands.', program.args.join(' '));
        process.exit(1);
    });

process
    .on('unhandledRejection', (reason, p) => {
        logger.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
        // application specific logging, throwing an error, or other logic here
    });
