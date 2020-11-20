const Creator = require('./creator');

const creator = new Creator();
creator.createReindexJob({ entity: 'block', priority: 'normal', ids: ['123'] });

