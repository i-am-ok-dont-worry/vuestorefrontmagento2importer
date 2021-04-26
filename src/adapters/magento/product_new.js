'use strict';

let AbstractMagentoAdapter = require('./abstract');
const CacheKeys = require('./cache_keys');
const util = require('util');

class ProductNewAdapter extends AbstractMagentoAdapter {

    constructor (config) {
        super(config);
        this.use_paging = true;
        this.attributes = {};
    }

    async fetchAttributes () {
        if (this.attributes && Object.keys(this.attributes).length) {
            return this.attributes;
        } else {
            return this.api.attributes.list()
                .then((response) => {
                    const mappedAttributes = response.items.reduce((acc, next) => {
                        return { ...acc, [next.attribute_code]: next };
                    }, {});
                    this.attributes = mappedAttributes;
                    return mappedAttributes;
                });
        }
    }

    getEntityType () {
        return 'product_new';
    }

    getSwappedEntityType () {
        return 'product';
    }

    getName () {
        return 'adapters/magento/ProductNewAdapter';
    }

    getFilterQuery(context) {
        let query = '';

        if (context.ids && context.ids.length > 0) { // pull individual products by ids
            if (!Array.isArray(context.ids)) { context.ids = new Array(context.ids); }

            query += 'searchCriteria[filter_groups][0][filters][0][field]=entity_id&' +
                'searchCriteria[filter_groups][0][filters][0][value]=' + encodeURIComponent(context.ids.join(',')) + '&' +
                'searchCriteria[filter_groups][0][filters][0][condition_type]=in';
        } else if (context.skus && context.skus.length > 0) { // pull individual products by skus
            if (!Array.isArray(context.skus))
                context.skus = new Array(context.skus);

            query += 'searchCriteria[filter_groups][0][filters][0][field]=sku&' +
                'searchCriteria[filter_groups][0][filters][0][value]=' + encodeURIComponent(context.skus.join(',')) + '&' +
                'searchCriteria[filter_groups][0][filters][0][condition_type]=in';

        } else if (context.updated_after && typeof context.updated_after == 'object') {
            query += 'searchCriteria[filter_groups][0][filters][0][field]=updated_at&' +
                'searchCriteria[filter_groups][0][filters][0][value]=' + encodeURIComponent(moment(context.updated_after).utc().format()) + '&' +
                'searchCriteria[filter_groups][0][filters][0][condition_type]=gt';
        }

        return query;
    }

    prepareItems (items) {
        if(!items) {
            return null;
        }

        this.total_count = items.total_count;

        if (this.use_paging) {
            this.page_count = Math.ceil(this.total_count / this.page_size);
            logger.info('Page count', this.page_count)
        }

        return items.items;
    }

    getSourceData(context) {
        let query = this.getFilterQuery(context);
        let searchCriteria = '&searchCriteria[currentPage]=%d&searchCriteria[pageSize]=%d';

        this.page = context.page || 1;
        this.page_size = context.page_size;

        if (!context.use_paging) {
            this.page_count = 1;
        }

        return this.api.productsNew.list(util.format(searchCriteria, context.page, context.page_size) + (query ? '&' + query : ''))
            .then((res) => {
                return res;
            })
            .catch((err) => {
                throw new Error(err);
            });
    }

    /**
     * Returns list of products
     * @param context
     * @returns Promise<Product>
     */
    getProductSourceData(context) {
        return this.api.productsNew.list();
    }

    preProcessItem(item) {
        return this.api.productsNew.single(item.sku)
            .then(async (product) => {
                this.processPrice(product);
                this.processStocks(product);
                this.processMedia(product);
                this.processBundleOptions(product);
                await this.processAttributes(product);
                await this.processConfigurableOptions(product);
                await this.processCategories(product);

                logger.info(`Product ${product.sku} imported`);
                return product;
            });
    }

    /**
     * Checks special_price integrity
     * @param item Current product
     * @returns Product
     */
    processPrice (item) {
        try {
            if (!item.hasOwnProperty('special_price')) {
                item.special_price = null;
            }
        } catch (e) {}

        return item;
    }

    /**
     * Retrieves stock info from product object
     * and assigns it to the root of the object
     * @param item Current product
     * @returns Product
     */
    processStocks (item) {
        try {
            const { stock_item } = item.extension_attributes;
            const stock = {
                qty: stock_item.qty,
                is_in_stock: stock_item.is_in_stock,
                min_qty: stock_item.min_qty,
                min_sale_qty: stock_item.min_sale_qty,
                max_sale_qty: stock_item.max_sale_qty,
                backorders: stock_item.backorders,
                qty_increments: stock_item.qty_increments,
                enable_qty_increments: stock_item.enable_qty_increments,
                low_stock_date: stock_item.low_stock_date
            };

            Object.assign(item, { stock });
            delete item.extension_attributes['stock_item'];
            return item;
        } catch (e) {
            logger.warn(`Unable to retrieve stock info`, e);
            return item;
        }
    }

