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
var async = require('async');
var fs = require('fs');
var http = require('http');
var mongoose = require('mongoose');
var io = require('socket.io').listen(config.ioSocketPort);
var Job = require('./model/job');
var JobSchedule = require('./model/jobschedule');
var SingleJob = require('./model/singlejob');
var jsonParse = require('JSONStream').parse;

/**
 * Our error handler for the master
 * @return {object}
 */
var errorHandler = function(errorLevel, message) {
	console.error(errorLevel, message);
};
// Constants for the error handler
errorHandler.ERROR_NONE = 0;
errorHandler.ERROR_NOTICE = 1;
errorHandler.ERROR_WARNING = 2;
errorHandler.ERROR_CRITICAL = 3;

mongoose.connect('mongodb://' + config.dataStore.host + '/Tock', function(err) {
	if (err) {
		errorHandler(errorHandler.ERROR_CRITICAL, JSON.stringify(err));
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

/**
 * Get our jobs to run
 * @param  {Date} curMinute
 * @param  {Function} callback
 * @return {object}
 */
var getJobs = function(curMinute, callback) {
	async.parallel(
		{
			schedule: function(cb) {
				JobSchedule.find().run(cb);
			},
			singleJob: function(cb) {
				SingleJob.find({ ScheduleDateTime: curMinute }).run(cb);
			}
		},
		function(err, results) {
			if (err) return callback(err);
			return _.union(results.schedule, results.singleJob);
		}
	);
	JobSchedule.find().run(function(err, results) {
		if (err) return callback(err);
		return callback(null, results);
	});
};

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
var spawnJob = function(job, callback) {
	var host = null;
	// Determine which server to send to
	if (!job.BindHost) {
		var shuffledHosts = _.shuffle(config.hosts);
		host = config.hosts[0];
	} else {
		for (var i = 0, len = config.hosts.length; i < len; ++i) {
			if (config.hosts[i].host === job.BindHost) {
				host = config.hosts[i].host;
				break;
			}
		}
		if (!host) {
			return errorHandler(errorHandler.ERROR_WARNING, 'Unable to acquire host for job ' + job.Command);
		}
	}
	// Create job model, populate, save
	var JobModel = new Job({
		JobScheduleId: job._id,
		Command: job.Command,
		Parameters: job.Parameters
	});
	JobModel.Host = host.host;
	JobModel.Port = host.port;
	JobModel.save(function(err) {
		if (err) {
			return errorHandler(errorHandler.ERROR_CRITICAL, err);
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
					return errorHandler(errorHandler.ERROR_WARNING, errorCode);
				} else if (typeof obj.stats !== 'undefined') {
					JobModel.TotalRunTime = obj.stats.totalRunTime;
					JobModel.Pid = obj.stats.pid;
					console.log('Total time: ' + obj.stats.totalRunTime);
				}
			});
			res.on('end', function() {
				if (runningJobs[JobModel._id]) delete runningJobs[JobModel._id];
				JobModel.save(function(err) {
					if (err) {
						errorHandler(errorHandler.ERROR_CRITICAL, err);
						if (callback) return callback(err);
						else return;
					}
					if (callback) return callback(null, JobModel);
				});
				// Alert our socket clients that we have a finished job
				_.forEach(dashboardClients, function(socket) {
					socket.emit('news', {
						'type': 'Job Finished',
						'jobId': JobModel._id,
						'command': JobModel.Command,
						'params': JobModel.Parameters.join(" "),
						'host': host.host,
						'time': new Date(),
						'message': 'Job ' + JobModel.Command + ' finished'
					});
				});
			});
		});
		request.write(JSON.stringify({requestType: 'spawnJob', payload: JobModel}));
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
				'time': new Date(),
				'message': 'Command ' + JobModel.Command + ' was spawned on host ' + host.host
			});
		});
	});	
};

/**
 * Send a job kill signal to our worker
 * @param  {string} jobId
 * @return {void}
 */
var killJob = function(jobId, callback) {
	if (!runningJobs[jobId]) return errorHandler(errorHandler.ERROR_WARNING, 'Attempted to kill a non-running job');
	var job = runningJobs[jobId];
	var request = http.request({host: job.Host, port: job.Port, method: 'POST'}, function(res) {
		var data = '';
		res.on('data', function(chunk) {
			data += chunk;
		});
		res.on('end', function() {
			var response = JSON.parse(data);
			console.log(response);
			if (callback) callback(null, response);
		});
	});
	request.write(JSON.stringify({requestType: 'killJob', payload: {jobId: jobId}}));
	request.end();
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
	getJobs(curMinute, function(err, results) {
		results.forEach(function(job) {
			if (isEligibleSlot(job, curMinute)) {
				spawnJob(job);
			}
		});
	});
	// Add one minute to now, set the timeout to the difference (in milliseconds) from now
	var d = moment().add('minutes', 1);
	var nextMinute = moment([d.year(), d.month(), d.date(), d.hours(), d.minutes()]);
	setTimeout(dispatch, nextMinute.diff(moment()));
};

/**
 * Expose our tock master server to the API, so we can run one-off jobs,
 *   kill running jobs, etc
 * @param  {object} request
 * @param  {object} response
 * @return {void}
 */
http.createServer(function(request, response) {
	var data = '';
	request.on('data', function(chunk) {
		data += chunk;
	});
	request.on('end', function() {
		var reqBody = JSON.parse(data);
		switch (reqBody.requestType) {
			case 'spawnJob':
				var singleJobModel = new SingleJob(reqBody.job, true);
				if (!singleJobModel.ScheduleDateTime) singleJobModel.ScheduleDateTime = Date.now();
				singleJobModel.save(function(err) {
					if (err) {
						response.write(JSON.stringify(err));
						response.end();
						return errorHandler(errorHandler.ERROR_CRITICAL, err);
					}
					if (reqBody.job.RunSync) {
						spawnJob(reqBody.job, function(err, spawnJobResponse) {
							if (err) {
								response.write(JSON.stringify(err));
								response.end();
								return errorHandler(errorHandler.ERROR_WARNING, err);
							}
							response.write(JSON.stringify(spawnJobResponse));
							response.end();
						});	
					} else {
						response.write(JSON.stringify(singleJobModel));
						response.end();
					}
				});
				break;
			case 'killJob':
				killJob(reqBody.id, function(err, killJobResponse) {
					if (err) {
						response.write(JSON.stringify(err));
						response.end();
						return errorHandler(errorHandler.ERROR_WARNING, err);
					}
					response.write(JSON.stringify(killJobResponse));
					response.end();
				});
				break;
			default:
				errorHandler(errorHandler.ERROR_NOTICE, 'Invalid request type');	
		}
	});
}).listen(config.masterPort);

// TODO: Should this be an export, so we can kickstart this thing with an init.d script
dispatch();
