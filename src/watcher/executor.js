const { EntityType } = require('./entity');
const spawn = require('child_process').spawn;
const config = require('config');

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

function multiStoreConfig (apiConfig, storeCode) {
    let confCopy = Object.assign({}, apiConfig)

    if (storeCode && config.availableStores.indexOf(storeCode) >= 0) {
        if (config.magento2['api_' + storeCode]) {
            confCopy = Object.assign({}, config.magento2['api_' + storeCode]) // we're to use the specific api configuration - maybe even separate magento instance
        }
        confCopy.url = confCopy.url + '/' + storeCode
    } else {
        if (storeCode) {
            console.error('Unavailable store code', storeCode)
        }
    }
    return confCopy
}

function getMagentoDefaultConfig (storeCode) {
    const apiConfig = multiStoreConfig(config.magento2.api, storeCode)
    return {
        TIME_TO_EXIT: 2000,
        PRODUCTS_SPECIAL_PRICES: true,
        SKIP_REVIEWS: false,
        SKIP_CATEGORIES: false,
        SKIP_PRODUCTCATEGORIES: false,
        SKIP_ATTRIBUTES: false,
        SKIP_TAXRULE: false,
        SKIP_PRODUCTS: false,
        PRODUCTS_EXCLUDE_DISABLED: config.catalog.excludeDisabledProducts,
        MAGENTO_CONSUMER_KEY: apiConfig.consumerKey,
        MAGENTO_CONSUMER_SECRET: apiConfig.consumerSecret,
        MAGENTO_ACCESS_TOKEN: apiConfig.accessToken,
        MAGENTO_ACCESS_TOKEN_SECRET: apiConfig.accessTokenSecret,
        MAGENTO_URL: apiConfig.url,
        MAGENTO_MSI_STOCK_ID: config.msi.defaultStockId,
        REDIS_HOST: config.redis.host,
        REDIS_PORT: config.redis.port,
        REDIS_DB: config.redis.db,
        REDIS_AUTH: config.redis.auth,
        INDEX_NAME: config.elasticsearch.indices[0],
        DATABASE_URL: `${config.elasticsearch.protocol}://${config.elasticsearch.host}:${config.elasticsearch.port}`,
        ELASTICSEARCH_API_VERSION: config.elasticsearch.apiVersion
    }
}

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

    constructor (env) {
        this.env = Object.assign({}, getMagentoDefaultConfig(process.env.STORE_CODE || 1), env, process.env);
    }

    run ({ entity, ids }) {
        this[_assertFunctionImplemented](entity);
        this[_assertJobDataIsValid]({ entity, ids });

        const func = this[ReindexExecutor.execMap[entity]];
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
        return this[_exec]('node', [
            '--harmony',
            __dirname + '/../cli.js',
            'attributes',
        ].concat(context.ids ? '--ids=' + context.ids : ''), { shell: false, env: this.env || process.env });
    }

    /**
     * Runs pages reindex
     * @param context
     * @returns {Promise}
     */
    [_handlePagesReindex](context) {
        return this[_exec]('node', [
            '--harmony',
            __dirname + '/../cli.js',
            'pages',
        ].concat(context.ids ? '--ids=' + context.ids : ''), { shell: false, env: this.env || process.env });
    }

    /**
     * Runs blocks reindex
     * @param context
     * @returns {Promise}
     */
    [_handleBlocksReindex](context) {
        return this[_exec]('node', [
            '--harmony',
            __dirname + '/../cli.js',
            'blocks',
        ].concat(context.ids ? '--ids=' + context.ids : ''), { shell: false, env: this.env || process.env });
    }

    /**
     * Runs products reindex - full or selective
     * @param context
     */
    [_handleProductsReindex](context) {
        return this[_exec]('node', [
            '--harmony',
            __dirname + '/../cli.js',
            'products',
        ].concat(context.ids ? '--skus=' + context.ids : ''), { shell: false, env: this.env || process.env });
    }

    /**
     * Runs product categories reindex
     * @param context
     */
    [_handleCategoriesProductsReindex](context) {
        return this[_exec]('node', [
            '--harmony',
            __dirname + '/../cli.js',
            'productcategories',
        ].concat(context.ids ? '--ids=' + context.ids : ''), { shell: false, env: this.env || process.env });
    }

    /**
     * Runs categories reindex - full or selective
     * @param context
     */
    [_handleCategoriesReindex](context) {
        return this[_exec]('node', [
            '--harmony',
            __dirname + '/../cli.js',
            'categories',
        ].concat(context.ids ? '--ids=' + context.ids : ''), { shell: false, env: this.env || process.env });
    }

    /**
     * Runs reviews reindex
     * @param context
     */
    [_handleReviewsReindex](context) {
        return this[_exec]('node', [
            '--harmony',
            __dirname + '/../cli.js',
            'reviews',
        ].concat(context.ids ? '--ids=' + context.ids : ''), { shell: false, env: this.env || process.env });
    }

    /**
     * Runs tax rules reindex
     * @param context
     */
    [_handleTaxRulesReindex](context) {
        return this[_exec]('node', [
            '--harmony',
            __dirname + '/../cli.js',
            'taxrule',
        ].concat(context.ids ? '--ids=' + context.ids : ''), { shell: false, env: this.env || process.env });
    }

    /**
     * Runs tax rules reindex
     * @param context
     */
    [_handleStocksReindex](context) {
        return this[_exec]('node', [
            '--harmony',
            __dirname + '/../cli.js',
            'stocks',
        ].concat(context.ids ? '--skus=' + context.ids : ''), { shell: false, env: this.env || process.env });
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
                console.log(data.toString('utf8'));
            });

            child.stderr.on('data', (data) => {
                console.log(data.toString('utf8'));
            });

            child.on('close', (code) => {
                console.warn('Job done');
                resolve(code);
            });

            child.on('exit', (code) => {
                console.warn('Job done');
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