    /**
     * Processes media gallery info
     * and assigns it to the root of the object
     * @param item Current product
     * @returns Product
     */
    processMedia (item) {
        try {
            let media_gallery = [];
            for (let media of item.media_gallery_entries || []) {
                media_gallery.push({
                    image: media.file,
                    pos: media.position,
                    typ: media.media_type,
                    lab: media.label,
                    vid: this.computeVideoData(media)
                });
            }

            Object.assign(item, { media_gallery });
            delete item['media_gallery_entries'];
            return item;
        } catch (e) {
            logger.warn(`Unable to retrieve media gallery info: `, e);
            return item;
        }
    }

    /**
     * Processes bundle options info
     * and assigns it to the root of the object
     * @param item Current product
     * @returns Product
     */
    processBundleOptions (item) {
        try {
            const { bundle_product_options } = item;
            if (!bundle_product_options) {
                Object.assign(item, { bundle_product_options: [] });
            }

            return item;
        } catch (e) {
            logger.warn(`Unable to retrieve bundle options info`);
            return item;
        }
    }

    /**
     * Processes configurable options
     * Expands configurable children
     * @param item Current product
     * @returns Product
     */
    async processConfigurableOptions (item) {
        if (item.type_id !== 'configurable') { return item; }
        try {
            const children = await this.api.configurableChildren.list(item.sku);
            const configurable_children = new Array();
            const minPrice = Math.min(...(children || []).map(({ price }) => price || 0));

            for (let prOption of children) {
                let confChild = {
                    sku: prOption.sku,
                    id: prOption.id,
                    status: prOption.status,
                    visibility: prOption.visibility,
                    name: prOption.name,
                    price: prOption.price,
                    tier_prices: prOption.tier_prices,
                    ...(prOption.special_price && { special_price: prOption.special_price }),
                };

                if (prOption.custom_attributes) {
                    for (let opt of prOption.custom_attributes) {
                        confChild[opt.attribute_code] = opt.value
                    }
                }

                const context = this.current_context;

                if (context.renderedProducts && context.renderedProducts.items.length) {
                    const renderedProducts = context.renderedProducts;
                    const subProductAdditionalInfo = renderedProducts.items.find(p => p.id === confChild.id);

                    if (subProductAdditionalInfo && subProductAdditionalInfo.price_info) {
                        delete subProductAdditionalInfo.price_info.formatted_prices;
                        delete subProductAdditionalInfo.price_info.extension_attributes;
                        confChild = Object.assign(confChild, subProductAdditionalInfo.price_info);
                        if (confChild.final_price < confChild.price) {
                            confChild.special_price = confChild.final_price;
                        }

                        if (this.config.product.renderCatalogRegularPrices) {
                            confChild.price = confChild.regular_price;
                        }

                    }
                }

                configurable_children.push(confChild);
                Object.assign(item, {configurable_children});
            }

            const configurableOptions = await this.api.configurableOptions.list(item.sku);
            item.configurable_options = configurableOptions;

            await this._expandConfigurableOptionsAttributes.bind(this)(item);
            logger.info('Configurable children expanded on product: ', item.sku);

            if (minPrice) { item.price = minPrice; }

            return item;
        } catch (e) {
            logger.warn(`Unable to retrieve configurable options info`);
            return item;
        }
    }

    /**
     * Expands info about categories in product -
     * In native Magento product have only info about the category ids.
     * Reindexer appends extra info about the categories product belongs to
     * @param item Current product
     * @returns {Promise<Product>}
     */
    async processCategories (item) {
        try {
            const key = util.format(CacheKeys.CACHE_KEY_PRODUCT_CATEGORIES, item.sku);
            const getCatsFromCacheToPromise = () => new Promise((resolve) => {
                this.cache.smembers(key, async (err, categories) => {
                    if (categories == null) { resolve(item); }
                    else {
                        const category = await this._expandCategories(categories);
                        Object.assign(item, { category });
                        resolve(item);
                    }
                });
            });

            if (item.category_ids && Array.isArray(item.category_ids) && item.category_ids.length > 0) {
                const catIdsArray = item.category_ids.map(item => parseInt(item));
                const category = await this._expandCategories(catIdsArray);
                Object.assign(item, { category });
                return item;
            } else {
                return await getCatsFromCacheToPromise();
            }
        } catch (e) {
            logger.warn('Cannot expand category info: ', e);
            return item;
        }
    }

