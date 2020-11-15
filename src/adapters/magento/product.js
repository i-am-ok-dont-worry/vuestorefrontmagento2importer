'use strict';

let AbstractMagentoAdapter = require('./abstract');
const util = require('util');
const CacheKeys = require('./cache_keys');
const moment = require('moment')
const _ = require('lodash')
const request = require('request');
const HTTP_RETRIES = 3
let kue = require('kue');
const UnstableProductsQueue = kue.createQueue();
const UNSTABLE_PRODUCTS_QUEUE_TYPE = 'mage2-product-import-unstable';
const _slugify = require('../../helpers/slugify');

const optionLabel = (attr, optionId) => {
  if (attr) {
    let opt = attr.options.find((op) => { // TODO: cache it in memory
      if (_.toString(op.value) === _.toString(optionId)) {
        return op
      }
    }) // TODO: i18n support with multi website attribute names
    return opt ? opt.label : optionId
  } else {
    return optionId
  }
};

class ProductAdapter extends AbstractMagentoAdapter {

  constructor(config) {
    super(config);
    this.use_paging = true;
    this.stock_sync = true;
    this.custom_sync = true;
    this.parent_sync = true;
    this.media_sync = true;
    this.category_sync = true;
    this.links_sync = true;
    this.configurable_sync = true;
    this.is_federated = true; // by default use federated behaviour
  }

  getEntityType() {
    return 'product';
  }

  getName() {
    return 'adapters/magento/ProductAdapter';
  }

  prepareItems(items) {
    if(!items)
      return null;

    this.total_count = items.total_count;

    if (this.use_paging) {
      this.page_count = Math.ceil(this.total_count / this.page_size);
      logger.info('Page count', this.page_count)
    }

    return items.items;
  }

