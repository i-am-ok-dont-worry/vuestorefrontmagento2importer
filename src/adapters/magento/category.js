'use strict';

let AbstractMagentoAdapter = require('./abstract');
const CacheKeys = require('./cache_keys');
const util = require('util');
const request = require('request');
const _slugify = require('../../helpers/slugify');
const uniqBy = require('lodash/uniqBy');

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

  getLabel(item) {
    return `[(${item.id}) - ${item.name}]`;
  }

  async getSourceData(context) {
    this.current_context = context;
    this.generateUniqueUrlKeys = context.generateUniqueUrlKeys;
    this.extendedCategories = context.extendedCategories;

    const expand = (root) => {
      let categories = [];

      const expandChildren = (item) => {
        categories.push(item);

        if (item.children_data && item.children_data.length > 0) {
          item.children_data.forEach(category => {
            categories.push(category);
            expandChildren(category);
          });
        }

        return categories;
      };

      expandChildren(root);

      return categories;
    };

    if (context.ids && context.ids instanceof Array && context.ids.length > 0) {
      const root = await this.api.categories.list();
      const flattenCategories = expand(root);
      let promises = await Promise.all(context.ids.map(id => this.api.categories.getSingle(id)));

      promises = promises.map(category => {
        const cat = flattenCategories.find(({ id }) => id == category.id);

        if (cat && cat.hasOwnProperty('product_count')) {
          return { ...category, product_count: cat.product_count };
        } else {
          return category;
        }
      });

      return promises;
    }

    const cat = await this.api.categories.list();

    return uniqBy(expand(cat), 'id');
  }

  getLabel(source_item) {
    return `[(${source_item.id}) ${source_item.name}]`;
  }

  isFederated() {
    return false;
  }

  expandCustomAttributes (item, result) {
    if (result ? result.custom_attributes : item.custom_attributes) {
      for (let customAttribute of result ? result.custom_attributes : item.custom_attributes) {
        item[customAttribute.attribute_code] = customAttribute.value;
      }
      delete item['custom_attributes'];
    }

    return item;
  }

  preProcessItem(item) {
    return new Promise(async (done, reject) => {
      if (!item) {
        return done(item);
      }

      try {
        if (!this.current_context.ids || !this.current_context.ids instanceof Array) {
          const single = await this.api.categories.getSingle(item.id);
          item = { ...item, ...single };


        }
      } catch (e) {}

      this.expandCustomAttributes(item);
      done(item);

    });
  }

  prepareItems(items) {
    if(!items)
      return items;

    if (items.total_count) {
      this.total_count = items.total_count;
    } else {
      this.total_count = items.length;
    }

    if (!Array.isArray(items))
      items = new Array(items);

    return items;
  }

  /**
   * We're transforming the data structure of item to be compliant with Smile.fr Elastic Search Suite
   * @param {object} item  document to be updated in elastic search
   */
  normalizeDocumentFormat(item) {
    return item;
  }

  storeToCache(item) {
    let key = util.format(CacheKeys.CACHE_KEY_CATEGORY, item.id);
    this.cache.set(key, JSON.stringify(item));
  }
}

module.exports = CategoryAdapter;
