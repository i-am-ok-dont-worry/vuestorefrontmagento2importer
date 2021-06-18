const config = require('config');

class MultiStoreUtils {

    static getStoreCode() {
        try {
            const [defaultStore] = config.availableStores || ['all'];
            const storeView = config['storeViews'][defaultStore];

            return storeView.storeCode || 'all';
        } catch (e) {
            return 'all';
        }
    }

    static isDefaultStoreView(storeView) {
        try {
            const [defaultStore] = config.availableStores || ['all'];
            return defaultStore === storeView;
        } catch (e) {
            return true;
        }
    }
}

module.exports = MultiStoreUtils;
