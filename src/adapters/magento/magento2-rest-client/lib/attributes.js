var util = require('util');

module.exports = function (restClient) {
    var module = {};

    module.list = function (searchCriteria) {
        var query = 'searchCriteria=' + searchCriteria;
        var endpointUrl = util.format('/products/attributes?%s', query);
        return restClient.get(endpointUrl);
    }

    module.create = function (categoryAttributes) {
        return restClient.post('/products/attributes', categoryAttributes);
    }

    module.update = function (attributeId, categoryAttributes) {
        var endpointUrl = util.format('/products/attributes/%d', attributeId);
        return restClient.put(endpointUrl, categoryAttributes);
    }

    module.delete = function (attributeId) {
        var endpointUrl = util.format('/products/attributes/%d', attributeId);
        return restClient.delete(endpointUrl);
    }

    module.attributeSetList = function () {
        var endpointUrl = util.format('/products/attribute-sets/sets/list?searchCriteria%5BfilterGroups%5D%5B0%5D%5Bfilters%5D%5B0%5D%5Bfield%5D=attribute_set_id&searchCriteria%5BfilterGroups%5D%5B0%5D%5Bfilters%5D%5B0%5D%5Bvalue%5D=null&searchCriteria%5BfilterGroups%5D%5B0%5D%5Bfilters%5D%5B0%5D%5BconditionType%5D=neq');
        return restClient.get(endpointUrl);
    }

    module.attributeSetOptions = function (attributeSetId) {
        var endpointUrl = util.format('/products/attribute-sets/%d/attributes', attributeSetId);
        return restClient.get(endpointUrl);
    }

    return module;
}
