'use strict';
const Redis = require('redis');
const config = require('config');
const client = Redis.createClient(config.redis);
const AdapterFactory = require('../adapters/factory');
const logger = require('../log');

class ProductCache {

    /**
     * Appends product sku to the Redis cache
     * @param product Product object
     * @returns Promise<void> Empty promise if succeeded
     */
    appendProduct (product) {
        return new Promise((resolve, reject) => {
            if (!product || !product.sku) { throw new Error(`Cannot append product of undefined sku`); }
            client.sadd('i:product-skus', product.sku, (err, res) => {
                if (err) { reject(err); }
                else { resolve(); }
            });
        });
    }

    /**
     * Returns list of cached product skus
     * @returns Promise<{ sku: string, id: string }> of all skus
     */
    getProductSkus() {
        return new Promise((resolve, reject) => {
            client.smembers('i:product-skus', (err, res) => {
                if (err) { reject(err); }
                else {
                    // Redis sets can only store strings. Thus objects are stored as stringified jsons
                    resolve(res.map(obj => JSON.parse(obj)));
                }
            });
        });
    }

    /**
     * Removes selected sku from cache set
     * @param {string} sku
     * @returns {Promise<void>}
     */
    removeProduct (sku) {
        if (!sku) { throw new Error(`Cannot remove product of undefined sku`); }
        return new Promise((resolve, reject) => {
           client.srem('i:product-skus', sku, (err, res) => {
               if (err) { reject(err); }
               else { resolve(); }
           });
        });
    }

    /**
     * Clears whole cached product set
     * @returns {Promise<void>} Empty promise if succeeded
     */
    clear () {
        return new Promise((resolve, reject) => {
           client.del('i:product-skus', (err) => {
               if (err) { reject(err); }
               else { resolve(); }
           });
        });
    }

    /**
     * Returns true if given sku is already cached if not
     * returns false
     * @param {string} sku
     * @returns {Promise<boolean>}
     */
    isCached (sku) {
        if (!sku) { throw new Error(`Cannot determine existence of undefined product`); }
        return new Promise((resolve) => {
           client.sismember('i:product-skus', sku, (err, res) => {
               if (err || res === 0 || res === '0') { resolve(false); }
               else { resolve(true); }
           });
        });
    }

    doesCacheExists () {
        return new Promise((resolve, reject) => {
           client.smembers('i:product-skus', (err, res) => {
               if (err || res.length === 0) { resolve(false); }
               else { resolve(true); }
           });
        });
    }

    /**
     * Recreates product cache from ElasticSearch
     * @returns {Promise<{ sku: string, id: string }>}
     */
    recreateFromElasticSearch (collectionName = 'product') {
        return new Promise((resolve) => {
            const factory = new AdapterFactory(config);
            const es = factory.getAdapter('nosql', 'elasticsearch');
            es.connect(async () => {
                const skusIdsPairs = await es.getProductSkus(collectionName);

                // Stringify objects so they can be stored under redis set
                client.sadd('i:product-skus', skusIdsPairs.map(obj => JSON.stringify(obj)), (err) => {
                    if (err) {
                        // throw new Error(`Cannot recreate cache from ES`);
                        // process.exit(1);
                        logger.info(`Cannot recreate cache from ES. Elasticsearch returned empty results`);
                        resolve([]);
                    } else {
                        logger.info(`Cache recreated from existing ES index '${collectionName}'`);
                        resolve(skusIdsPairs);
                    }
                });
            });
        });
    }

    getProductsSkus(ids) {
        return new Promise((resolve, reject) => {
            const factory = new AdapterFactory(config);
            const es = factory.getAdapter('nosql', 'elasticsearch');
            es.connect(async () => {
                const products = await es.getProductsSkus(ids);
                resolve(products);
            });
        });
    }
}

module.exports = new ProductCache();
