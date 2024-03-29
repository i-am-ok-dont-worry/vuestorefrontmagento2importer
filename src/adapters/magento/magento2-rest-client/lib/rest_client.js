'use strict';

var OAuth = require('oauth-1.0a');
var request = require('request');
var humps = require('humps');
var sprintf = require('util').format;

var logger = require('./log');

module.exports.RestClient = function (options) {
    var instance = {};

    var servelrUrl = options.url;
    var apiVersion = options.version || 'V1';
    var storeCode = options.storeCode || 'all';
    var oauth = OAuth({
        consumer: {
            public: options.consumerKey,
            secret: options.consumerSecret
        },
        signature_method: 'HMAC-SHA1'
    });
    var token = {
        public: options.accessToken,
        secret: options.accessTokenSecret
    };

    function apiCall(request_data) {
        logger.info('Calling API endpoint: ' + request_data.method + ' ' + request_data.url);
        return new Promise(function (resolve, reject) {
            request({
                url: request_data.url,
                method: request_data.method,
                headers: { Authorization: `Bearer ${token.public}` },
                json: true,
                body: request_data.body,
            }, function (error, response, body) {
                if (error) {
                    logger.error('Error occured: ' + error);
                    reject({ ...error, response });
                    return;
                } else if (!httpCallSucceeded(response)) {
                    var errorMessage = 'HTTP ERROR ' + response.statusCode + ' ' + request_data.url;
                    if(body && body.hasOwnProperty('message')) {
                        const message = errorString(body.message, body.hasOwnProperty('parameters') ? body.parameters : {});
                        errorMessage = `HTTP ERROR ` + message || request_data.url;
                    }

                    logger.error('API call failed: ' + errorMessage);
                    reject({ errorMessage, ...(body.message && { rawMessage: body.message }), statusCode: response.statusCode, requestUrl: request_data.url });
                }
//                var bodyCamelized = humps.camelizeKeys(body);
//                resolve(bodyCamelized);
                resolve(body);
            });
        });
    }

    function httpCallSucceeded(response) {
        return response.statusCode >= 200 && response.statusCode < 300;
    }

    function errorString(message, parameters) {
        if (parameters === null) {
            return message;
        }
        if (parameters instanceof Array) {
            for (var i = 0; i < parameters.length; i++) {
                var parameterPlaceholder = '%' + (i + 1).toString();
                message = message.replace(parameterPlaceholder, parameters[i]);
            }
        } else if (parameters instanceof Object) {
            for (var key in parameters) {
                var parameterPlaceholder = '%' + key;
                message = message.replace(parameterPlaceholder, parameters[key]);
            }
        }

        return message;
    }

    instance.get = function (resourceUrl) {
        var request_data = {
            url: createUrl(resourceUrl),
            method: 'GET'
        };
        return apiCall(request_data);
    }

    function createUrl(resourceUrl) {
        return servelrUrl + '/' + storeCode + '/' + apiVersion + resourceUrl;
    }

    instance.post = function (resourceUrl, data) {
        var request_data = {
            url: createUrl(resourceUrl),
            method: 'POST',
            body: data
        };
        return apiCall(request_data);
    }

    instance.put = function (resourceUrl, data) {
        var request_data = {
            url: createUrl(resourceUrl),
            method: 'PUT',
            body: data
        };
        return apiCall(request_data);
    }

    instance.delete = function (resourceUrl) {
        var request_data = {
            url: createUrl(resourceUrl),
            method: 'DELETE'
        };
        return apiCall(request_data);
    }

    return instance;
}
