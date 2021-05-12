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
}

module.exports = MultiStoreUtils;
