var util = require('util');

module.exports = function (restClient) {
    var module = {};

    module.list = function (searchCriteria) {
        var query = 'searchCriteria=' + searchCriteria;
        var endpointUrl = util.format('/cmsPage/search?%s', query);
        return restClient.get(endpointUrl);
    };

    module.get = function (cmsPageId) {
        var endpointUrl = util.format('/kmkCmsPage/%s', cmsPageId);
        return restClient.get(endpointUrl);
    };

    return module;
}
