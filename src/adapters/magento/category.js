'use strict';

let AbstractMagentoAdapter = require('./abstract');
const CacheKeys = require('./cache_keys');
const util = require('util');
const request = require('request');
const _slugify = require('../../helpers/slugify');

const _normalizeExtendedData = function (result, generateUrlKey = true, config = null) {
  if (result.custom_attributes) {
    for (let customAttribute of result.custom_attributes) { // map custom attributes directly to document root scope
      result[customAttribute.attribute_code] = customAttribute.value;
    }
    delete result.custom_attributes;
  }
  if (generateUrlKey) {
    result.url_key = _slugify(result.name) + '-' + result.id;
  }
  result.slug = result.url_key
  if (config.seo.useUrlDispatcher) {
    result.url_path = config.seo.categoryUrlPathMapper(result)
  } else {
    result.url_path = result.url_key;
  }
  return result
}

class CategoryAdapter extends AbstractMagentoAdapter {

  constructor (config) {
    super(config);
    this.extendedCategories = false;
    this.generateUniqueUrlKeys = true;
  }

  getEntityType() {
    return 'category';
  }

  getName() {
    return 'adapters/magento/CategoryAdapter';
  }

  getSourceData(context) {
    this.generateUniqueUrlKeys = context.generateUniqueUrlKeys;
    this.extendedCategories = context.extendedCategories;

    if (context.ids && context.ids instanceof Array && context.ids.length > 0) {
      const promises = context.ids.map(id => this.api.categories.getSingle(id));
      return Promise.all(promises);
    }

    return this.api.categories.list();
  }

  getLabel(source_item) {
    return `[(${source_item.id}) ${source_item.name}]`;
  }

  isFederated() {
    return false;
  }

  _addSingleCategoryData(item, result) {
    item = Object.assign(item, _normalizeExtendedData(result, this.generateUniqueUrlKeys, this.config));
    return item;
  }

  preProcessItem(item) {
    return new Promise(async (done, reject) => {
      if (!item) {
        return done(item);
      }

      if (!item.url_key || this.generateUniqueUrlKeys) {
        item.url_key = _slugify(item.name) + '-' + item.id
      }

      item.slug = item.url_key;
      item.url_path = item.url_key;

      /*if (this.config.seo.useUrlDispatcher) {
        item.url_path = this.config.seo.categoryUrlPathMapper(item)
      } else {
        item.url_path = item.url_key;
      }*/

      if (this.extendedCategories) {
        this.api.categories.getSingle(item.id).then((result) => {
          item = this._addSingleCategoryData(item, result);

          const key = util.format(CacheKeys.CACHE_KEY_CATEGORY, item.id);
          logger.info(`Storing extended category data to cache under: ${key}`);
          this.cache.set(key, JSON.stringify(item));

          if (item.children_data && item.children_data.length) {
            done(item);
          } else {
            done(item);
          }
        }).catch(function (err) {
          logger.error(err);
          reject(err);
        });

      } else {
        const key = util.format(CacheKeys.CACHE_KEY_CATEGORY, item.id);
        logger.info(`Storing category data to cache under: ${key}`);
        this.cache.set(key, JSON.stringify(item));
        return done(item);
      }

    });
  }

  prepareItems(items) {
    if(!items)
      return items;

    if (items.total_count)
      this.total_count = items.total_count;

    if (!Array.isArray(items))
      items = new Array(items);

    return items;
  }

  /**
   * We're transforming the data structure of item to be compliant with Smile.fr Elastic Search Suite
   * @param {object} item  document to be updated in elastic search
   */
  normalizeDocumentFormat(item) {
    if (this.config.vuestorefront && this.config.vuestorefront.invalidateCache) {
      request(this.config.vuestorefront.invalidateCacheUrl + 'C' + item.id, {}, (err, res, body) => {
        if (err) { return console.error(err); }
        console.log(body);
      });
    }
    return item;
  }
}

module.exports = CategoryAdapter;
