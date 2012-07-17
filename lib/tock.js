/**
 * Tock master module, this contains the logic for generating the calls to the workers,
 *   pulling the jobs from our datastore, and receiving one-off jobs to run.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  February 11, 2012
 */

/* - Bootstrap our dependencies - */
var config = require('./config');
var moment = require('moment');
var _ = require('underscore');
var async = require('async');
var mongoose = require('mongoose');
var socketIo = require('socket.io');
var Job = require('./model/job');
var JobSchedule = require('./model/jobschedule');
var SingleJob = require('./model/singlejob');
var api = require('./api');
var EventEmitter = require('events').EventEmitter;

// Inherit from event emitter
var master = exports = module.exports = {};
master.prototype.__proto__ = EventEmitter.prototype;

var apiIo = socketIo.listen(api);
var slaveIo = socketIo.listen(config.masterInternalPort);

/**
 * Our error handler for the master
 * @return {object}
 */
var errorHandler = function(errorLevel, message) {
	console.error(errorLevel, message);
	// TODO: Mail or something
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

var dbClient = mongoose.connection.db;
var gridStore = mongoose.mongo.GridStore;
var runningJobs = {};

// Create our socket.io api server config
apiIo.set('log level', 1);
apiIo.sockets.on('connection', function(socket) {
	socket.on('jobSubscribe', function(data) {
		socket.set('jobId', data.jobId);
	});
});

slaveIo.sockets.on('connection', function(socket) {
	socket.on('joinCluster', function(data) {
		socket.join(data.clusterName);
	});
	socket.on('jobComplete', function(data) {
		var job = runningJobs[data.id];
		// Close our gridfs files
		job.stdOutStream.close(function() {});
		job.stdErrStream.close(function() {});
		job.JobModel.TotalRunTime = data.stats.totalRunTime;
		job.JobModel.Pid = data.stats.pid;
		console.log('Total time: ' + data.stats.totalRunTime);
		// Delete our running job entry
		job.JobModel.save(function(err) {
			if (err) {
				errorHandler(errorHandler.ERROR_CRITICAL, err);
				if (callback) return callback(err);
				else return;
			}
			delete runningJobs[JobModel._id];
			if (callback) return callback(null, job.JobModel);
		});
		// Alert our socket clients that we have a finished job
		io.sockets.emit('news', {
			'type': 'Job Finished',
			'jobId': job.JobModel._id,
			'command': job.JobModel.Command,
			'params': job.JobModel.Parameters.join(" "),
			'time': new Date(),
			'message': 'Job ' + job.JobModel.Command + ' finished'
		});
	});
	// If we get standard output, write it to our stream and push to the
	//   socket clients
	socket.on('stdOut', function(data) {
		var job = runningJobs[data.id];
		job.stdOutStream.write(data.stdOut, function(err) {
			if (err) return errorHandler(errorHandler.ERROR_WARNING, JSON.stringify(err));
		});
		_.forEach(dashboardClients, function(dashClient) {
			if (dashClient.get('jobId') != job.JobModel._id) return;
			dashClient.emit('stdOut', {
				'data': job.stdOut
			});
		});
	});
	// If we get standard error, write it to our stream and push to the
	//   socket clients
	socket.on('stdErr', function(data) {
		var job = runningJobs[data.id];
		job.stdErrStream.write(data.stdErr, function(err) {
			if (err) return errorHandler(errorHandler.ERROR_WARNING, JSON.stringify(err));
		});
		_.forEach(dashboardClients, function(dashClient) {
			if (dashClient.get('jobId') != job.JobModel._id) return;
			dashClient.emit('stdErr', {
				'data': job.stdErr							
			});
		});
	});
	socket.on('jobError', function(data) {
		runningJobs[data.id].JobModel.ErrorCode = data.errorCode;
		return errorHandler(errorHandler.ERROR_WARNING, data.errorCode);
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
				JobSchedule.find().run(function(err, results) {
					if (err) return cb(err);
					var validJobs = [];
					results.forEach(function(job) {
						if (isEligibleSlot(job, curMinute)) {
							validJobs.push(job);
						}
					});
					return cb(null, validJobs);
				});
			},
			singleJob: function(cb) {
				SingleJob.find({ ScheduleDateTime: curMinute }).run(cb);
			}
		},
		function(err, results) {
			if (err) return callback(err);
			return callback(null, _.union(results.schedule, results.singleJob));
		}
	);
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
	var socketId, socket, clients;
	// Create job model, populate, save
	var JobModel = new Job({
		JobScheduleId: job._id,
		Command: job.Command,
		Parameters: job.Parameters
	});
	JobModel.save(function(err) {
		if (err) {
			return errorHandler(errorHandler.ERROR_CRITICAL, err);
		}
		// If we are binding to a specific cluster, do that
		if (job.BindCluster) {
			clients = slaveIo.sockets.clients(job.BindCluster);
		} else {
			clients = slaveIo.sockets.clients();
		}
		socketId = _.shuffle(_.keys(clients));
		socket = clients[socketId];
		JobModel.StdOut = 'tock-stdout-' + JobModel._id;
		JobModel.StdErr = 'tock-stderr-' + JobModel._id;
		var stdOutStream, stdErrStream;
		async.parallel(
			{
				stdOut: function(cb) {
					stdOutStream = new gridStore(dbClient, JobModel.StdOut, 'w');
					stdOutStream.open(function(err, store) {
						if (err) return cb(err);
						return cb();
					});
				},
				stdErr: function(cb) {
					stdErrStream = new gridStore(dbClient, JobModel.StdErr, 'w');
					stdErrStream.open(function(err, store) {
						if (err) return cb(err);
						return cb();
					});
				}
			},
			function(err, results) {
				if (err) return errorHandler(errorHandler.ERROR_CRITICAL, JSON.stringify(err));
				runningJobs[JobModel._id] = {
					job: JobModel,
					socket: socketId,
					stdOutStream: stdOutStream,
					stdErrStream: stdErrStream
				};
				socket.emit('spawnJob', { job: JobModel });
				// Write to our client that the job was spawned
				io.sockets.emit('news', {
					'type': 'Job Spawned',
					'jobId': JobModel._id,
					'command': JobModel.Command,
					'params': JobModel.Parameters.join(" "),
					'time': new Date(),
					'message': 'Command ' + JobModel.Command + ' was spawned on host ' + host.host
				});
			}
		);
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
	console.log('Tocked at ' + (new Date()));
	getJobs(curMinute, function(err, results) {
		results.forEach(function(job) {
			if (checkMaxRunning(job)) {
				spawnJob(job);
			} else {
				console.log('Job ' + job._id + ' exceeded maximum concurrency, you got tock-blocked!');
			}
		});
	});
	// Add one minute to now, set the timeout to the difference (in milliseconds) from now
	var d = moment().add('minutes', 1);
	var nextMinute = moment([d.year(), d.month(), d.date(), d.hours(), d.minutes()]);
	setTimeout(dispatch, nextMinute.diff(moment()));
};

/**
 * Check that spawning the given job will not violate the
 *   maximum number of running config
 * @param  {object} job
 * @return {boolean}
 */
var checkMaxRunning = function(job) {
	var totalRunning = 0;
	var idStr = job._id.toString();
	_.forEach(runningJobs, function(runningJob) {
		if (runningJob.JobScheduleId.toString() == idStr) {
			totalRunning++;
		}
	});
	if (totalRunning >= job.MaxRunning) {
		return false;
	}
	return true;
};

/**
 * Expose our tock master server to the API, so we can run one-off jobs,
 *   kill running jobs, etc
 * @param  {object} request
 * @param  {object} response
 * @return {void}
 */
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

// If called directly, run this
if (require.main === module) {
	dispatch();
}

// Otherwise, export
exports = module.exports = dispatch;
