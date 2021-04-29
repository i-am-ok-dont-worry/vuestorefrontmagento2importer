'use strict';

let AbstractMagentoAdapter = require('./abstract');

class TaxruleAdapter extends AbstractMagentoAdapter {

  getEntityType() {
    return 'taxrule';
  }

  getName() {
    return 'adapters/magento/TaxrulesAdapter';
  }

  getSourceData(context) {
    return this.api.taxRules.list()
        .then((res) => {
          if (context.ids && context.ids instanceof Array && context.ids.length > 0) {
            const items = res.items.filter(item => context.ids.map(id => parseInt(id, 10)).includes(item.id));
            return { ...res, items };
          } else {
            return res;
          }
        });
  }

  getLabel(source_item) {
    return `[(${source_item.id}) ${source_item.code}]`;
  }

  isFederated() {
    return false;
  }

  preProcessItem(item) {
    return new Promise((done, reject) => {

      // TODO get tax rates for this tax rule
      let subPromises = []
      item.rates = []

      for (let ruleId of item.tax_rate_ids) {
        subPromises.push(new Promise((resolve, reject) => {
          this.api.taxRates.list(ruleId).then(function(result) {
            result.rate = parseFloat(result.rate)
            item.rates.push(result)
            resolve (result)
          })
        }))
      }

      Promise.all(subPromises).then(function(results) {
        return done(item);
      })
    });
  }

  prepareItems(items) {
    if(!items)
      return null;

    this.total_count = items.total_count;
    return items.items;
  }

  /**
   * We're transorming the data structure of item to be compliant with Smile.fr Elastic Search Suite
   * @param {object} item  document to be updated in elastic search
   */
  normalizeDocumentFormat(item) {
    return item;
  }
}

module.exports = TaxruleAdapter;
