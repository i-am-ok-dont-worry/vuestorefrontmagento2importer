'use strict';
const AbstractNosqlAdapter = require('./abstract');
const elasticsearch = require('@elastic/elasticsearch');
const AgentKeepAlive = require('agentkeepalive');
const MultiStoreUtils = require('../../helpers/multistore-utils');
const AgentKeepAliveHttps = require('agentkeepalive').HttpsAgent;


class ElasticsearchAdapter extends AbstractNosqlAdapter {

  validateConfig(config) {

    if (!config['elasticsearch']['host'])
      throw Error('elasticsearch.host must be set up in config');

    if (!config['elasticsearch']['port'])
      throw Error('elasticsearch.port must be set up in config');

    if (!config['elasticsearch']['index'])
      throw Error('db.index must be set up in config');

  }

  constructor(app_config) {
    super(app_config);

    this.config = app_config;
    this.db = null;
    this.validateConfig(this.config);

    logger.info('Elasticsearch module initialized!');
    this.updateDocument.bind(this);
  }

  /**
   * Get physical Elastic index name; since 7.x we're adding an entity name to get real index: vue_storefront_catalog_product, vue_storefront_catalog_category and so on
   * @param {*} baseIndexName
   * @param {*} config
   */
  getPhysicalIndexName(collectionName) {
    if (parseInt(this.config.elasticsearch.apiVersion) >= 6) {
      if (MultiStoreUtils.isDefaultStoreView(this.config.storeCode)) {
        return `${this.config.elasticsearch.index}_${collectionName}`;
      } else {
        return `${this.config.elasticsearch.index}_${this.config.storeCode}_${collectionName}`;
      }
    } else {
      return this.config.elasticsearch.index
    }
  }

  /**
   * Get physical Elastic type name; since 7.x index can have one type _doc
   * @param {*} baseIndexName
   * @param {*} config
   */
  getPhysicalTypeName(collectionName, config) {
    if (parseInt(config.elasticsearch.apiVersion) >= 6) {
      return `_doc`
    } else {
      return collectionName
    }
  }

  /**
   * Close the nosql database connection - abstract to the driver
   */
  close() { // switched to global singleton
    //this.db.close();
  }

  /**
   * Get documents
   * @param collectionName collection name
   * @param query query object
  */
  getDocuments(collectionName, queryBody, size) {
    return new Promise((resolve, reject) => {
      const searchQueryBody = {
        index: this.getPhysicalIndexName(collectionName),
        body: queryBody,
        ...(size && { size })
      };

      if (parseInt(this.config.elasticsearch.apiVersion) < 6)
       searchQueryBody.type  = this.getPhysicalTypeName(collectionName, this.config)

      this.db.search(searchQueryBody, function (error, { body: response }) {
        if (error) reject(error);
        if (response.hits && response.hits.hits) {
          resolve(response.hits.hits.map(h => h._source))
        } else {
          reject(new Error('Invalid Elastic response'))
        }
      });
    })
  }

  /**
   * Update single document in database
   * @param {object} item document to be updated in database
   */
  updateDocument(collectionName, item, force = false, callback = () => {}) {
    const itemtbu = item;
    const updateRequestBody = {
      index: this.getPhysicalIndexName(collectionName),
      id: item.id,
      body: {
        // put the partial document under the `doc` key
        upsert: itemtbu,
        doc: itemtbu
      }
    };

    if (parseInt(this.config.elasticsearch.apiVersion) < 6)
      updateRequestBody.type = this.getPhysicalTypeName(collectionName, this.config)

    const deleteRequestBody = {
      index: this.getPhysicalIndexName(collectionName),
      id: item.id
    };

    const update = () => {
      this.db.update(updateRequestBody, function (update_error, update_response) {
        callback(update_error, update_response);
      });
    };

    const deleteAndUpdate = () => {
      this.db.delete(deleteRequestBody, function (error, response) {
        update();
      });
    };

    if (force) {
      deleteAndUpdate();
    } else {
      update();
    }
  }