  getFilterQuery(context) {
    let query = '';

    if (context.skus) { // pul individual products
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

  getSourceData(context) {
    const that = this;
    const retryHandler = (context, err, reject) => {
      context.retry_count = context.retry_count ? context.retry_count + 1 : 1;
      if (err == null || context.retry_count < HTTP_RETRIES ) {
        if (err) {
          logger.error(err);
          logger.info('Retrying getSourceData() request ' + context.retry_count);
        }

        if (this.config.product && this.config.product.synchronizeCatalogSpecialPrices) {
          return new Promise((resolve, reject) => {
            this.getProductSourceData(context)
                .then((result) => {
                  // download rendered list items
                  const products = result.items;
                  let skus = products.map((p) => { return p.sku });

                  if (products.length === 1) { // single product - download child data
                    const childSkus = _.flattenDeep(products.map((p) => { return (p.configurable_children) ? p.configurable_children.map((cc) => { return cc.sku }) : null }))
                    skus = _.union(skus, childSkus);
                  }

                  const query = '&searchCriteria[filter_groups][0][filters][0][field]=sku&' +
                  'searchCriteria[filter_groups][0][filters][0][value]=' + encodeURIComponent(skus.join(',')) + '&' +
                  'searchCriteria[filter_groups][0][filters][0][condition_type]=in';

                  this.api.products.renderList(query, this.config.magento.storeId, this.config.magento.currencyCode)
                      .then(renderedProducts => {
                        context.renderedProducts = renderedProducts;
                        for (let product of result.items) {
                          const productAdditionalInfo = renderedProducts.items.find(p => p.id === product.id)

                          if (productAdditionalInfo && productAdditionalInfo.price_info) {
                            delete productAdditionalInfo.price_info.formatted_prices;
                            delete productAdditionalInfo.price_info.extension_attributes;
                            // delete productAdditionalInfo.price_info.special_price
                            product = Object.assign(product, productAdditionalInfo.price_info);

                            if (product.final_price < product.price) {
                              product.special_price = product.final_price;
                            }

                            if (this.config.product.renderCatalogRegularPrices) {
                              product.price = product.regular_price;
                            }
                          }
                        }

                        resolve(result);
                      });

                })
                .catch(err => {
                  retryHandler(context, err, reject)
                });
          });
        } else {
          return this.getProductSourceData(context)
            .catch(err => {
              retryHandler(context, err, null)
            });
        }
      } else {
        if (reject) {
          reject(err);
        } else {
          throw err;
        }
      }
    };

    // run the import logic
    return retryHandler(context, null, null)
  }

  getProductSourceData(context) {
    let query = this.getFilterQuery(context);
    let searchCriteria = '&searchCriteria[currentPage]=%d&searchCriteria[pageSize]=%d';

    if(this.config.product && JSON.parse(this.config.product.excludeDisabledProducts)) {
      searchCriteria += '&searchCriteria[filterGroups][0][filters][0][field]=status'+
                        '&searchCriteria[filterGroups][0][filters][0][value]=1';
    }

    if (typeof context.stock_sync !== 'undefined') {
      this.stock_sync = context.stock_sync;
    }

    if (typeof context.parent_sync !== 'undefined') {
      this.parent_sync = context.parent_sync;
    }

    if (typeof context.category_sync !== 'undefined') {
      this.category_sync = context.category_sync;
    }

    if (typeof context.configurable_sync !== 'undefined') {
      this.configurable_sync = context.configurable_sync;
    }

    if (context.for_total_count) { // get total counts
      return this.api.products.list(util.format(searchCriteria, 1, 1)).catch((err) => {
        throw new Error(err);
      });
    } else if (context.page && context.page_size) {

      this.use_paging = context.use_paging || false
      this.is_federated = context.use_paging ? false : true;
      this.page = context.page;
      this.page_size = context.page_size
      if (!context.use_paging) this.page_count = 1; // process only one page - used for partitioning purposes

      return this.api.products.list(util.format(searchCriteria, context.page, context.page_size) + (query ? '&' + query : ''))
          .then((res) => {
            return res;
          })
          .catch((err) => {
            throw new Error(err);
          });

    } else if (this.use_paging) {
      this.is_federated = false; // federated execution is not compliant with paging
      logger.info(util.format(searchCriteria, this.page, this.page_size) + (query ? '&' + query : ''));
      return this.api.products.list(util.format(searchCriteria, this.page, this.page_size) + (query ? '&' + query : ''))
          .catch((err) => {
            throw new Error(err);
          })
          .then((res) => {
            return res;
          });
    } else {
      return this.api.products.list().catch((err) => {
        throw new Error(err);
      });
    }
  }

  getTotalCount(context) {
    context = context ? Object.assign(context, { for_total_count: 1 }) : { for_total_count: 1 };
    return this.getSourceData(context); //api.products.list('&searchCriteria[currentPage]=1&searchCriteria[pageSize]=1');
  }

  getLabel(source_item) {
    return `[(${source_item.id} - ${source_item.sku}) ${source_item.name}]`;
  }

  isNumeric(value) {
    return /^\d+$/.test(value);
  }

  /**
   *
   * @param {Object} item
   */
  preProcessItem(item) {
    for (let customAttribute of item.custom_attributes || []) { // map custom attributes directly to document root scope
      let valueArray = String(customAttribute['value']).split(',');
      let attrValue = valueArray.map(Number);
      if (valueArray.length > 1){
        for (let element of valueArray){
          if (!this.isNumeric(element)) {
            attrValue = customAttribute.value;
            break;
          }
        }
      } else {
        attrValue = customAttribute.value;
      }

      item[customAttribute.attribute_code] = attrValue;
    }

    item.slug = _slugify(item.name + '-' + item.id);

    return new Promise((done, reject) => {
      // TODO: add denormalization of productcategories into product categories
      // DO NOT use "productcategories" type but rather do search categories with assigned products

      const syncPromises = [
          this.processStocks(item),
          this.processMedia(item),
          this.processCustomOptions(item),
          this.processBundleOptions(item),
          this.processProductLinks(item),
          this.processParentProductLink(item),
          this.processConfigurableAndBundle(item),
          this.processAttributesMetadata(item),
          this.processCategories(item)
      ];

      Promise.all(syncPromises)
        .then(() => {
          logger.info(`Product sub-stages done for ${item.sku}`);
          return done(item);
        }).catch(err => {
          logger.warn(`Item ${item.sku} was marked unstable due to partial failure and was added to further processing queue`);
          UnstableProductsQueue.createJob(UNSTABLE_PRODUCTS_QUEUE_TYPE, { type: item.sku, ...item }).attempts(2).save();
          reject(err);
        });
    });
  }

  /**
   * Applies stock info to the product
   * @param item Current product
   * @returns {Promise<Product>}
   */
  processStocks (item) {
    // STOCK SYNC
    if (this.stock_sync) {
      return this.api.stockItems.list(item.sku)
        .then((result) => {
          item.stock = result;

          if (this.config.magento.msi.enabled) {
            return this.api.stockItems.getSalableQty(item.sku, this.config.magento.msi.stockId).then((salableQty) => {
              item.stock.qty = salableQty;
              return item;
            }).then((item) => {
              return this.api.stockItems.isSalable(item.sku, this.config.magento.msi.stockId).then((isSalable) => {
                item.stock.is_in_stock = isSalable;

                const key = util.format(CacheKeys.CACHE_KEY_STOCKITEM, item.id);
                this.cache.set(key, JSON.stringify(item.stock));

                return item;
              })
            })
          } else {
            const key = util.format(CacheKeys.CACHE_KEY_STOCKITEM, item.id);
            this.cache.set(key, JSON.stringify(result));

            return item;
          }
        });
    } else {
      return Promise.resolve(item);
    }
  }

  /**
   * Applies media gallery to the product
   * @param item Current product
   * @returns {Promise<Product>}
   */
  processMedia (item) {
    // MEDIA SYNC
    if (this.media_sync) {
      return this.api.productMedia.list(item.sku)
        .then((result) => {
          let media_gallery = [];
          for (let mediaItem of result) {
            if (!mediaItem.disabled) {
              media_gallery.push({
                image: mediaItem.file,
                pos: mediaItem.position,
                typ: mediaItem.media_type,
                lab: mediaItem.label,
                vid: this.computeVideoData(mediaItem)
              })
            }
          }
          item.media_gallery = media_gallery;
          return item;
        })
        .catch(() => {
          item.media_gallery = [];
          return item;
        });
    } else {
      return Promise.resolve(item);
    }
  }

  /**
   * Applies custom options to the product
   * @param item
   * @returns {Promise<Product>}
   */
  processCustomOptions (item) {
    // CUSTOM OPTIONS SYNC
    if (this.custom_sync) {
      return this.api.customOptions.list(item.sku)
        .then((result) => {
          if (result && result.length > 0) {
            item.custom_options = result;
          }
          return item;
        })
        .catch(() => {
          item.custom_options = [];
          return item;
        });
    } else {
      return Promise.resolve(item);
    }
  }

  /**
   * Applies bundle options to the product
   * @param item Current product
   * @returns {Promise<Product>}
   */
  processBundleOptions (item) {
    // BUNDLE OPTIONS SYNC
    if (this.custom_sync && item.type_id == 'bundle') {
      return this.api.bundleOptions.list(item.sku)
        .then((result) => {
          if(result && result.length > 0) {
            item.bundle_options = result;
          }
          return item;
        })
        .catch(() => {
          item.bundle_options = [];
          return item;
        });
    } else {
      return Promise.resolve(item);
    }
  }

  /**
   * Applies product links to the product
   * @param item
   * @returns {Promise<Product>}
   */
  processProductLinks (item) {
    // PRODUCT LINKS - as it seems magento returns these links anyway in the "product_links"
    if (this.links_sync) {
      item.links = {};
      return new Promise((resolve, reject) => {

        return this.api.productLinks.types().then((result) => {
          if (result && result.length > 0) {
            let subPromises = [];
            for (const linkType of result) {
              subPromises.push(this.api.productLinks.list(item.sku, linkType.name).then((links) => {
                if (links && links.length > 0) {
                  item.links[linkType.name] = links.map((r) => {
                    return { sku: r.linked_product_sku, pos: r.position };
                  });
                }

                return item;
              }));
            }

            Promise.all(subPromises).then(() => {
              resolve(item)
            }).catch((err) => {
              logger.error(err);
              resolve(item);
            });

          } else {
            resolve(item);
          }

          return item;
        });
      });
    } else {
      return Promise.resolve(item);
    }
  }

  /**
   * Link parent product to the current one
   * Find product that contains this product in configurable_children array
   * and then schedule this product for update
   *
   * @param item
   * @returns {Promise<Product>}
   */
  processParentProductLink (item) {
    // Link parent product
    if (this.parent_sync && (item.type_id == 'simple')) {
      return new Promise ((resolve, opReject) => {

        // Find the parent product and schedule a sync after subsequent configurable_children got modified
        this.db.getDocuments(this.getCollectionName(), { query: { match: {'configurable_children.sku': item.sku } }})
          .then((docs) => {
            if (docs && docs.length > 0) {
              let queue = kue.createQueue(Object.assign(this.config.kue, { redis: this.config.redis }));

              docs.map(parentProduct => { // schedule for update
                queue.createJob('product', { skus: [parentProduct.sku], adapter: 'magento' }).save();
                logger.info('Parent product update scheduled (make sure `cli.js productsworker` queue is running)', parentProduct.sku);
              });

              resolve(item);
            } else {
              resolve(item);
            }
          })
          .catch(err => {
            logger.error(err);
            resolve(item);
          });

      });
    } else {
      return Promise.resolve(item);
    }
  }

  /**
   * Appends configurable options, configurable children
   * to the product
   * @param item Product
   * @returns {Promise<Product>}
   */
  processConfigurableAndBundle (item) {
    // CONFIGURABLE AND BUNDLE SYNC
    if (this.configurable_sync && (item.type_id == 'configurable')) {
      return new Promise ((resolve, opReject) => {
        this.api.configurableChildren.list(item.sku).then((result) => {
          item.configurable_children = new Array();

          // Find configurable children
          for (let prOption of result) {
            let confChild = {
              sku: prOption.sku,
              id: prOption.id,
              status: prOption.status,
              visibility: prOption.visibility,
              name: prOption.name,
              price: prOption.price,
              tier_prices: prOption.tier_prices,
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

                if(this.config.product.renderCatalogRegularPrices) {
                  confChild.price = confChild.regular_price;
                }

              }
            }

            item.configurable_children.push(confChild);

            if(item.price  == 0) { // if price is zero fix it with first children
              item.price = prOption.price;
            }
          }

          // EXPAND CONFIGURABLE CHILDREN ATTRS
          if (this.config.product && this.config.product.expandConfigurableFilters) {
            for (const attrToExpand of this.config.product.expandConfigurableFilters) {
              const expandedSet = new Set();

              if (item[attrToExpand]) {
                expandedSet.add(item[attrToExpand]);
              }

              for (const confChild of item.configurable_children) {
                if (confChild[attrToExpand]) {
                  expandedSet.add(confChild[attrToExpand]);
                }
              }

              if (expandedSet.size > 0) {
                item[attrToExpand + '_options'] = Array.from(expandedSet);
              }
            }
          }

          // Find configurable options
          this.api.configurableOptions.list(item.sku)
              .then((result) => {
                item.configurable_options = result;

                let subPromises = [];
                for (let option of item.configurable_options) {
                  let atrKey = util.format(CacheKeys.CACHE_KEY_ATTRIBUTE, option.attribute_id);

                  subPromises.push(new Promise ((resolve, reject) => {
                    this.cache.get(atrKey, (err, serializedAtr) => {
                      let atr = JSON.parse(serializedAtr); // category object
                      if (atr != null) {
                        option.attribute_code = atr.attribute_code;
                        option.values.map((el) => {
                          el.label = optionLabel(atr, el.value_index);
                        });

                        item[atr.attribute_code + '_options'] = option.values.map((el) => { return el.value_index } )
                      }

                      resolve(item);
                    });
                  }));
                }

                Promise.all(subPromises)
                    .then(() => {
                      resolve(item);
                    })
                    .catch(() => resolve(item));

              })
              .catch((err) => {
                logger.error(err);
                resolve(item);
              });

        }).catch((err) => {
          logger.error(err);
          resolve(item);
        });
      });
    } else {
      return Promise.resolve(item);
    }
  }

  /**
   * Appends attributes metadata and custom attributes
   * @param item
   * @returns {Promise<Product>}
   */
  processAttributesMetadata (item) {
    return new Promise((resolve) => {
      this.processAttributes(item.custom_attributes, item.configurable_options || [])
          .then(res => {
            item.attributes_metadata = res;
            item.custom_attributes = null;
            resolve(item);
          })
          .catch(() => {
            resolve(item);
          });
    });
  }

  /**
   * Appends category metadata to the product
   * @param item
   * @returns {Promise<Product>}
   */
  processCategories (item) {
    // CATEGORIES SYNC
    return new Promise(async (resolve, reject) => {
        const key = util.format(CacheKeys.CACHE_KEY_PRODUCT_CATEGORIES, item.sku); // store under SKU of the product the categories assigned

        if(this.category_sync) {
          item.category = new Array();

          const catBinder = (categories) => {

            let catPromises = new Array();
            for (let catId of categories) {
              catPromises.push(
                  new Promise((innerResolve) => {
                    this.cache.get(util.format(CacheKeys.CACHE_KEY_CATEGORY, catId), (err, serializedCat) => {
                      let parsedCat = JSON.parse(serializedCat); // category object
                      if (parsedCat != null) {
                        innerResolve({
                          category_id: parsedCat.id,
                          name: parsedCat.name,
                          slug: parsedCat.slug,
                          path: parsedCat.url_path
                        });
                      } else {
                        innerResolve({
                          category_id: catId
                        });
                      }
                    });
                  })
              );
            }

            Promise.all(catPromises)
              .then((values) => {
                if(this.category_sync) // TODO: refactor the code above to not get cache categorylinks when no category_sync required
                  item.category = values; // here we get configurable options

                if (this.config.seo.useUrlDispatcher) {
                  item.url_path = this.config.seo.productUrlPathMapper(item);
                }

                resolve(item);
              })
              .catch(() => {
                resolve(item);
              });
          };

          if (item.category_ids && Array.isArray(item.category_ids) && item.category_ids.length > 0) {
            const catIdsArray = item.category_ids.map(item => parseInt(item));
            await catBinder(catIdsArray);
          } else {
            this.cache.smembers(key, async (err, categories) => {
              if (categories == null) {
                resolve(item);
              }
              else {
                await catBinder(categories);
              }
            });
          }
        } else {
          resolve(item);
        }
    });
  }

  /**
   * Handle attributes processing
   * @param customAttributes
   * @param configurableOptions
   * @returns {Promise<{Product}>}
   */
  processAttributes(customAttributes = [], configurableOptions = []) {
    const loadFromCache = (key) => new Promise((resolve) =>
        this.cache.get(key, (err, serializedAtr) => resolve(JSON.parse(serializedAtr)))
    );
    const findConfigurableOptionsValues = attributeId => {
      const attribute = configurableOptions.find(opt => parseInt(opt.attribute_id) === parseInt(attributeId));

      if (attribute) {
        return attribute.values.map(val => parseInt(val.value_index));
      }

      return [];
    };

    const findCustomAttributesValues = (attributeCode) => {
      const attribute = customAttributes.find(
          opt => opt.attribute_code === attributeCode
      );

      return attribute ? [parseInt(attribute.value)] : []
    };

    const findOptionValues = option => {
      if (!option) { return []; }
      return ([
        ...findConfigurableOptionsValues(option.attribute_id),
        ...findCustomAttributesValues(option.attribute_code)
      ]);
    };

    const selectFields = (res) => res.map(o => {
      const attributeOptionValues = findOptionValues(o);
      const options = o.options.filter(opt => attributeOptionValues.includes(parseInt(opt.value)));

      return {
        is_visible_on_front: o.is_visible_on_front,
        is_visible: o.is_visible,
        default_frontend_label: o.default_frontend_label,
        attribute_id: o.attribute_id,
        entity_type_id: o.entity_type_id,
        id: o.id,
        frontend_input: o.frontend_input,
        is_user_defined: o.is_user_defined,
        is_comparable: o.is_comparable,
        attribute_code: o.attribute_code,
        slug: o.slug,
        options
      };
    });

    const attributeCodes = (customAttributes || []).map(obj => new Promise((resolve) => {
      const key = util.format(CacheKeys.CACHE_KEY_ATTRIBUTE, obj.attribute_code);
      loadFromCache(key).then(resolve);
    }));

    const attributeIds = (configurableOptions || []).map(obj => new Promise((resolve) => {
      const key = util.format(CacheKeys.CACHE_KEY_ATTRIBUTE, obj.attribute_id);
      loadFromCache(key).then(resolve);
    }));

    return Promise.all([
      ...attributeCodes,
      ...attributeIds
    ])
    .then(selectFields);
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

  /**
   * We're transorming the data structure of item to be compliant with Smile.fr Elastic Search Suite
   * @param {object} item  document to be updated in elastic search
   */
  normalizeDocumentFormat(item) {
    if (this.config.vuestorefront && this.config.vuestorefront.invalidateCache) {
      request(this.config.vuestorefront.invalidateCacheUrl + 'P' + item.id, {}, (err, res, body) => {
        if (err) { return console.error(err); }
        try {
          if (body && JSON.parse(body).code !== 200) console.log(body);
        } catch (e) {
          return console.error('Invalid Cache Invalidation response format', e)
        }
      });
    }

    let resultItem = Object.assign(item, {
    // "price": prices, // ES stores prices differently
    // TODO: HOW TO GET product stock from Magento API call for product?
    });
    return resultItem;
  }


  async rerunUnstable () {
    const isEmpty = () => {
      return new Promise((eResolve) => {
        UnstableProductsQueue.inactiveCount(UNSTABLE_PRODUCTS_QUEUE_TYPE, (err, inactive) => {
          eResolve(!inactive);
        });
      });
    };

    if (await isEmpty()) { return Promise.resolve(); }

    return new Promise((resolve, reject) => {
      UnstableProductsQueue.process(UNSTABLE_PRODUCTS_QUEUE_TYPE, 1, (job, done) => {
        const item = job.data;
        this.preProcessItem(item)
            .then(result => {
              // Invalidate document in elasticsearch and update it once again
              if (this.update_document) {
                this.db.updateDocument(this.getCollectionName(), this.normalizeDocumentFormat(result), (err, res) => {
                  if (err) {
                    logger.error(res.body ? res.body.error.reason : JSON.stringify(res));
                  } else {
                    done();
                  }
                });
              } else {
                logger.info('Skipping database update');
                done();
              }
            })
            .catch((err) => logger.error(`Unable to rerun process on element ${item.sku}`, err));
      });

      UnstableProductsQueue.on('job complete', (jobId) => {
        // Count inactive tasks to check if queue is complete
        UnstableProductsQueue.inactiveCount(UNSTABLE_PRODUCTS_QUEUE_TYPE, (err, inactive) => {
          if (inactive === 0) {
            reject();
          } else {
            logger.info(`Unstable tasks count: `, inactive);
          }
        });

        // Remove successfull job from queue
        kue.Job.get(jobId, (err, job) => {
          if (err) return;
          job.remove((err) => {
            if (err) throw err;
          });
        });
      });

    });
  }
}

module.exports = ProductAdapter;
