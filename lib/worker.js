/**
 * Module for creating a worker to listen on the queue for new jobs.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  December 23, 2011
 */

/* - Bootstrap our dependencies - */
var config = require('./config');
var cluster = require('cluster');
var child_process = require('child_process');
var http = require('http');
var _ = require('underscore');

var numWorkers = 5;
var port = 8989;
var runningProcesses = {};

if (cluster.isMaster) {
	for (var i = 0; i < numWorkers; ++i) {
		cluster.fork();
	}
	cluster.on('death', function(worker) {
		console.log('Worker' + worker.pid + ' died, respawning');
		cluster.fork();
	});
} else {
	http.createServer(function(req, res) {
		var data = '';
		req.on('data', function(chunk) {
			data += chunk;
		});
		req.on('end', function() {
			var request = JSON.parse(data);
			// Request is to create a new job
			if (request.requestType === 'spawnJob') {
				var job = request.payload;
				var startTime = Date.now();
				var process = child_process.spawn(job.Command, job.Parameters);
				// Register our process on the running processes stack, to allow these
				//   to be controlled via an API.
				runningProcesses[job._id] = process;
				console.log('Spawned job ' + job._id);
				process.stdout.on('data', function(chunk) {
					res.write(JSON.stringify({ root: { stdOut: chunk.toString() } }));
				});
				process.stderr.on('data', function(chunk) {
					res.write(JSON.stringify({ root: { stdErr: chunk.toString() } }));
				});
				process.on('exit', function(errorCode) {
					console.log('Job ' + job._id + ' finished');
					// Pop from our running processes stack
					if (runningProcesses[job._id]) delete runningProcesses[job._id];
					var totalRunTime = (Date.now() - startTime);
					if (errorCode) {
						res.write(JSON.stringify({ root: { errorCode: errorCode } }));
						console.error('Error code: ' + errorCode);
					}
					res.write(JSON.stringify({ root: { stats: {totalRunTime: totalRunTime, pid: process.pid } } }));
					res.end();
				});
			// Request is to kill an existing running job
			} else if (request.requestType === 'killJob') {
				if (runningProcesses[request.payload.jobId]) {
					console.log('Killed job ' + request.payload.jobId);
					runningProcesses[request.payload.jobId].kill();
					delete runningProcesses[request.payload.jobId];
					res.write(JSON.stringify({ root: { jobKilled: request.payload.jobId } }));
					res.end();
				} else {
					// TODO: Write request & return??
				}
			}
		});
	}).listen(port);
}
