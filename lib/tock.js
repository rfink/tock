/**
 * Tock master module, this contains the logic for generating the calls to the workers,
 *   pulling the jobs from our datastore, and receiving one-off jobs to run.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  February 11, 2012
 */

/* - Bootstrap our dependencies - */
var moment = require('moment');
var config = require('./config');
var _ = require('underscore');
var fs = require('fs');
var http = require('http');
var mongoose = require('mongoose');
var io = require('socket.io').listen(config.ioSocketPort);
var Job = require('./model/job');
var JobSchedule = require('./model/jobschedule');
var jsonParse = require('JSONStream').parse;

mongoose.connect('mongodb://' + config.dataStore.host + '/Tock', function(err) {
	if (err) {
		console.error(err);
		process.exit(1);
	}
});

var runningJobs = {};
var dashboardClients = {};

// Create our socket.io server config
io.set('log level', 1);
io.sockets.on('connection', function(socket) {
	dashboardClients[socket.id] = socket;
	socket.on('jobSubscribe', function(data) {
		socket.jobId = data.jobId;
	});
	socket.on('disconnect', function() {
		delete dashboardClients[socket.id];
	});
});

var jobs = [
	/*{
		Command: 'ls',
		Parameters: ['al'],
		Minutes: '*',
		Hours: '*',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '*'
	},*/
	/*{
		Command: 'ps',
		Parameters: ['aux'],
		Minutes: '*',
		Hours: '5',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '*'
	},*/
	{
		Command: '/usr/local/bin/node',
		Parameters: ['/var/www/html/nodejs/sandbox/consolelogger.js'],
		Minutes: '*',
		Hours: '*',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '*'
	}/*,
	{
		Command: 'pwd',
		Parameters: [],
		Minutes: '*',
		Hours: '*',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '0'
	}*/
];

/**
 * Determine if our given job is eligible for the current slot,
 *   based on the given date object
 * @param  {object} job
 * @param  {Date} dateObj
 * @return {Boolean}
 */
var isEligibleSlot = function(job, dateObj) {
	var curData = {
		Minutes: dateObj.getMinutes() + '',
		Hours: dateObj.getHours() + '',
		Months: (dateObj.getMonth() + 1) + '',
		DaysOfMonth: dateObj.getDate() + '',
		DaysOfWeek: dateObj.getDay() + ''
	};

	var flag = true;

	['Minutes', 'Hours', 'Months', 'DaysOfMonth', 'DaysOfWeek'].forEach(function(key) {
		if (job[key] === '*') return;
		if (job[key] == curData[key]) return;
		if (job[key].indexOf(',') !== -1) {
			var nums = job[key].split(',');
			if (nums.indexOf(curData[key]) !== -1) {
				return;
			}
		} else if (job[key].indexOf('/') !== -1) {
			var denom = parseInt(job[key].split('/').pop(), 10);
			if (!(curData[key] % denom)) {
				return;
			}
		}
		flag = false;
	});
	return flag;
};

/**
 * Spawn a job to one of our workers
 * @param  {object} job
 * @return {void}
 */
var spawnJob = function(job) {
	var host = {};
	// Determine which server to send to
	if (!job.BindHost) {
		var shuffledHosts = _.shuffle(config.hosts);
		host = config.hosts[0];
	} else {
		for (var i = 0, len = configs.hosts.length; i < len; ++i) {
			if (config.hosts[i].host === job.BindHost) {
				host = config.hosts[i].host;
				break;
			}
		}
		// TODO: Error check for found host
	}
	var JobModel = new Job(job);
	JobModel.save(function(err) {
		if (err) {
			// TODO: What??
			console.error(err);
			return;
		}
		var request = http.request({host: host.host, port: host.port, method: 'POST'}, function(res) {
			var errorCode = null;
			var stdOutName = '/tmp/tock-stdout-' + JobModel._id;
			var stdErrName = '/tmp/tock-stderr-' + JobModel._id;
			var stdOutStream = fs.createWriteStream(stdOutName);
			var stdErrStream = fs.createWriteStream(stdErrName);
			var jsonPipe = jsonParse([/./]);
			res.pipe(jsonPipe);
			jsonPipe.on('data', function(obj) {
				if (obj.stdOut) {
					stdOutStream.write(obj.stdOut);
					_.forEach(dashboardClients, function(socket) {
						if (socket.jobId != JobModel._id) return;
						socket.emit('stdOut', {
							'data': obj.stdOut
						});
					});
				} else if (obj.stdErr) {
					stdErrStream.write(obj.stdErr);
					_.forEach(dashboardClients, function(socket) {
						if (socket.jobId != JobModel._id) return;
						socket.emit('stdErr', {
							'data': obj.stdErr							
						});
					});
				} else if (typeof obj.errorCode !== 'undefined') {
					errorCode = obj.errorCode;
					// TODO: Error
				} else if (typeof obj.totalTime !== 'undefined') {
					console.log('Total time: ' + obj.totalTime);
				}
			});
			res.on('end', function() {
				// Alert our socket clients that we have a finished job
				_.forEach(dashboardClients, function(socket) {
					socket.emit('news', {
						'type': 'Job Finished',
						'message': 'Job ' + JobModel.Command + ' finished'
					});
				});
			});
		});
		request.write(JSON.stringify(JobModel));
		request.end();
		runningJobs[JobModel._id] = JobModel;
		// Write to our client that the job was spawned
		_.forEach(dashboardClients, function(socket) {
			socket.emit('news', {
				'type': 'Job Spawned',
				'jobId': JobModel._id,
				'command': JobModel.Command,
				'params': JobModel.Parameters.join(" "),
				'host': host.host,
				'message': 'Command ' + JobModel.Command + ' was spawned on host ' + host.host
			});
		});
	});	
};

/**
 * Dispatch our jobs for the current minute, and re-queue our timeout
 *   to process
 * @return {void}
 */
var dispatch = function() {
	// I don't QUITE trust javascript's set-timeout, so instead of trusting that we ran on or after
	//   the :00 seconds, round the time to the nearest minute
	var curMinute = new Date(Math.round(Date.now() / (1000 * 60)) * 1000 * 60);
	_.forEach(jobs, function(job) {
		if (isEligibleSlot(job, curMinute)) {
			spawnJob(job);
		}
	});
	// Add one minute to now, set the timeout to the difference (in milliseconds) from now
	var d = moment().add('minutes', 1);
	var nextMinute = moment([d.year(), d.month(), d.date(), d.hours(), d.minutes()]);
	setTimeout(dispatch, nextMinute.diff(moment()));
};

/**
 * Create our one-off job server, job comes in with common
 *   job params via request object
 * @param  {object} request
 * @param  {object} response
 * @return {void}
 */
http.createServer(function(request, response) {
	spawnJob(request.job);
	response.end();
}).listen(16162);

dispatch();
