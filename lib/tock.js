/**
 * Tock Master module, this contains the logic for generating the calls to the workers,
 *   pulling the jobs from our datastore, and receiving one-off jobs to run.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  February 11, 2012
 */

/* ~ Bootstrap our dependencies ~ */

var config = require('./config'),
		moment = require('moment'),
		_ = require('underscore'),
		async = require('async'),
		mongoose = require('mongoose'),
		axon = require('axon')
		Job = require('./model/job'),
		JobSchedule = require('./model/jobschedule'),
		SingleJob = require('./model/singlejob'),
		EventEmitter = require('events').EventEmitter,
		errorHandler = require('./errorhandler');

var master = module.exports = {
			listener: new EventEmitter(),
			spawnJob: spawnJob,
			killJob: killJob,
			spawnSingleJob: spawnSingleJob,
			getJobs: getJobs,
			dispatch: dispatch,
			getRunningJobs: getRunningJobs,
			start: start
		},
		subscriberSocket = axon.socket('pull'),
		publisherSocket = axon.socket('pub-emitter');

// Connect our publisher socket, this will publish jobs to the slaves
publisherSocket.bind(config.masterInternalPort);

// Connect our subscriber socket, this will receive data from the slaves
subscriberSocket.format('json');
subscriberSocket.connect(config.slaveInternalPort);

var dbClient = mongoose.connection.db,
		GridStore = mongoose.mongo.GridStore,
		runningJobs = {};

subscriberSocket.on('message', function(message) {

	var router = {

		/**
		 * Job is completed, close our streams and save the job data
		 */
		'job:complete': function(data) {

			return getJobById(data.id, function(err, job) {

				if (err) return errorHandler(errorHandler.ERROR_WARNING, err);

				// Close our gridfs files
				job.stdOutStream.close(function() {});
				job.stdErrStream.close(function() {});
				job.jobModel.totalRunTime = data.stats.totalRunTime;
				job.jobModel.pid = data.stats.pid;

				console.log('Total time: ' + data.stats.totalRunTime);

				job.jobModel.save(function(err) {

					if (err) return errorHandler(errorHandler.ERROR_CRITICAL, err);

					// Delete our running job entry
					delete runningJobs[ data.id ];
					master.listener.emit('job:complete', job);

				});

			});

		},

		/** 
		 * If we get standard output, write it to our stream and push to the
		 *   socket clients
		 */
		'job:stdOut': function(data) {

			return getJobById(data.id, function(err, job) {

				if (err) return errorHandler(errorHandler.ERROR_WARNING, err);

				job.stdOutStream.write(data.stdOut, function(err) {
					if (err) return errorHandler(errorHandler.ERROR_WARNING, JSON.stringify(err));
				});

				master.listener.emit('job:stdOut', data);

			});

		},

		/**
		 * If we get standard error, write it to our stream and push to the
		 *   socket clients
		 */
		'job:stdErr': function(data) {

			return getJobById(data.id, function(err, job) {

				if (err) return errorHandler(errorHandler.ERROR_WARNING, err);

				job.stdErrStream.write(data.stdErr, function(err) {
					if (err) return errorHandler(errorHandler.ERROR_WARNING, JSON.stringify(err));
				});

				master.listener.emit('job:stdErr', data);

			});

		},

		/**
		 * Error handler for job errors
		 */
		'job:error': function(data) {

			return getJobById(data.id, function(err, job) {

				if (err) return errorHandler(errorHandler.ERROR_WARNING, err);

				job.jobModel.errorCode = data.errorCode;
				master.listener.emit('job:error', data);
				return errorHandler(errorHandler.ERROR_WARNING, data.errorCode);

			});

		},

		/**
		 * Emitted when a job is successfully killed in the worker
		 */
		'job:killed': function(data) {

			if (runningJobs[ data.id ]) delete runningJobs[ data.id ];
			master.listener.emit('job:killed', data);

		},

		/**
		 * If our master disconnects and then re-connects, our children
		 *   will emit their list of running jobs so we can keep receiving data
		 *   on their behalf
		 */
		'master:reconnect': function(data) {
			// Don't need to do anything here, yet
		},

		/**
		 * Register to our runningJobs stack that work has been assigned and started
		 */
		'job:workStarted': function(data) {

			return getJobById(data.jobId, function(err, job) {

				job.workerId = data.workerId;
				job.jobModel.pid = data.pid;
				job.jobModel.host = data.hostname;

			});

		}

	};

	// Route our message to the correct function
	if (router[ message.event ]) return router[ message.event ](message.data);
	else return errorHandler(errorHandler.ERROR_WARNING, new Error('Route ' + message.event + ' not found'));

});

