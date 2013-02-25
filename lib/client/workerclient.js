
/* ~ Application dependencies ~ */

var debug = require('debug')('tock-client')
    , envcfg = require('envcfg')
    , config = envcfg(__dirname + '/../config.json')
    , async = require('async')
    , axon = require('axon')
    , EventEmitter = require('events').EventEmitter;

exports = module.exports = WorkerClient;

/**
 * WorkerClient constructor
 */

function WorkerClient() {

  EventEmitter.call(this);

}

WorkerClient.prototype.__proto__ = EventEmitter.prototype;

/**
 * Connect our tock client
 */

WorkerClient.prototype.connect = function(callback) {

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

WorkerClient.prototype.close = function(callback) {

  var self = this;

  function attachCloseEvent(socket, done) {
    socket.on('close', done);
    socket.close();
  }

  function onClose() {
    self.emit('close');
    if (typeof callback === 'function') {
      callback();
    }
  }

  async.each([ this.publisherSocket, this.subscriberSocket, this.jobKillerSocket ], attachCloseEvent, onClose);

  return this;

};

/**
 * Start subscriber socket
 */

WorkerClient.prototype.startSubscriberSocket = function(callback) {

  var self = this;

  this.subscriberSocket = axon.socket('pull');
  this.subscriberSocket.format('json');
  this.subscriberSocket.once('connect', function() {
    return callback();
  });
  this.subscriberSocket.on('message', this.emit.bind(this, 'message'));
  this.subscriberSocket.connect(config.masterInternalPort, config.masterHost);

  return this;

};

/**
 * Start publisher socket
 */

WorkerClient.prototype.startPublisherSocket = function(callback) {

  this.publisherSocket = axon.socket('push');
  this.publisherSocket.format('json');
  this.publisherSocket.once('connect', function() {
    return callback();
  });
  this.publisherSocket.bind(config.slaveInternalPort, config.masterHost);

  return this;

};

/**
 * Start jobKiller socket
 */

WorkerClient.prototype.startJobKillerSocket = function(callback) {

  var self = this;

  this.jobKillerSocket = axon.socket('sub');
  this.jobKillerSocket.format('json');
  this.jobKillerSocket.once('connect', function() {
    return callback();
  });
  this.jobKillerSocket.on('message', this.emit.bind(this, 'message'));
  this.jobKillerSocket.connect(config.jobKillPort);

  return this;

};

/**
 * Notify that we have started work
 */

WorkerClient.prototype.notifyWorkStarted = function(job, params) {

  this.publisherSocket.send({ event: 'work:started', data: { job: job, params: params } });
  return this;

};

/**
 * Notify that we have successfully killed a job
 */

WorkerClient.prototype.notifyJobKilled = function(id) {

  this.publisherSocket.send({ event: 'job:killed', data: { id: id } });
  return this;

};

/**
 * Notify that our job has completed
 */

WorkerClient.prototype.notifyJobCompleted = function(id, stats) {

  this.publisherSocket.send({ event: 'job:complete', data: { id: id, stats: stats } });
  return this;

};

/**
 * Send standard out
 */

WorkerClient.prototype.stdOut = function(id, stdOut) {

  this.publisherSocket.send({ event: 'job:stdOut', data: { id: id, stdOut: stdOut } });
  return this;

};

/**
 * Send standard error
 */

WorkerClient.prototype.stdErr = function(id, stdErr) {

  this.publisherSocket.send({ event: 'job:stdErr', data: { id: id, stdErr: stdErr } });
  return this;

};

/**
 * Send job error
 */

WorkerClient.prototype.jobError = function(id, code, message) {

  this.publisherSocket.send({ event: 'job:error', data: { id: id, errroCode: code, message: message } });
  return this;

};

/**
 * Send an error event
 */

WorkerClient.prototype.error = function(err) {

  this.publisherSocket.send({ event: 'error', data: { error: err } });
  return this;

};
