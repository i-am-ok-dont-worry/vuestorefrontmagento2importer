'use strict';
let AbstractMagentoAdapter = require('./abstract');
const util = require('util');

class ProductNewAdapter extends AbstractMagentoAdapter {

    constructor (config) {
        super(config);
        this.use_paging = true;
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
        }else if (context.skus && context.skus.length > 0) { // pull individual products by skus
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
            .then((product) => {
                this.mapCustomAttributesToObjectRoot(product);
                this.processStocks(product);
                this.processMedia(product);
                this.processBundleOptions(product);

                logger.info(`Product ${product.sku} imported`);
                return product;
            });
    }

    mapCustomAttributesToObjectRoot (item) {
        for (let customAttribute of item.custom_attributes || []) {
            Object.assign(item, { [customAttribute.attribute_code]: customAttribute.value });
        }
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
                max_sale_qty: stock_item.max_sale_qty
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
                    image: mediaItem.file,
                    pos: mediaItem.position,
                    typ: mediaItem.media_type,
                    lab: mediaItem.label,
                    vid: this.computeVideoData(mediaItem)
                });
            }

            Object.assign(item, { media_gallery });
            delete item['media_gallery_entries'];
            return item;
        } catch (e) {
            logger.warn(`Unable to retrieve media gallery info`);
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
}

module.exports = ProductNewAdapter;