  /**
  * Remove records other than <record>.tsk = "transactionKey"
  * @param {String} collectionName
  * @param {int} transactionKey transaction key - which is usually a timestamp
  */
  cleanupByTransactionkey(collectionName, transactionKey) {

    if (transactionKey) {
      const query = {
        index: this.getPhysicalIndexName(collectionName),
        conflicts: 'proceed',
        body: {
          query: {
            bool: {
              must_not: {
                term: { tsk: transactionKey }
              }
            }
          }
        }
      };
      if (parseInt(this.config.elasticsearch.apiVersion) < 6)
        query.type = this.getPhysicalTypeName(collectionName, this.config)

      this.db.deleteByQuery(query, function (error, response) {
        if (error) throw new Error(error);
      });
    }
  }

  /**
   * Update multiple documents in database
   * @param {array} items to be updated
   */
  updateDocumentBulk(collectionName, items) {

    let requests = new Array();
    let index = 0;
    let bulkSize = 500;

    for (let doc of items) {
      const query = {
        _index: this.getPhysicalIndexName(collectionName),
        _id: doc.id,
      };
      if (parseInt(this.config.elasticsearch.apiVersion) < 6)
        query.type = this.getPhysicalTypeName(collectionName, this.config)

      requests.push({
        update: query
      });

      requests.push({

        // put the partial document under the `doc` key
        doc: doc,
        "doc_as_upsert": true

      });

      if ((index % bulkSize) == 0) {
        this.db.bulk({
          body: requests
        }, function (error, response) {
          if (error)
            throw new Error(error);
        });

        requests = new Array();
      }

      index++;
    }

  }

