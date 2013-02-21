
/* ~ Application dependencies ~ */

var envcfg = require('envcfg')
    , config = envcfg(__dirname + '/config.json')
    , winston = require('winston')
    , winstonMail = require('winston-mail')
    , winstonMongoDB = require('winston-mongodb');

var logTransports = [];

(config.transports || []).forEach(function(transport) {
  logTransports.push(new winston.transports[ transport ](config.logging[ transport.toLowerCase() ]));
});

var logger = exports = module.exports = new (winston.Logger)({
  transports: logTransports
});
