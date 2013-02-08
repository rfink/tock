/**
 * Module for creating a worker to listen on the queue for new jobs.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  December 23, 2011
 */

/* ~ Bootstrap our dependencies ~ */

var debug = require('debug')('tock-worker'),
    envcfg = require('envcfg'),
    config = envcfg(__dirname + '/config.json'),
		child_process = require('child_process'),
		axon = require('axon'),
    errorHandler = require(__dirname + '/errorhandler'),
    hostname = require('os').hostname(),
    workerId = process.env.TOCK_WORKER_ID || (hostname + ':' + process.pid);

/* ~ Application setup ~ */

var runningProcesses = {},
		subscriberSocket = axon.socket('rep'),
		publisherSocket = axon.socket('push');

// Connect our subscriber socket, this will listen for new jobs from the master
subscriberSocket.format('json');
subscriberSocket.connect(config.masterInternalPort, config.masterHost);

// Connect our publisher socket to push data back to the master
publisherSocket.format('json');
publisherSocket.bind(config.slaveInternalPort, config.masterHost);

/**
 * When our master disconnects, let's emit the running processes
 *   a single time when it reconnects
 */
publisherSocket.on('disconnect', function() {
  publisherSocket.once('connect', function() {
    debug('Master reconnected');
    publisherSocket.send({
      event: 'master:reconnect',
      data: {
        workerId: workerId,
        jobs: Object.keys(runningProcesses)
      }
    });
  });
});

// Bind to subscriber events
subscriberSocket.on('job:spawn', spawnJob);
subscriberSocket.on('job:' + workerId + ':kill', killJob);

/**
 * Spawn a job and pump back the output
 */
function spawnJob(job) {

  var startTime = Date.now(),
      process = child_process.spawn(job.command, job.parameters);
  
  // Register our process on the running processes stack, to allow these
  //   to be controlled via an API.
  runningProcesses[ job._id ] = process;

  // Emit back to the master that we have began work
  publisherSocket.send({
    event: 'job:workStarted',
    data: {
      jobId: job._id,
      workerId: workerId,
      pid: process.pid,
      hostname: hostname
    }
  });

  debug('Spawned job ' + job._id);
  
  process.stdout.on('data', function(chunk) {
    return publisherSocket.send({
      event: 'job:stdOut',
      data: {
        id: job._id,
        stdOut: chunk.toString()
      }
    });
  });
  
  process.stderr.on('data', function(chunk) {
    return publisherSocket.send({
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
    if (runningProcesses[ job._id ]) delete runningProcesses[ job._id ];

    var totalRunTime = (Date.now() - startTime);

    if (errorCode) {
      publisherSocket.send({
        event: 'job:error',
        data: {
          id: job._id,
          errorCode: errorCode,
          message: 'Error code called on process exit'
        }
      });
      debug('Error code: ' + errorCode);
    }
  
    return publisherSocket.send({
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

}

/**
 * Kill an in-process job
 */
function killJob(job) {

  var jobId = job.jobId;

  if (runningProcesses[ jobId ]) {

    debug('Killed job ' + jobId);
    runningProcesses[ jobId ].kill();
    delete runningProcesses[ jobId ];
    return publisherSocket.send({
      event: 'job:killed',
      data: {
        id: jobId
      }
    });

  } else {

    debug('Job ' + jobId + ' was not currently running');
    return publisherSocket.send({
      event: 'job:error',
      data: {
        id: jobId,
        errorCode: 1,
        message: 'Job ' + jobId + ' was not running'
      }
    });

  }  

}