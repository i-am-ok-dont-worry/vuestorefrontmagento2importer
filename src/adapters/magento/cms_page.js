'use strict';

let AbstractMagentoAdapter = require('./abstract');

class PageAdapter extends AbstractMagentoAdapter {
    constructor(config) {
        super(config);
        this.use_paging = false;
    }

    getEntityType() {
        return 'cms_page';
    }

    getName() {
        return 'adapters/magento/PageAdapter';
    }

    async getSourceData(context) {
        if (this.use_paging) {
            return this.api.pages.list('&searchCriteria[currentPage]=' + this.page + '&searchCriteria[pageSize]=' + this.page_size + (query ? '&' + query : ''))
                .catch((err) => {
                    throw new Error(err);
                });
        }

        if (context.ids && context.ids instanceof Array && context.ids.length > 0) {
            let pages = [];
            for (let id of context.ids) {
                const page = await this.fetchPage(id);
                pages.push(page);
            }

            return { items: pages, total_count: pages.length };
        }

        return this.api.pages.list()
            .then((res) => {
                if (context.ids && context.ids instanceof Array && context.ids.length > 0) {
                    const items = res.items.filter(item => context.ids.map(id => parseInt(id, 10)).includes(item.id));
                    return { ...res, items };
                } else {
                    return res;
                }
            })
            .catch((err) => {
                throw new Error(err);
            });
    }

    fetchPage(pageId) {
        return this.api.pages.get(pageId);
    }

    getLabel (item) {
        return `[(${item.id}) - ${item.identifier}]`;
    }

    prepareItems(items) {
        if (!items)
          return items;

        if (items.total_count)
          this.total_count = items.total_count;

        if (items.items) {
          items = items.items; // this is an exceptional behavior for Magento2 api for lists
        }

        return items;
    }

    preProcessItem(item) {

        return new Promise(async (done, reject) => {
            if (item) {
                item.type = 'cms_page'
            }

            try {
                const page = await this.fetchPage(item.id);
                item = { ...item, ...page };
            } catch (e) {}

            return done(item);
        });

    }

    normalizeDocumentFormat(item) {
        return item;
    }
}

module.exports = PageAdapter;
