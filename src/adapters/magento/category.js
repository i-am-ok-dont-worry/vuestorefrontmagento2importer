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
    this.generateUniqueUrlKeys = context.generateUniqueUrlKeys;
    this.extendedCategories = context.extendedCategories;

    if (context.ids && context.ids instanceof Array && context.ids.length > 0) {
      const promises = context.ids.map(id => this.api.categories.getSingle(id));
      return Promise.all(promises);
    }

    const cat = await this.api.categories.list();

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

    return uniqBy(expandChildren(cat), 'id');
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

      item.slug = item.url_key;
      item.url_path = item.url_path;

      if (this.extendedCategories) {
        this.expandCustomAttributes(item);
        return done(item);
      } else {
        return done(item);
      }

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
}

module.exports = CategoryAdapter;
