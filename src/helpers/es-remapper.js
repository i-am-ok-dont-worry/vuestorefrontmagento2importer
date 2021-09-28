const AdapterFactory = require('../adapters/factory');
const config = require('config');
const MappingUtils = require('./mapping-utils');

class ESRemapper {

    async updateElasticSearchMapping() {
        try {
            if (!this.db) {
                let factory = new AdapterFactory(config);
                this.db = factory.getAdapter('nosql', 'elasticsearch');
                await this.connectToES();
            }

            const attributes = await this.db.getDocuments('attribute', {}, 2000);
            const mapping = await MappingUtils.updateProductMapping(attributes, storeCode);
            await this.db.remapIndex('product', mapping);

            logger.info(`ES mapping updated`);
        } catch (e) {
            logger.error(`Error while updating mapping: ${e.message || e}`);
        }
    }

    connectToES() {
        return new Promise((resolve) => {
            this.db.connect(() => {
                resolve();
            });
        });
    }

    constructor(db) {
        this.db = db;
    }
}

module.exports = ESRemapper;
