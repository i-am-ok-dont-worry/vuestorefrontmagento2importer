const { EntityType } = require('./entity');
const spawn = require('child_process').spawn;
const MagentoImporter = require('../adapters/importer');

const _exec = Symbol();
const _assertFunctionImplemented = Symbol();
const _assertJobDataIsValid = Symbol();

const _handleAttributesReindex = Symbol();
const _handlePagesReindex = Symbol();
const _handleBlocksReindex = Symbol();
const _handleProductsReindex = Symbol();
const _handleCategoriesProductsReindex = Symbol();
const _handleCategoriesReindex = Symbol();
const _handleReviewsReindex = Symbol();
const _handleTaxRulesReindex = Symbol();
const _handleStocksReindex = Symbol();

class ReindexExecutor {
    static execMap = {
        [EntityType.ATTRIBUTE]: _handleAttributesReindex,
        [EntityType.PAGE]: _handlePagesReindex,
        [EntityType.BLOCK]: _handleBlocksReindex,
        [EntityType.PRODUCT]: _handleProductsReindex,
        [EntityType.CATEGORY]: _handleCategoriesReindex,
        [EntityType.CATEGORY_PRODUCTS]: _handleCategoriesProductsReindex,
        [EntityType.REVIEW]: _handleReviewsReindex,
        [EntityType.TAX_RULE]: _handleTaxRulesReindex,
        [EntityType.STOCK]: _handleStocksReindex
    };

    constructor (env, storeCode) {
        this.storeCode = storeCode;
    }

    run ({ entity, ids }) {
        this[_assertFunctionImplemented](entity);
        this[_assertJobDataIsValid]({ entity, ids });

        const func = this[ReindexExecutor.execMap[entity]];
        ids = ids.map(id => id.split(':')[0]);
        return func.call(this, { entity, ids });
    }

    /**
     * Throws exception if entity type is unsupported
     * or handling function was not already implemented
     * @param entity
     */
    [_assertFunctionImplemented] (entity) {
        if (!entity || !Object.values(EntityType).includes(entity)) {
            throw new Error('Entity type not supported');
        }

        if (!this[ReindexExecutor.execMap[entity]] || typeof this[ReindexExecutor.execMap[entity]] !== 'function') {
            throw new Error('Method not implemented');
        }
    }

    /**
     * Asserts if context data is valid
     * Jobs must have entity type
     * @param data
     */
    [_assertJobDataIsValid] (data) {
        if (!data) { throw new Error('Job data invalid. Missing entity type '); }
        if (!data.hasOwnProperty('entity') || data.entity.length === 0) { throw new Error('Invalid entity name'); }
    }

    /**
     * Run attributes indexer
     * @param context
     * @returns {Promise}
     */
    [_handleAttributesReindex](context) {
        return new Promise((resolve, reject) => {
            let importer = new MagentoImporter({ ids: context.ids, adapter: 'attribute', storeCode: this.storeCode });

            importer.run(() => {
                resolve();
            });
        });
    }

    /**
     * Runs pages reindex
     * @param context
     * @returns {Promise}
     */
    [_handlePagesReindex](context) {
        return new Promise((resolve, reject) => {
            let importer = new MagentoImporter({ ids: context.ids, adapter: 'cms_page', storeCode: this.storeCode });

            importer.run(() => {
                resolve();
            });
        });
    }

    /**
     * Runs blocks reindex
     * @param context
     * @returns {Promise}
     */
    [_handleBlocksReindex](context) {
        return new Promise((resolve, reject) => {
            let importer = new MagentoImporter({ ids: context.ids, adapter: 'cms_block', storeCode: this.storeCode });

            importer.run(() => {
                resolve();
            });
        });
    }

    /**
     * Runs products reindex - full or selective
     * @param context
     */
    [_handleProductsReindex](context) {
        return new Promise((resolve, reject) => {
            let importer = new MagentoImporter({ ids: context.ids, adapter: 'product', storeCode: this.storeCode });

            importer.run(() => {
                resolve();
            });
        });
    }

    /**
     * Runs product categories reindex
     * @param context
     */
    [_handleCategoriesProductsReindex](context) {
        return new Promise((resolve, reject) => {
            let importer = new MagentoImporter({ ids: context.ids, adapter: 'productcategories', storeCode: this.storeCode });

            importer.run(() => {
                resolve();
            });
        });
    }

    /**
     * Runs categories reindex - full or selective
     * @param context
     */
    [_handleCategoriesReindex](context) {
        return new Promise((resolve, reject) => {
            let importer = new MagentoImporter({ ids: context.ids, adapter: 'category', storeCode: this.storeCode });

            importer.run(() => {
                resolve();
            });
        });
    }

    /**
     * Runs reviews reindex
     * @param context
     */
    [_handleReviewsReindex](context) {
        return new Promise((resolve, reject) => {
            let importer = new MagentoImporter({ ids: context.ids, adapter: 'review', storeCode: this.storeCode });

            importer.run(() => {
                resolve();
            });
        });
    }

    /**
     * Runs tax rules reindex
     * @param context
     */
    [_handleTaxRulesReindex](context) {
        return new Promise((resolve, reject) => {
            let importer = new MagentoImporter({ ids: context.ids, adapter: 'taxrule', storeCode: this.storeCode });

            importer.run(() => {
                resolve();
            });
        });
    }

    /**
     * Runs stocks rules reindex
     * @param context
     */
    [_handleStocksReindex](context) {
        return new Promise((resolve, reject) => {
            let importer = new MagentoImporter({ ids: context.ids, adapter: 'stock', storeCode: this.storeCode });

            importer.run(() => {
                resolve();
            });
        });
    }

    /**
     * Handles spawning child processes
     * @param cmd Command
     * @param args
     * @param opts
     * @returns {Promise<unknown>}
     */
    [_exec] (cmd, args, opts) {
        return new Promise((resolve, reject) => {
            let child = spawn(cmd, args, opts);

            child.stdout.on('data', (data) => {
                const utf8 = data.toString('utf8');
                if (utf8.indexOf('node') === -1) {
                    console.log(utf8);
                }
            });

            child.stderr.on('data', (data) => {
                const utf8 = data.toString('utf8');
                if (utf8.indexOf('node') === -1) {
                    console.log(utf8);
                }
            });

            child.on('exit', (code) => {
                console.warn('Finished');
                resolve(code);
            });

            child.on('error', (error) => {
                console.warn('Error: ', error);
                reject(error)
            });
        })
    }
}

module.exports = ReindexExecutor;
