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
		var data = '';
		request.on('data', function(chunk) {
			data += chunk;
		});
		request.on('end', function() {
			var job = JSON.parse(data);
			child_process.exec(job.command, function(err, stdOut, stdErr) {
				if (err) {
					response.writeHead(500, { 'Content-Type': 'application/json' });
					response.write(JSON.stringify(err));
				} else {
					response.writeHead(200, { 'Content-Type': 'application/json' });
					response.write(JSON.stringify({
						'stdOut': stdOut,
						'stdErr': stdErr
					}));
				}
				response.end();
			});
		});
	}).listen(port);
}
