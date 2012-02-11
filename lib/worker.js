/**
 * Module for creating a worker to listen on the queue for new jobs.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  December 23, 2011
 */

var config = require('./config');
var cluster = require('cluster');
var child_process = require('child_process');
var http = require('http');
var restler = require('restler');
var fs = require('fs');
var crypto = require('crypto');
var async = require('async');

var numWorkers = 5;
var port = 8989;
var tockPort = 15162;
var client = 'localhost';
var stdOutFilePrefix = '/tmp/tock-temp-stdout-';
var stdErrFilePrefix = '/tmp/tock-temp-stderr-';

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
		//var client = req.headers.host;
		var data = '';
		req.on('data', function(chunk) {
			data += chunk;
		});
		req.on('end', function() {
			// End response immediately, we don't need to do anything with it right now
			res.end();
			var job = JSON.parse(data);
			var startTime = Date.now();
			
			// Create hashed file name to hold our standard out and standard error
			var shaSum = crypto.createHash('sha1');
			shaSum.update(startTime + '' + job.Command);
			var hash = shaSum.digest('hex');
			var stdOutFileName = stdOutFilePrefix + hash + '.m';
			var stdErrFileName = stdErrFilePrefix + hash + '.m';

			var stdOutStream = fs.createWriteStream(stdOutFileName);
			var stdErrStream = fs.createWriteStream(stdErrFileName);

			async.parallel(
				{
					'stdOut': function(callback) {
						stdOutStream.once('open', function(fd) {
							callback();
						});
					},
					'stdErr': function(callback) {
						stdErrStream.once('open', function(fd) {
							callback();
						});
					}
				},
				function(err, results) {
					if (err) {
						// TODO: What??
					}
					startTime = Date.now();
					var process = child_process.spawn(job.Command);
					process.stdout.pipe(stdOutStream);
					//process.stderr.pipe(stdErrStream);
					stdErrStream.write('MRF');
					process.on('exit', function(errorCode) {
						var totalRunTime = (Date.now() - startTime);
						if (errorCode) {
							// TODO: What??
						}
						restler.post('http://' + client + ':' + tockPort, {
							multipart: true,
							data: {
								'stdOut': restler.file(stdOutFileName),
								'stdErr': restler.file(stdErrFileName)
							}
						}).on('complete', function(data) {
							console.log(data);
							fs.unlink(stdOutFileName);
							fs.unlink(stdErrFileName);
						});
					});
				}
			);
		});
	}).listen(port);
}
