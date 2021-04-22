var winston = require('winston');
const { format } = require('winston');

winston.emitErrs = true;

function filterMessagesFormat(filterFunc) {
  const formatFunc = (info) => {
    if (filterFunc(info.message)) return info;
    return null;
  };

  const format = logform.format(formatFunc);
  format.transform = formatFunc;

  return format;
}

if(!global.logger) {
  global.logger = new winston.Logger({
    transports: [
      new winston.transports.Console({
        level: 'info',
        handleExceptions: false,
        json: false,
        prettyPrint: true,
        colorize: true,
        timestamp: true
      })
    ],
    exitOnError: false
  });
}

module.exports = global.logger;