    async _expandCategories (categoriesIds) {
        let catPromises = new Array();
        for (let catId of categoriesIds) {
            catPromises.push(
                new Promise((resolve) => {
                    this.cache.get(util.format(CacheKeys.CACHE_KEY_CATEGORY, catId), (err, serializedCat) => {
                        let cat = JSON.parse(serializedCat); // category object
                        if (cat != null) {
                            resolve({
                                category_id: cat.id,
                                name: cat.name,
                                slug: cat.slug,
                                path: cat.url_path,
                                level: cat.level
                            })
                        } else {
                            resolve({
                                category_id: catId
                            });
                        }
                    });
                })
            );
        }

        return await Promise.all(catPromises);
    }

    async _expandConfigurableOptionsAttributes (item) {
        const subPromises = [];
        for (let option of item.configurable_options) {
            let atrKey = util.format(CacheKeys.CACHE_KEY_ATTRIBUTE, option.attribute_id);
            subPromises.push(new Promise((resolve, reject) => {
                logger.info(`Configurable options for ${atrKey}`);
                this.cache.get(atrKey, (err, serializedAtr) => {
                    let atr = JSON.parse(serializedAtr); // category object
                    if (atr != null) {
                        option.attribute_code = atr.attribute_code;
                        option.values.map((el) => {
                            el.label = (attr, optionId) => {
                                if (attr) {
                                    let opt = attr.options.find((op) => {
                                        if (_.toString(op.value) === _.toString(optionId)) {
                                            return op
                                        }
                                    });
                                    return opt ? opt.label : optionId
                                } else {
                                    return optionId
                                }
                            };
                        });

                        logger.info(`Product options for ${atr.attribute_code} for ${item.sku} set`);
                        item[atr.attribute_code + '_options'] = option.values.map((el) => {
                            return el.value_index;
                        })
                    }

                    resolve(item);
                });
            }));
        }

        await Promise.all(subPromises);
    }

    /**
     * Process video data to provide the proper
     * provider and attributes.
     * Currently supports YouTube and Vimeo
     *
     * @param {Object} mediaItem
     */
    computeVideoData(mediaItem) {
        let videoData = null;

        if (mediaItem.extension_attributes && mediaItem.extension_attributes.video_content) {
            let videoId = null,
                type = null,
                youtubeRegex = /^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/,
                vimeoRegex = new RegExp(['https?:\\/\\/(?:www\\.|player\\.)?vimeo.com\\/(?:channels\\/(?:\\w+\\/)',
                    '?|groups\\/([^\\/]*)\\/videos\\/|album\\/(\\d+)\\/video\\/|video\\/|)(\\d+)(?:$|\\/|\\?)'
                ].join(''));

            if (mediaItem.extension_attributes.video_content.video_url.match(youtubeRegex)) {
                videoId = RegExp.$1
                type = 'youtube'
            } else if (mediaItem.extension_attributes.video_content.video_url.match(vimeoRegex)) {
                videoId = RegExp.$3
                type = 'vimeo'
            }

            videoData = {
                url: mediaItem.extension_attributes.video_content.video_url,
                title: mediaItem.extension_attributes.video_content.video_title,
                desc: mediaItem.extension_attributes.video_content.video_description,
                meta: mediaItem.extension_attributes.video_content.video_metadata,
                video_id: videoId,
                type: type
            }
        }

        return videoData;
    }

    mapCustomAttributesToObjectRoot (item) {
        for (let customAttribute of item.custom_attributes || []) {
            Object.assign(item, { [customAttribute.attribute_code]: customAttribute.value });
        }
    }

    /**
     * Processes custom product attributes
     * It will split multi-select type attributes into tokens
     * and rewrites attributes from array to document root
     * @param {Product} product
     * @returns {Promise<Product>}
     */
    async processAttributes (product) {
        let attributesMap = {};
        try { attributesMap = await this.fetchAttributes(); } catch (e) {
            console.warn('Cannot fetch magento attributes metadata');
        }

        for (let customAttribute of product.custom_attributes || []) {
            const attributeMetadata = attributesMap[customAttribute.attribute_code];
            let attributeValue = customAttribute.value;
            if (attributeMetadata.frontend_input === 'multiselect') {
                try {
                    attributeValue = attributeValue.split(',');
                } catch (e) {}
            }

            Object.assign(product, { [customAttribute.attribute_code]: attributeValue });
        }

        delete product['custom_attributes'];
    }
}

module.exports = ProductNewAdapter;
