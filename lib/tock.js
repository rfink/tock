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
		EventEmitter = require('events').EventEmitter;

var master = module.exports = {
			listener: new EventEmitter(),
			spawnJob: spawnJob,
			killJob: killJob,
			spawnSingleJob: spawnSingleJob,
			getJobs: getJobs,
			dispatch: dispatch,
			start: start
		},
		subscriberSocket = axon.socket('sub-emitter'),
		publisherSocket = axon.socket('pub-emitter');

// Connect our publisher socket, this will publish jobs to the slaves
publisherSocket.bind(process.env.TOCK_MASTER_PORT || config.masterInternalPort);

// Connect our subscriber socket, this will receive data from the slaves
subscriberSocket.connect(process.env.TOCK_SLAVE_PORT || config.slaveInternalPort);

/**
 * Our error handler for the master
 */
function errorHandler(errorLevel, message) {
	console.error('Error: ' + errorLevel, message);
	// TODO: Mail or something
}

// Constants for the error handler
errorHandler.ERROR_NONE = 0;
errorHandler.ERROR_NOTICE = 1;
errorHandler.ERROR_WARNING = 2;
errorHandler.ERROR_CRITICAL = 3;

var dbClient = mongoose.connection.db,
		gridStore = mongoose.mongo.GridStore,
		runningJobs = {};

subscriberSocket.on('job:complete', function(data) {

	var job = runningJobs[data.id];

	// Close our gridfs files
	job.stdOutStream.close(function() {});
	job.stdErrStream.close(function() {});
	job.JobModel.TotalRunTime = data.stats.totalRunTime;
	job.JobModel.Pid = data.stats.pid;

	console.log('Total time: ' + data.stats.totalRunTime);

	job.JobModel.save(function(err) {

		if (err) {
			errorHandler(errorHandler.ERROR_CRITICAL, err);
			if (callback) return callback(err);
			else return;
		}

		// Delete our running job entry
		delete runningJobs[data.id];
		master.listener.emit('job:complete', job);

	});

});

// If we get standard output, write it to our stream and push to the
//   socket clients
subscriberSocket.on('job:stdOut', function(data) {

	var job = runningJobs[data.id];
	job.stdOutStream.write(data.stdOut, function(err) {
		if (err) return errorHandler(errorHandler.ERROR_WARNING, JSON.stringify(err));
	});
	master.listener.emit('job:stdOut', data);

});

// If we get standard error, write it to our stream and push to the
//   socket clients
subscriberSocket.on('job:stdErr', function(data) {

	var job = runningJobs[data.id];
	job.stdErrStream.write(data.stdErr, function(err) {
		if (err) return errorHandler(errorHandler.ERROR_WARNING, JSON.stringify(err));
	});
	master.listener.emit('job:stdErr', data);

});

subscriberSocket.on('job:error', function(data) {

	runningJobs[data.id].JobModel.ErrorCode = data.errorCode;
	master.listener.emit('job:error', data);
	return errorHandler(errorHandler.ERROR_WARNING, data.errorCode);

});

subscriberSocket.on('job:killed', function(data) {

	if (runningJobs[data.id]) delete runningJobs[data.id];
	master.listener.emit('job:killed', data);

});


/**
 * Get our jobs to run
 * @param  {Date} curMinute
 * @param  {Function} callback
 * @return {object}
 */
function getJobs(curMinute, callback) {

	async.parallel(
		{
			schedule: function(cb) {
				JobSchedule.find().exec(function(err, results) {
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
				SingleJob.find({ ScheduleDateTime: curMinute }).exec(cb);
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
 * @param  {object} job
 * @param  {Date} dateObj
 * @return {Boolean}
 */
function isEligibleSlot(job, dateObj) {

	var curData = {
				Minutes: dateObj.getMinutes() + '',
				Hours: dateObj.getHours() + '',
				Months: (dateObj.getMonth() + 1) + '',
				DaysOfMonth: dateObj.getDate() + '',
				DaysOfWeek: dateObj.getDay() + ''
			},
			flag = true;

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

}

/**
 * Spawn a job to one of our workers
 * @param  {object} job
 * @return {void}
 */
function spawnJob(job) {

	if (!publisherSocket.sock.socks.length) {
		master.listener.emit('job:error', new Error('No clients available'));
		errorHandler(errorHandler.ERROR_WARNING, 'No clients!!');
		return;
	}

	// Create job model, populate, save
	var JobModel = new Job({
		JobScheduleId: job._id,
		Command: job.Command,
		Parameters: job.Parameters
	});

	JobModel.save(function(err) {

		if (err) {
			master.listener.emit('job:error', err);
			return errorHandler(errorHandler.ERROR_CRITICAL, err);
		}

		JobModel.StdOut = 'tock-stdout-' + JobModel._id;
		JobModel.StdErr = 'tock-stderr-' + JobModel._id;

		var stdOutStream,
				stdErrStream;

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

				if (err) {
					master.listener.emit('job:error', err);
					return errorHandler(errorHandler.ERROR_CRITICAL, JSON.stringify(err));
				}

				runningJobs[JobModel._id] = {
					JobModel: JobModel,
					stdOutStream: stdOutStream,
					stdErrStream: stdErrStream
				};

				publisherSocket.emit('job:spawn', JobModel);
				master.listener.emit('job:spawn', JobModel);

			}
		);
	});

}

/**
 * Send a job kill signal to our worker
 * @param  {string} jobId
 * @return {void}
 */
function killJob(jobId) {

	var job = runningJobs[jobId];
	if (!job) return errorHandler(errorHandler.ERROR_WARNING, 'Attempted to kill a non-running job');
	publisherSocket.emit('job:kill', { jobId: jobId });

}

/**
 * Dispatch our jobs for the current minute, and re-queue our timeout
 *   to process
 * @return {void}
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
 * @return {object}
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
 * @param  {object} job
 * @return {boolean}
 */
function checkMaxRunning(job) {

	var totalRunning = 0,
			idStr = job._id.toString();

	_.forEach(runningJobs, function(runningJob, id) {
		if (id == idStr) {
			totalRunning++;
		}
	});

	if (totalRunning >= job.MaxRunning) {
		return false;
	}

	return true;

}

/**
 * Spawn a single job
 * @param  {object}   request
 * @param  {Function} callback
 * @return {object}
 */
function spawnSingleJob(request, callback) {

	var singleJobModel = new SingleJob(request.job, true);
	if (!singleJobModel.ScheduleDateTime) singleJobModel.ScheduleDateTime = Date.now();

	singleJobModel.save(function(err) {
		if (err) {
			callback(err);
			return errorHandler(errorHandler.ERROR_CRITICAL, err);
		}
		callback(null, singleJobModel);
		if (request.job.RunSync) {
			spawnJob(request.job);
		}
	});

}

// If called directly, run this
if (require.main === module) {
	master.dispatch();
}