  /**
   * Returns sku's list of indexed products
   * @param {string} collectionName
   * @returns {Promise<{ id: string, sku: string }[]>}
   */
  async getProductSkus (collectionName = 'product') {
    let output = [];
    let scrollId;
    let scrollSize = 0;

    const searchToPromise = (query) => new Promise((resolve, reject) => {
      this.db.search(query, (err, res) => {
        scrollId = res.body['_scroll_id'];
        if (res && res.body && res.body.hits && res.body.hits.total) {
          scrollSize = res.body['hits']['total']['value'];
        }

        if (err) { reject(err); }
        if (res.body.hits) {
          resolve(res.body);
        } else {
          reject('Invalid Elastic response');
        }
      });
    });

    const mapEsResults = (hits) => {
      return hits.map(obj => {
        try {
          return { id: obj._source.id, sku: obj._source.sku }; // obj._source.sku;
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
    };

    const scrollResults = () => new Promise((resolve, reject) => {
      this.db.scroll({ scroll_id: scrollId, scroll: '2m' }, (err, res) => {
        if (err) { reject(err); }
        else {
          try {
            scrollId = res.body['_scroll_id'];
            scrollSize = res.body['hits']['hits'].length;
            resolve(mapEsResults(res.body.hits.hits));
          } catch (e) {
            resolve([]);
          }
        }
      });
    });

    const searchWithPagination = async (size = 10000) => {
      const searchQueryBody = {
        index: this.getPhysicalIndexName(collectionName),
        scroll: '2m',
        size,
        body: {
          query: { exists: { field: 'sku' } },
          sort: [{ "id": "asc" }],
        }
      };

      try {
       const { hits } = await searchToPromise(searchQueryBody);
       const docs = mapEsResults(hits.hits);

       return { docs };
      } catch (e) {
        // throw new Error('Unable to fetch product info');
        return { docs: [] };
      }
    };

    // Fetch first 10000 results then change fetch method to ES scroll
    const { docs } = await searchWithPagination();
    output = [...docs];

    while (scrollSize > 0) {
      output = [...output, ...await scrollResults()];
    }

    return output;
  }

  async getProductsSkus(ids = []) {
    return new Promise((resolve, reject) => {
      const searchQueryBody = {
        index: this.getPhysicalIndexName('product'),
        body: {
          query: { terms: { id: ids } },
          sort: [{ "id": "asc" }],
          size: 1000
        }
      };

      this.db.search(searchQueryBody, (err, res) => {
        try {
          const hits = res['body']['hits']['hits'];
          resolve(hits.map(h => h['_source']['sku']));
        } catch (e) {
          resolve([]);
        }
      });
    });
  }

  /**
   * Returns count of documents based on query
   * @param query
   */
  countDocuments(collectionName, query) {
    return new Promise((resolve, reject) => {
      const countQueryBody = {
        index: this.getPhysicalIndexName(collectionName),
        body: query
      };

      this.db.count(countQueryBody, (err, res) => {
        if (err) {
          resolve(null);
        } else {
          try {
            resolve(res.body.count);
          } catch (e) {
            resolve(0);
          }
        }
      });
    });
  }

  /**
   * Copies index content for source index to dest index
   * @param {string} sourceCollectionName
   * @param {string} destCollectionName
   * @returns {Promise<boolean>}
   */
  reindex(sourceCollectionName, destCollectionName) {
    return new Promise((resolve, reject) => {
      const reindexBody = {
        waitForCompletion: true,
        refresh: true,
        body: {
          source: {
            index: sourceCollectionName
          },
          dest: {
            index: destCollectionName
          }
        }
      };

      this.db.reindex(reindexBody, (err, res) => {
        if (err) {
          logger.error('Cannot copy index: ', err);
          reject(err);
        } else { resolve(res.body); }
      });
    });
  }

  /**
   * Creates a new ES index with predefined mapping
   * @param {string} collectionName
   * @param {object} mapping
   * @returns {Promise<any>}
   */
  createIndex(collectionName, mapping = {}) {
    return new Promise((resolve, reject) => {
      const createIndexBody = {
        index: collectionName,
        body: mapping
      };

      this.db.indices.create(createIndexBody, (err, res) => {
        if (err) {
          logger.error('Cannot create index: ', err);
          reject(err);
        } else { resolve(res); }
      });
    });
  }

  /**
   * Deletes index
   * @param {string} collectionName
   * @returns {Promise<boolean>}
   */
  deleteIndex(collectionName) {
    return new Promise((resolve, reject) => {
      const deleteIndexBody = {
        index: collectionName
      };

      this.db.indices.delete(deleteIndexBody, (err, res) => {
        if (err) {
          logger.error('Cannot delete index: ', err.message || err);
          resolve();
        } else { resolve(true); }
      });
    });
  }

  /**
   * Creates a new mapping for index
   * @param {string} collectionName
   * @param {object} mapping
   * @returns {Promise<true>}
   */
  remapIndex(collectionName, mapping = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        logger.info(`Reindexing physical index ${this.getPhysicalIndexName(collectionName)}`);
        try { await this.deleteIndex(this.getPhysicalIndexName(`${collectionName}_temp`)); } catch (e) {}
        await this.createIndex(this.getPhysicalIndexName(`${collectionName}_temp`), mapping);
        await this.reindex(this.getPhysicalIndexName(collectionName), this.getPhysicalIndexName(`${collectionName}_temp`));
        await this.deleteIndex(this.getPhysicalIndexName(collectionName));
        await this.createIndex(this.getPhysicalIndexName(collectionName), mapping);
        const result = await this.reindex(this.getPhysicalIndexName(`${collectionName}_temp`), this.getPhysicalIndexName(collectionName));
        logger.info(`Reindex complete for index ${this.getPhysicalIndexName(collectionName)}. Took: ${result.took}ms. Created: ${result.created} documents.`);

        resolve(true);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Connect / prepare driver
   * @param {Function} done callback to be called after connection is established
   */
  connect(done) {

    if (!global.es) {
      this.db = new elasticsearch.Client({
        node: `${this.config.elasticsearch.protocol || 'http'}://${this.config.elasticsearch.host}:${this.config.elasticsearch.port || 9200}`,
        log: 'debug',
        apiVersion: this.config.elasticsearch.apiVersion,

        maxRetries: 10,
        keepAlive: true,
        maxSockets: 10,
        minSockets: 10,
        requestTimeout: 1800000,

        createNodeAgent: function (connection, config) {
          if (connection.useSsl) {
            return new AgentKeepAliveHttps(connection.makeAgentConfig(config));
          }
          return new AgentKeepAlive(connection.makeAgentConfig(config));
        }

      });
      global.es = this.db;
    } else
      this.db = global.es;

    done(this.db);
  }

}

module.exports = ElasticsearchAdapter;
