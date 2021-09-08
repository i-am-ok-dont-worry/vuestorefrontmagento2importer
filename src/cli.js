process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

const program = require('commander');
const ESRemapper = require('./helpers/es-remapper');
const MagentoImporter = require('./adapters/importer');
const MultiStoreUtils = require('./helpers/multistore-utils');
let logger = require('./log');


program
    .command('attributes')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .option('--storeCode <storeCode>', 'storeCode')
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let storeCode = cmd.storeCode || MultiStoreUtils.getStoreCode();
        let importer = new MagentoImporter({ ids, adapter: 'attribute', storeCode });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('categories')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .option('--storeCode <storeCode>', 'storeCode')
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let storeCode = cmd.storeCode || MultiStoreUtils.getStoreCode();
        let importer = new MagentoImporter({ ids, adapter: 'category', storeCode });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('products')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .option('--storeCode <storeCode>', 'storeCode')
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let storeCode = cmd.storeCode || MultiStoreUtils.getStoreCode();
        let importer = new MagentoImporter({ ids, adapter: 'product', use_paging: !ids, storeCode });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('stocks')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .option('--storeCode <storeCode>', 'storeCode')
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let storeCode = cmd.storeCode || MultiStoreUtils.getStoreCode();
        let importer = new MagentoImporter({ ids, adapter: 'stock', storeCode });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('pages')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .option('--storeCode <storeCode>', 'storeCode')
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let storeCode = cmd.storeCode || MultiStoreUtils.getStoreCode();
        let importer = new MagentoImporter({ ids, adapter: 'cms_page', storeCode });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('taxrule')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .option('--storeCode <storeCode>', 'storeCode')
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let storeCode = cmd.storeCode || MultiStoreUtils.getStoreCode();
        let importer = new MagentoImporter({ ids, adapter: 'taxrule', storeCode });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('reviews')
    .option('--ids <ids>', 'ids', (value) => value.split(','))
    .option('--storeCode <storeCode>', 'storeCode')
    .action((cmd) => {
        let ids = cmd.ids && cmd.ids instanceof Array && cmd.ids.length > 0 ? cmd.ids : null;
        let storeCode = cmd.storeCode || MultiStoreUtils.getStoreCode();
        let importer = new MagentoImporter({ ids, adapter: 'review', storeCode });

        importer.run(() => {
            process.exit();
        });
    });

program
    .command('remap')
    .option('--storeCode <storeCode>', 'storeCode')
    .action(async (cmd) => {
        let mapper = new ESRemapper();
        let storeCode = cmd.storeCode || MultiStoreUtils.getStoreCode();
        await mapper.updateElasticSearchMapping(storeCode);
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
