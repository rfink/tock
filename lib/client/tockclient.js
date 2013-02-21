
/* ~ Application dependencies ~ */

var debug = require('debug')('tock-client')
    , envcfg = require('envcfg')
    , config = envcfg(__dirname + '/../config.json')
    , async = require('async')
    , axon = require('axon')
    , EventEmitter = require('events').EventEmitter;

exports = module.exports = TockClient;

/**
 * TockClient constructor
 */

function TockClient() {

  EventEmitter.call(this);

}

TockClient.prototype.__proto__ = EventEmitter.prototype;

/**
 * Connect our tock client
 */

TockClient.prototype.connect = function(callback) {

  var self = this;

  function onConnect() {
    self.emit('connect');
    if (typeof callback === 'function') {
      callback();
    }
  }

  async.parallel([ this.startSubscriberSocket.bind(this), this.startPublisherSocket.bind(this), this.startJobKillerSocket.bind(this) ], onConnect);
  return this;

};

/**
 * Close our connections
 */

TockClient.prototype.close = function(callback) {

  var self = this
      , parallelTasks = [
          this.subscriberSocket.close.bind(this.subscriberSocket)
          , this.publisherSocket.close.bind(this.publisherSocket)
          , this.jobKillerSocket.close.bind(this.jobKillerSocket)
        ];

  function onClose() {
    self.emit('close');
    if (typeof callback === 'function') {
      callback();
    }
  }

  async.parallel(parallelTasks, onClose);
  return this;

};

/**
 * Start subscriber socket
 */

TockClient.prototype.startSubscriberSocket = function(callback) {

  // Connect our subscriber socket, this will receive data from the slaves
  this.subscriberSocket = axon.socket('pull');
  this.subscriberSocket.format('json');
  this.subscriberSocket.on('connect', function() {
    return callback();
  });
  //this.subscriberSocket.on('message', this.emit.bind(this));
  this.subscriberSocket.on('message', this.emit.bind(this, 'message'));
  this.subscriberSocket.connect(config.slaveInternalPort);

  return this;

};

/**
 * Start publisher socket
 */

TockClient.prototype.startPublisherSocket = function(callback) {

  // Connect our publisher socket, this will publish jobs to the slaves
  this.publisherSocket = axon.socket('push');
  this.publisherSocket.format('json');
  this.publisherSocket.set('hwm', 0);
  this.publisherSocket.on('connect', function() {
    return callback();
  });
  this.publisherSocket.bind(config.masterInternalPort);

  return this;

};

/**
 * Start jobKiller socket
 */

TockClient.prototype.startJobKillerSocket = function(callback) {

  this.jobKillerSocket = axon.socket('pub');
  this.jobKillerSocket.format('json');
  this.jobKillerSocket.on('connect', function() {
    return callback();
  });
  this.jobKillerSocket.bind(config.jobKillPort);

  return this;

};

/**
 * Spawn a job to our listening clients
 */

TockClient.prototype.spawnJob = function(job) {

  var self = this;
  return this.publisherSocket.send({ event: 'job:spawn', data: job });

};

/**
 * Kill given jobid
 */

TockClient.prototype.killJob = function(jobId) {

  return this.jobKillerSocket.send({ event: 'job:kill', data: { id: jobId } });

};
