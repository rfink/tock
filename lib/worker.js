/**
 * Module for creating a worker to listen on the queue for new jobs.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  December 23, 2011
 */

/* ~ Bootstrap our dependencies ~ */

var config = require('./config'),
		child_process = require('child_process'),
		axon = require('axon'),
    hostname = require('os').hostname();

/* ~ Application setup ~ */

// TODO: Re-emit runningProcesses if master dies
var runningProcesses = {},
    masterHost = process.env.TOCK_MASTER_HOST || config.masterHost,
    slavePort = process.env.TOCK_SLAVE_PORT || config.slaveInternalPort,
		subscriberSocket = axon.socket('sub-emitter'),
		publisherSocket = axon.socket('pub-emitter');

// Connect our subscriber socket, this will listen for new jobs from the master
subscriberSocket.connect(process.env.TOCK_MASTER_PORT || config.masterInternalPort, masterHost);

// Connect our publisher socket to push data back to the master
publisherSocket.bind(slavePort, masterHost);

// Bind to subscriber events
subscriberSocket.on('job:spawn', spawnJob);
subscriberSocket.on('job:kill', killJob);

/**
 * Spawn a job and pump back the output
 */
function spawnJob(job) {

  var startTime = Date.now(),
      process = child_process.spawn(job.Command, job.Parameters);
  
  // Register our process on the running processes stack, to allow these
  //   to be controlled via an API.
  runningProcesses[job._id] = process;
  
  console.log('Spawned job ' + job._id);
  
  process.stdout.on('data', function(chunk) {
    publisherSocket.emit('job:stdOut', {
      id: job._id,
      stdOut: chunk.toString()
    });
  });
  
  process.stderr.on('data', function(chunk) {
    publisherSocket.emit('job:stdErr', {
      id: job._id,
      stdErr: chunk.toString()
    });
  });
  
  process.on('exit', function(errorCode) {
  
    console.log('Job ' + job._id + ' finished');
  
    // Pop from our running processes stack
    if (runningProcesses[job._id]) delete runningProcesses[job._id];

    var totalRunTime = (Date.now() - startTime);

    if (errorCode) {
      publisherSocket.emit('job:error', {
        id: job._id,
        errorCode: errorCode
      });
      console.error('Error code: ' + errorCode);
    }
  
    publisherSocket.emit('job:complete', {
      id: job._id,
      stats: {
        totalRunTime: totalRunTime,
        pid: process.pid
      }
    });
  
  });

}

/**
 * Kill an in-process job
 */
function killJob(jobId) {

  if (runningProcesses[jobId]) {
    console.log('Killed job ' + jobId);
    runningProcesses[jobId].kill();
    delete runningProcesses[jobId];
    publisherSocket.emit('job:killed', { id: jobId });
  } else {
    // TODO: Write request & return??
  }  

}