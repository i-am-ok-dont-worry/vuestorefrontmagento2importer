'use strict';

let AbstractMagentoAdapter = require('./abstract');
const CacheKeys = require('./cache_keys');
const util = require('util');
const uniqBy = require('lodash/uniqBy');

class AttributeAdapter extends AbstractMagentoAdapter {

  getEntityType() {
    return 'attribute';
  }

  getName() {
    return 'adapters/magento/AttributeAdapter';
  }

  async getAttributeSets() {
    try {
      const { items } = await this.api.attributes.attributeSetList();
      const attributeSetIds = items.map(i => i.attribute_set_id);
      let attributes = [];

      for (let i=0; i<attributeSetIds.length; i++) {
        try {
          const response = await this.api.attributes.attributeSetOptions(attributeSetIds[i]);

          if (response && response.length) {
            const extendedAttributes = response.map(a => ({ ...a, attribute_set_id: attributeSetIds[i] }));
            attributes.push(...extendedAttributes);
          }
        } catch (e) {}
      }

      this.attributes = uniqBy(attributes, 'attribute_id');
      return this.attributes;
    } catch (e) {
      return [];
    }
  }

  getAttributeSetById(attributeId) {
    const attribute = (this.attributes || []).find(a => String(a.attribute_id) === String(attributeId));
    return attribute ? attribute.attribute_set_id : null;
  }

  getSourceData(context) {
    return this.api.attributes.list()
        .then(async (res) => {
          await this.getAttributeSets();

          if (context.ids && context.ids instanceof Array && context.ids.length > 0) {
            const items = res.items.filter(item => context.ids.map(id => parseInt(id, 10)).includes(item.attribute_id));
            return { ...res, items: items.map(i => ({ ...i, id: i.attribute_id })) }
          } else {
            return { ...res, items: res.items.map(i => ({ ...i, id: i.attribute_id })) }
          }
        });
  }

  /**  Regarding Magento2 api docs and reality we do have an exception here that items aren't listed straight in the response but under "items" key */
  prepareItems(items) {
    if (!items)
      return items;

    if (items.total_count)
      this.total_count = items.total_count;

    if(items.items)
      items = items.items; // this is an exceptional behavior for Magento2 api  for attributes

    return items;
  }

  getLabel(source_item) {
    return `[(${source_item.attribute_code}) ${source_item.default_frontend_label}]`;
  }

  isFederated() {
    return false;
  }

  preProcessItem(item) {
    return new Promise((done, reject) => {
      if (item) {
        item.id = item.attribute_id;
        item.attribute_set_id = this.getAttributeSetById(item.id);

        // store the item into local redis cache
        let key = util.format(CacheKeys.CACHE_KEY_ATTRIBUTE, item.attribute_code);
        // logger.info(`Storing attribute data to cache under: ${key}`);
        this.cache.set(key, JSON.stringify(item));

        key = util.format(CacheKeys.CACHE_KEY_ATTRIBUTE, item.attribute_id); // store under attribute id as an second option
        // logger.info(`Storing attribute data to cache under: ${key}`);
        this.cache.set(key, JSON.stringify(item));
      }

      return done(item);
    });
  }

  /**
   * We're transorming the data structure of item to be compliant with Smile.fr Elastic Search Suite
   * @param {object} item  document to be updated in elastic search
   */
  normalizeDocumentFormat(item) {
    return item;
  }
}

module.exports = AttributeAdapter;
