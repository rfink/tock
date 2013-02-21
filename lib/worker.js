
/* ~ Application dependencies ~ */

var debug = require('debug')('tock-worker')
    , envcfg = require('envcfg')
    , config = envcfg(__dirname + '/config.json')
		, child_process = require('child_process')
		, axon = require('axon')
    , WorkerClient = require('./client/workerclient')
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

}

Worker.prototype.__proto__ = EventEmitter.prototype;

/**
 * Start our worker
 */

Worker.prototype.start = function() {

  this.client = new WorkerClient();
  this.client.on('message', this.router.bind(this));
  this.client.connect(this.emit.bind(this, 'connect'));

  return this;

};

/**
 * Router for incoming messages
 */

Worker.prototype.router = function(message) {

  var routes = {
    'job:spawn': this.spawnJob.bind(this)
    , 'job:kill': this.killJob.bind(this)
  };

  if (routes[ message.event ]) {
    return routes[ message.event ](message.data);
  } else {
    debug('Route ' + message.event + ' not found');
    return this.client.error('Route ' + message.event + ' not found');
  }

  return this;

};

/**
 * Spawn a job and pump back the output
 */

Worker.prototype.spawnJob = function(job) {

  var self = this
      , startTime = Date.now()
      , process = child_process.spawn(job.command, job.parameters);
  
  // Register our process on the running processes stack, to allow these
  //   to be controlled via an API.
  this.runningProcesses[ job._id ] = process;

  // Emit back to the master that we have began work
  this.client.notifyWorkStarted(
    job
    , {
      jobId: job._id
      , workerId: workerId
      , pid: process.pid
      , hostname: hostname
    }
  );

  debug('Spawned job ' + job._id);
  
  process.stdout.on('data', function(chunk) {
    return self.client.stdOut(job._id, chunk.toString());
  });
  
  process.stderr.on('data', function(chunk) {
    return self.client.stdErr(job._id, chunk.toString());
  });
  
  process.on('exit', function(errorCode) {
  
    debug('Job ' + job._id + ' finished');
  
    // Pop from our running processes stack
    if (self.runningProcesses[ job._id ]) delete self.runningProcesses[ job._id ];

    var totalRunTime = (Date.now() - startTime);

    if (errorCode) {
      self.client.jobError(job._id, errorCode, 'Error code called on process exit');
      debug('Error code: ' + errorCode);
    }
  
    return self.client.notifyJobCompleted(job._id, { totalRunTime: totalRunTime , pid: process.pid });
  
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
    return this.client.notifyJobKilled(jobId);

  } else {

    debug('Job ' + jobId + ' was not currently running');

  }  

};

/**
 * Cancel all in progress jobs, turn off all sockets,
 *   delete process queue.  THIS SHOULD PROBABLY ONLY BE USED WITH UNIT TESTING.
 */

Worker.prototype.destroy = function(callback) {

  var self = this;

  Object.keys(this.runningProcesses).forEach(function(id) {
    self.runningProcesses[ id ].kill();
  });

  this.client.close(function() {
    self.runningProcesses = {};
    return callback();
  });

  return this;

};

// If called directly, run this
if (require.main === module) {
  (new Worker).start();
}
