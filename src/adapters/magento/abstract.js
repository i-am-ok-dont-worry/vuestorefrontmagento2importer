'use strict';

let AbstractAdapter = require('../abstract');
let AbstractAdapterNew = require('../abstract-new');

class AbstractMagentoAdapter extends AbstractAdapterNew { // extends AbstractAdapter{

  constructor(config){
    super(config);

    let Magento2Client = require('./magento2-rest-client').Magento2Client;
    this.api = Magento2Client(this.config.magento);
  }

  getEntityType(){
    throw new Error('getEntityType must be implemented');
  }

  getCollectionName(useSwapped = false){
    if (useSwapped && this['getSwappedEntityType'] && typeof this['getSwappedEntityType'] === 'function') { return this['getSwappedEntityType'](); }
    return this.getEntityType();
  }

  validateConfig(config){

      super.validateConfig(config);

      if(!config['magento']['url'] ||
         !config['magento']['consumerKey'] ||
         !config['magento']['consumerSecret'] ||
         !config['magento']['accessToken'] ||
         !config['magento']['accessTokenSecret'])
             throw Error('magento.{url,consumerKey,consumerSecret,accessToken,accessTokenSecret} must be set in config');
  }

  isValidFor(entity_type){
    return (entity_type == this.getEntityType());
  }

  getSourceData(){
    throw new Error('getSourceData must be implemented');
  }

  getLabel(source_item){
    return source_item.id;
  }

  /**
   * We're transorming the data structure of item to be compliant with Smile.fr Elastic Search Suite
   * @param {object} item  document to be updated in elastic search
   */
  normalizeDocumentFormat(item) {
    return item;
  }

  /**
   * Methods which runs after all processes has complete
   * to handle errored jobs
   */
  rerunUnstable () {
    return Promise.resolve();
  }

}

module.exports = AbstractMagentoAdapter;
