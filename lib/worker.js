/**
 * Module for creating a worker to listen on the queue for new jobs.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  December 23, 2011
 */

var config = require('./config');
var cluster = require('cluster');
var child_process = require('child_process');
var http = require('http');
var request = require('request');
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
			var stdOutFileName = stdOutFilePrefix + hash;
			var stdErrFileName = stdErrFilePrefix + hash;

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
					process.stderr.pipe(stdErrStream);
					/*process.stdout.on('data', function(chunk) {
						stdOutStream.write(chunk);
					});
					process.stderr.on('data', function(chunk) {
						stdErrStream.write(chunk);
					});*/
					process.on('exit', function(errorCode) {
						var totalRunTime = (Date.now() - startTime);
						if (errorCode) {
							// TODO: What??
						}
						var attachments = {};
						attachments[stdOutFileName] = {
							'follows': true,
							'content-type': 'text/plain'
						};
						attachments[stdErrFileName] = {
							'follows': true,
							'content-type': 'text/plain'
						};
						request({
							method: 'PUT',
							uri: 'http://' + client + tockPort,
							multipart: [
								{
									'content-type': 'application/json',
									'body': JSON.stringify({
										_attachments: attachments
									})
								}
							]
						},
						function(error, response, body) {
							console.log(arguments);
						});
					});
				}
			);
		});
	}).listen(port);
}
