/**
 * Module for creating a worker to listen on the queue for new jobs.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  December 23, 2011
 */

var config = require('./config');
var cluster = require('cluster');
var child_process = require('child_process');
var http = require('http');

var numWorkers = 5;
var port = 8989;

if (cluster.isMaster) {
	for (var i = 0; i < numWorkers; ++i) {
		cluster.fork();
	}
	cluster.on('death', function(worker) {
		console.log('Worker' + worker.pid + ' died, respawning');
		cluster.fork();
	});
} else {
	http.createServer(function(request, response) {
		var client = request.headers.host;
		var data = '';
		request.on('data', function(chunk) {
			data += chunk;
		});
		request.on('end', function() {
			var job = JSON.parse(data);
			console.log(job.Command);
			var startTime = Date.now();
			var process = child_process.spawn(job.Command);
			process.stdout.on('data', function(chunk) {
				console.log(chunk);
				response.write(chunk);
			});
			process.stderr.on('data', function(chunk) {
				console.log('Std Err: ' + chunk);
				// TODO: What??
			});
			process.on('exit', function(errorCode) {
				var totalRunTime = (Date.now() - startTime);
				console.log('Error: ' + JSON.stringify(arguments));
				if (errorCode) {
					// TODO: What??
				}
				response.end();
			});
		});
	}).listen(port);
}
