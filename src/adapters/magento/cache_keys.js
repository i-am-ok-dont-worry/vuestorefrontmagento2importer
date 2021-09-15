var config = require('config')

module.exports = {
  CACHE_KEY_CATEGORY: config.elasticsearch.index + '_cat_%s',
  CACHE_KEY_PRODUCT: config.elasticsearch.index + '_prd_%s',
  CACHE_KEY_PRODUCT_CATEGORIES: config.elasticsearch.index + '_prd_cat_%s',
  CACHE_KEY_PRODUCT_CATEGORIES_TEMPORARY: config.elasticsearch.index + '_prd_cat_ts_%s',
  CACHE_KEY_ATTRIBUTE: config.elasticsearch.index + '_attr_%s',
  CACHE_KEY_STOCKITEM: config.elasticsearch.index + '_stock_%s'
}
