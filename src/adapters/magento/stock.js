'use strict';
let AbstractMagentoAdapter = require('./abstract');
const productCache = require('../../product-cache/product-cache');

class StockAdapter extends AbstractMagentoAdapter {

    constructor (config) {
        super(config);
        this.use_paging = false;
    }

    getEntityType () {
        return 'stock';
    }

    getSwappedEntityType () {
        return 'product_new';
    }

    getName () {
        return 'adapters/magento/StockAdapter';
    }

    getLabel (source_item) {
        return `[(${source_item.sku})]`;
    }

    prepareItems (items) {
        if (!items) { return null; }

        this.total_count = items.length;

        return items;
    }

    async getSourceData(context) {
        let skus = [];

        if (await productCache.doesCacheExists()) {
            skus = await productCache.getProductSkus();
        } else {
            skus = await productCache.recreateFromElasticSearch();
        }

        if (context.ids && context.ids instanceof Array && context.ids.length > 0) {
            return skus.filter(({ id }) => context.ids.includes(id));
        } else if (context.skus && context.skus instanceof Array && context.skus.length > 0) {
            return skus.filter(({ sku }) => context.skus.includes(sku));
        } else {
            return skus;
        }
    }

    async preProcessItem(item) {
        await this.processStocks(item);
        return item;
    }

    processStocks (item) {
        return this.api.stockItems.list(item.sku)
            .then(res => {
                const stock = {
                    qty: res.qty,
                    is_in_stock: res.is_in_stock,
                    min_qty: res.min_qty,
                    min_sale_qty: res.min_sale_qty,
                    max_sale_qty: res.max_sale_qty
                };
                Object.assign(item, { stock });
                return item;
            })
            .catch(() => {
               console.warn(`Unable to reindex stock on product: `, item.sku);
            });
    }
}

module.exports = StockAdapter;
