/**
 * Module for creating a worker to listen on the queue for new jobs.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  December 23, 2011
 */

/* - Bootstrap our dependencies - */
var config = require('./config');
var child_process = require('child_process');
var io = require('socket.io-client').connect('http://' + config.masterHost + ':' + config.masterInternalPort);
var runningProcesses = {};

io.sockets.on('connection', function(socket) {
	// Request is to create a new job
	io.on('spawnJob', function(request) {
		var job = request.payload;
		var startTime = Date.now();
		var process = child_process.spawn(job.Command, job.Parameters);
		// Register our process on the running processes stack, to allow these
		//   to be controlled via an API.
		runningProcesses[job._id] = process;
		console.log('Spawned job ' + job._id);
		process.stdout.on('data', function(chunk) {
			socket.emit('stdOut', {
				stdOut: chunk.toString()
			});
		});
		process.stderr.on('data', function(chunk) {
			socket.emit('stdErr', {
				stdErr: chunk.toString()
			});
		});
		process.on('exit', function(errorCode) {
			console.log('Job ' + job._id + ' finished');
			// Pop from our running processes stack
			if (runningProcesses[job._id]) delete runningProcesses[job._id];
			var totalRunTime = (Date.now() - startTime);
			if (errorCode) {
				socket.emit({ errorCode: errorCode });
				console.error('Error code: ' + errorCode);
			}
			socket.emit('end', {
				stats: {
					totalRunTime: totalRunTime,
					pid: process.pid
				}
			});
		});
	});

	// Request is to kill an existing running job
	io.on('killJob', function(request) {
		if (runningProcesses[request.payload.jobId]) {
			console.log('Killed job ' + request.payload.jobId);
			runningProcesses[request.payload.jobId].kill();
			delete runningProcesses[request.payload.jobId];
			socket.emit('jobKilled', { jobKilled: request.payload.jobId });
		} else {
			// TODO: Write request & return??
		}
	});
});