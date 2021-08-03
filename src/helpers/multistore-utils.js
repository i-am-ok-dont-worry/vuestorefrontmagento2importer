const config = require('config');

class MultiStoreUtils {

    static getStoreCode() {
        try {
            // Support for next api
            if (config.hasOwnProperty('storeViews')) {
                return config.storeViews.default_store_code;
            }

            const [defaultStore] = config.availableStores || ['all'];
            const storeView = config['storeViews'][defaultStore];

            return storeView.storeCode || 'all';
        } catch (e) {
            return 'all';
        }
    }

    static isDefaultStoreView(storeView) {
        try {
            if (!storeView || storeView.length === 0) { return true; }
            if (storeView === 'all') { return true; }
            // Support for next-api
            if (config.hasOwnProperty('storeViews')) {
                return storeView === config.storeViews.default_store_code;
            }

            const [defaultStore] = config.availableStores || ['all'];
            return defaultStore === storeView;
        } catch (e) {
            return true;
        }
    }
}

module.exports = MultiStoreUtils;
