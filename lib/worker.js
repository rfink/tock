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
	http.createServer(function(req, res) {
		var data = '';
		req.on('data', function(chunk) {
			data += chunk;
		});
		req.on('end', function() {
			var job = JSON.parse(data);
			var startTime = Date.now();
			var process = child_process.spawn(job.Command);
			process.stdout.on('data', function(chunk) {
				res.write(JSON.stringify({ root: { stdOut: chunk.toString() } }));
			});
			process.stderr.on('data', function(chunk) {
				res.write(JSON.stringify({ root: { stdErr: chunk.toString() } }));
			});
			process.on('exit', function(errorCode) {
				var totalRunTime = (Date.now() - startTime);
				if (errorCode) {
					res.write(JSON.stringify({ root: { errorCode: errorCode } }));
					console.error('Error code: ' + errorCode);
				}
				res.write(JSON.stringify({ root: { totalRunTime: totalRunTime } }));
				res.end();
			});
		});
	}).listen(port);
}
