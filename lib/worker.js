/**
 * Module for creating a worker to listen on the queue for new jobs.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  December 23, 2011
 */

/* - Bootstrap our dependencies - */
var config = require('./config');
var child_process = require('child_process');
var io = require('socket.io-client');
var socket = io.connect('http://' + config.masterHost + ':' + config.masterInternalPort, {
	'reconnect': true,
	'reconnection delay': (1000 * config.workerTimeoutRetry),
	'connect timeout': (1000 * config.workerConnectTimeout),
	'max reconnection attempts': 10
});
var runningProcesses = {};
var connectTimeout;

socket.on('connect_failed', function() {
	console.error(arguments);
});
socket.on('close', function() {
	console.log('MERF');
});
socket.on('disconnect', function() {
	console.log('DERF');
});
socket.on('error', function() {
	/*connectTimeout = (function retry() {
		setTimeout(function() {
			socket.connect('http://' + config.masterHost + ':' + config.masterInternalPort, {
				'reconnect': true,
				'reconnection delay': (1000 * config.workerTimeoutRetry),
				'connect timeout': (1000 * config.workerConnectTimeout)
			});
			retry();
		}, config.workerTimeoutRetry * 1000);
	})();
	console.log(arguments);
	console.log(connectTimeout);*/
});
socket.on('connect', function() {
	if (connectTimeout) clearTimeout(connectTimeout);
	// Request is to create a new job
	socket.on('spawnJob', function(request) {
		var job = request.job;
		var startTime = Date.now();
		var process = child_process.spawn(job.Command, job.Parameters);
		// Register our process on the running processes stack, to allow these
		//   to be controlled via an API.
		runningProcesses[job._id] = process;
		console.log('Spawned job ' + job._id);
		process.stdout.on('data', function(chunk) {
			socket.emit('stdOut', {
				id: job._id,
				stdOut: chunk.toString()
			});
		});
		process.stderr.on('data', function(chunk) {
			socket.emit('stdErr', {
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
				socket.emit('jobError', {
					id: job._id,
					errorCode: errorCode
				});
				console.error('Error code: ' + errorCode);
			}
			socket.emit('jobComplete', {
				id: job._id,
				stats: {
					totalRunTime: totalRunTime,
					pid: process.pid
				}
			});
		});
	});
	// Request is to kill an existing running job
	socket.on('killJob', function(request) {
		if (runningProcesses[request.jobId]) {
			console.log('Killed job ' + request.jobId);
			runningProcesses[request.jobId].kill();
			delete runningProcesses[request.jobId];
			socket.emit('jobKilled', { id: request.jobId });
		} else {
			// TODO: Write request & return??
		}
	});
});