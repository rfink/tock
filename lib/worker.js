
/* ~ Application dependencies ~ */

var debug = require('debug')('tock-worker')
    , envcfg = require('envcfg')
    , config = envcfg(__dirname + '/config.json')
		, child_process = require('child_process')
		, axon = require('axon')
    , EventEmitter = require('events').EventEmitter
    , hostname = require('os').hostname()
    , workerId = process.env.TOCK_WORKER_ID || (hostname + ':' + process.pid);

exports = module.exports = Worker;

/**
 * Worker constructor
 */

function Worker() {

  EventEmitter.call(this);
  this.runningProcesses = {};
  this.subscriberSocket;
  this.publisherSocket;
  this.jobKillerSocket;

}

Worker.prototype.__proto__ = EventEmitter.prototype;

/**
 * Start subscriber socket
 */

Worker.prototype.startSubscriberSocket = function() {

  var self = this;

  this.subscriberSocket = axon.socket('rep');
  this.subscriberSocket.format('json');
  this.subscriberSocket.on('connect', this.emit.bind(this, 'subscriber:connect'));
  this.subscriberSocket.connect(config.masterInternalPort, config.masterHost);

  // Bind to subscriber events
  this.subscriberSocket.on('message', function(task, job, reply) {
    switch (task) {
      case 'job:spawn':
        return self.spawnJob(job, reply);
    }
  });

  return this;

};

/**
 * Start publisher socket
 */

Worker.prototype.startPublisherSocket = function() {

  this.publisherSocket = axon.socket('push');
  this.publisherSocket.format('json');
  this.publisherSocket.on('connect', this.emit.bind(this, 'publisher:connect'));
  this.publisherSocket.bind(config.slaveInternalPort, config.masterHost);

  return this;

};

/**
 * Start job killer socket
 */

Worker.prototype.startJobKillerSocket = function() {

  var self = this;

  this.jobKillerSocket = axon.socket('sub');
  this.jobKillerSocket.format('json');
  this.jobKillerSocket.on('connect', this.emit.bind(this, 'jobKiller:connect'));
  this.jobKillerSocket.on('message', function(task, data) {
    switch (task) {
      case 'job:kill':
        return self.killJob(data);
    }
  });
  this.jobKillerSocket.connect(config.jobKillPort);

  return this;

};

/**
 * Start our worker
 */

Worker.prototype.start = function() {

  this.startSubscriberSocket();
  this.startPublisherSocket();
  this.startJobKillerSocket();

  return this;

};

/**
 * Spawn a job and pump back the output
 */
Worker.prototype.spawnJob = function(job, callback) {

  var self = this
      , startTime = Date.now()
      , process = child_process.spawn(job.command, job.parameters);
  
  // Register our process on the running processes stack, to allow these
  //   to be controlled via an API.
  this.runningProcesses[ job._id ] = process;

  // Emit back to the master that we have began work
  callback(null, {
    jobId: job._id,
    workerId: workerId,
    pid: process.pid,
    hostname: hostname
  });

  debug('Spawned job ' + job._id);
  
  process.stdout.on('data', function(chunk) {
    return self.publisherSocket.send({
      event: 'job:stdOut',
      data: {
        id: job._id,
        stdOut: chunk.toString()
      }
    });
  });
  
  process.stderr.on('data', function(chunk) {
    return self.publisherSocket.send({
      event: 'job:stdErr',
      data: {
        id: job._id,
        stdErr: chunk.toString()
      }
    });
  });
  
  process.on('exit', function(errorCode) {
  
    debug('Job ' + job._id + ' finished');
  
    // Pop from our running processes stack
    if (self.runningProcesses[ job._id ]) delete self.runningProcesses[ job._id ];

    var totalRunTime = (Date.now() - startTime);

    if (errorCode) {
      self.publisherSocket.send({
        event: 'job:error',
        data: {
          id: job._id,
          errorCode: errorCode,
          message: 'Error code called on process exit'
        }
      });
      debug('Error code: ' + errorCode);
    }
  
    return self.publisherSocket.send({
      event: 'job:complete',
      data: {
        id: job._id,
        stats: {
          totalRunTime: totalRunTime,
          pid: process.pid
        }
      }
    });
  
  });

};

/**
 * Kill an in-process job
 */

Worker.prototype.killJob = function(job) {

  var jobId = job.id;

  if (this.runningProcesses[ jobId ]) {

    debug('Killed job ' + jobId);
    this.runningProcesses[ jobId ].kill();
    delete this.runningProcesses[ jobId ];
    return this.publisherSocket.send({
      event: 'job:killed',
      data: {
        id: jobId
      }
    });

  } else {

    debug('Job ' + jobId + ' was not currently running');

  }  

};

/**
 * Cancel all in progress jobs, turn off all sockets,
 *   delete process queue.  THIS SHOULD PROBABLY ONLY BE USED WITH UNIT TESTING.
 */

Worker.prototype.destroy = function() {

  var self = this;

  Object.keys(this.runningProcesses).forEach(function(id) {
    self.runningProcesses[ id ].kill();
  });

  this.publisherSocket.close();
  this.subscriberSocket.close();
  this.jobKillerSocket.close();
  this.runningProcesses = {};

  return this;

};

// If called directly, run this
if (require.main === module) {
  (new Worker).start();
}