/**
 * Get our jobs to run
 */
function getJobs(curMinute, callback) {

	return async.parallel(
		{
			schedule: function(cb) {

				return JobSchedule.find().exec(function(err, results) {

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
				return SingleJob.find({ scheduleDateTime: curMinute }).exec(cb);
			}
		},
		function(err, results) {

			if (err) return callback(err);
			return callback(null, _.union(results.schedule, results.singleJob));

		}
	);

}

/**
 * Determine if our given job is eligible for the current slot,
 *   based on the given date object
 */
function isEligibleSlot(job, dateObj) {

	var curData = {
				minutes: dateObj.getMinutes() + '',
				hours: dateObj.getHours() + '',
				months: (dateObj.getMonth() + 1) + '',
				daysOfMonth: dateObj.getDate() + '',
				daysOfWeek: dateObj.getDay() + ''
			},
			flag = true;

	Object.keys(curData).forEach(function(key) {

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

}

/**
 * Spawn a job to one of our workers
 */
function spawnJob(job) {

	if (!publisherSocket.sock.socks.length) {
		master.listener.emit('job:error', new Error('No clients available'));
		return errorHandler(errorHandler.ERROR_WARNING, new Error('No clients!!'));
	}

	// Create job model, populate, save
	var jobModel = new Job({
		jobScheduleId: job._id,
		command: job.command,
		parameters: job.parameters
	});

	jobModel.save(function(err) {

		if (err) {
			master.listener.emit('job:error', err);
			return errorHandler(errorHandler.ERROR_CRITICAL, err);
		}

		getFileStreams(jobModel, function(err, streams) {

			if (err) {
				master.listener.emit('job:error', err);
				return errorHandler(errorHandler.ERROR_CRITICAL, JSON.stringify(err));
			}

			// Save our job model to persist the stdOut and stdErr file names
			jobModel.save(function(err) {
				if (err) return errorHandler(errorHandler.ERROR_WARNING, err);
			});

			runningJobs[jobModel._id] = {
				jobModel: jobModel,
				stdOutStream: streams.stdOutStream,
				stdErrStream: streams.stdErrStream
			};

			publisherSocket.emit('job:spawn', jobModel);
			master.listener.emit('job:spawn', jobModel);

		});

	});

}

/**
 * Get our file streams and send the data to the callback
 */
function getFileStreams(jobModel, callback) {

	var stdOutStream,
			stdErrStream;

	// Set up our file names, if they don't exist
	if (!jobModel.stdOut) jobModel.stdOut = 'tock-stdout-' + jobModel._id;
	if (!jobModel.stdErr) jobModel.stdErr = 'tock-stderr-' + jobModel._id;

	return async.parallel(
		{
			stdOut: function(cb) {
				stdOutStream = new GridStore(dbClient, jobModel.stdOut, 'w');
				stdOutStream.open(function(err, store) {
					if (err) return cb(err);
					return cb();
				});
			},
			stdErr: function(cb) {
				stdErrStream = new GridStore(dbClient, jobModel.stdErr, 'w');
				stdErrStream.open(function(err, store) {
					if (err) return cb(err);
					return cb();
				});
			}
		},
		function(err, results) {
			if (err) return callback(err);
			return callback(null, {
				stdOutStream: stdOutStream,
				stdErrStream: stdErrStream
			});
		}
	);

}

/**
 * Send a job kill signal to our worker
 */
function killJob(jobId) {

	var job = runningJobs[jobId];
	if (!job) return errorHandler(errorHandler.ERROR_WARNING, 'Attempted to kill a non-running job');
	publisherSocket.emit('job:' + job.workerId + ':kill', { jobId: jobId });

}

/**
 * Dispatch our jobs for the current minute, and re-queue our timeout
 *   to process
 */
function dispatch() {

	// I don't QUITE trust javascript's set-timeout, so instead of trusting that we ran on or after
	//   the :00 seconds, round the time to the nearest minute
	var curMinute = new Date(Math.round(Date.now() / (1000 * 60)) * 1000 * 60);
	console.log('Tocked at ' + (new Date()));

	getJobs(curMinute, function(err, results) {
		results.forEach(function(job) {
			if (checkMaxRunning(job)) {
				master.spawnJob(job);
			} else {
				console.log('Job ' + job._id + ' exceeded maximum concurrency, you got tock-blocked!');
			}
		});
	});

	start();

}

/**
 * Schedule next tock-ing
 */
function start() {

	// Add one minute to now, set the timeout to the difference (in milliseconds) from now
	var d = moment().add('minutes', 1),
			nextMinute = moment([d.year(), d.month(), d.date(), d.hours(), d.minutes()]);

	return setTimeout(master.dispatch, nextMinute.diff(moment()));

}

/**
 * Check that spawning the given job will not violate the
 *   maximum number of running config
 */
function checkMaxRunning(job) {

	var totalRunning = 0,
			idStr = job._id.toString();

	_.forEach(runningJobs, function(runningJob, id) {
		if (runningJob.jobModel.jobScheduleId && runningJob.jobModel.jobScheduleId == idStr) {
			totalRunning++;
		}
	});

	if (totalRunning >= job.maxRunning) {
		return false;
	}

	return true;

}

/**
 * Spawn a single job
 */
function spawnSingleJob(request, callback) {

	var singleJobModel = new SingleJob(request.job, true);
	if (!singleJobModel.scheduleDateTime) singleJobModel.scheduleDateTime = Date.now();

	singleJobModel.save(function(err) {
		if (err) {
			callback(err);
			return errorHandler(errorHandler.ERROR_CRITICAL, err);
		}
		callback(null, singleJobModel);
		if (request.job.runSync) {
			spawnJob(request.job);
		}
	});

}

/**
 * Get running job list
 */
function getRunningJobs() {
	var ret = {};
	Object.keys(runningJobs).forEach(function(jobId) {
		ret[jobId] = runningJobs[ jobId ].jobModel;
		ret[jobId].status = 'running';
	});
	return ret;
}

/**
 * Get job by id, if it's already in memory, return that
 *   Otherwise, fetch from mongo, set in memory, and return
 */
function getJobById(id, callback) {
	
	if (runningJobs[ id ] && runningJobs[ id ].jobModel) {
		return process.nextTick(function() {
			return callback(null, runningJobs[ id ]);
		});
	} else if (runningJobs[ id ]) {
		return runningJobs[ id ].queue.push(callback);
	}

	runningJobs[ id ] = { queue: [] };

	return Job.findById(id, function(err, jobModel) {

		if (err) return callback(err);
		var jobEntry = { jobModel: jobModel };

		return getFileStreams(jobModel, function(err, results) {

			if (err) return callback(err);
			var tempQueue = runningJobs[ id ].queue.slice(0),
					ret;

			jobEntry.stdOutStream = results.stdOutStream;
			jobEntry.stdErrStream = results.stdErrStream;
			runningJobs[ id ] = jobEntry;
			ret = callback(null, runningJobs[ id ]);

			tempQueue.forEach(function(cb) {
				cb(null, runningJobs[ id ]);
			});

			return ret;

		});

	});	

}

// If called directly, run this
if (require.main === module) {
	master.dispatch();
}
