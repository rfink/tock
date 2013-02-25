
/* ~ Application our dependencies ~ */

var debug = require('debug')('tock-master')
		, envcfg = require('envcfg')
		, config = envcfg(__dirname + '/config.json')
		, moment = require('moment')
		, _ = require('underscore')
		, async = require('async')
		, mongoose = require('./mongocommon')
		, Job = require('./model/job')
		, JobSchedule = require('./model/jobschedule')
		, SingleJob = require('./model/singlejob')
		, TockClient = require('./client/tockclient')
		, EventEmitter = require('events').EventEmitter
		, logger = require('./logger');

var dbClient = mongoose.connection.db
		, GridStore = mongoose.mongo.GridStore;

exports = module.exports = Tock;

/**
 * Tock constructor
 */

function Tock() {

	EventEmitter.call(this);
	this.runningJobs = {};
	this.pendulum;
	this.client = new TockClient();
	this.client.on('message', this.router.bind(this));
	this.client.connect();

}

Tock.prototype.__proto__ = EventEmitter.prototype;

/**
 * Router for incoming subscriber messages
 */

Tock.prototype.router = function(message) {

	var routes = {
		'job:complete': this.onJobCompleted.bind(this)
		, 'job:killed': this.onJobKilled.bind(this)
		, 'job:stdOut': this.onJobStdOut.bind(this)
		, 'job:stdErr': this.onJobStdErr.bind(this)
		, 'job:error': this.onJobError.bind(this)
		, 'work:started': this.onWorkStarted.bind(this)
	};

	if (routes[ message.event ]) return routes[ message.event ](message.data);
	else return logger.warn(new Error('Route ' + message.event + ' not found'));

	return this;

};

/**
 * Called when a job completes
 */

Tock.prototype.onJobCompleted = function(data) {

	var self = this;

	return this.getJobById(data.id, function(err, job) {

		if (err) return logger.warn(err);

		// Close our gridfs files
		job.stdOutStream.close(function() {});
		job.stdErrStream.close(function() {});
		job.jobModel.totalRunTime = data.stats.totalRunTime;
		job.jobModel.pid = data.stats.pid;

		debug('Total time: ' + data.stats.totalRunTime);

		job.jobModel.save(function(err) {

			if (err) return logger.error(err);

			// Delete our running job entry
			delete self.runningJobs[ data.id ];
			self.emit('job:complete', job);

		});

	});

};

/**
 * Called when a job is finished being killed
 */

Tock.prototype.onJobKilled = function(data) {

	if (this.runningJobs[ data.id ]) delete this.runningJobs[ data.id ];
	this.emit('job:killed', data);

	return this;

};

/**
 * Called when a job receives standard out output
 */

Tock.prototype.onJobStdOut = function(data) {

	var self = this;

	return this.getJobById(data.id, function(err, job) {

		if (err) return logger.warn(err);

		job.stdOutStream.write(data.stdOut, function(err) {
			if (err) return logger.warn(err);
		});

		self.emit('job:stdOut', data);

	});

};

/**
 * Called when a job received standard error output
 */

Tock.prototype.onJobStdErr = function(data) {

	var self = this;

	return this.getJobById(data.id, function(err, job) {

		if (err) return logger.warn(err);

		job.stdErrStream.write(data.stdErr, function(err) {
			if (err) return logger.warn(err);
		});

		self.emit('job:stdErr', data);

	});

};

/**
 * Called when a job has an unrecoverable error
 */

Tock.prototype.onJobError = function(data) {

	var self = this;

	return this.getJobById(data.id, function(err, job) {

		if (err) return logger.warn(err);

		job.jobModel.errorCode = data.errorCode;
		self.emit('job:error', data);
		return logger.warn(new Error('Job error'), data);

	});

};

/**
 * Called when work is marked as started on a job
 */

Tock.prototype.onWorkStarted = function(data) {

	var self = this;

	return this.getJobById(data.job._id, function(err, job) {

		job.workerId = data.params.workerId;
		job.jobModel.pid = data.params.pid;
		job.jobModel.host = data.params.hostname;
		
		self.emit('job:spawn', job.jobModel);

	});

};

/**
 * Get our jobs to run
 */

Tock.prototype.getJobs = function(curMinute, callback) {

	var self = this
			, parallelJobs = { schedule: schedule, singleJob: singleJob };

	function schedule(cb) {

		return JobSchedule.find().exec(function(err, results) {

			if (err) return cb(err);

			var validJobs = [];

			results.forEach(function(job) {
				if (self.isEligibleSlot(job, curMinute)) {
					validJobs.push(job);
				}
			});

			function saveJob(scheduleRecord, done) {
				var job = new Job({
					jobScheduleId: scheduleRecord._id
					, command: scheduleRecord.command
					, parameters: scheduleRecord.parameters
				});
				job.save(done);
			}

			return async.map(validJobs, saveJob, cb);

		});

	}

	function singleJob(cb) {

		return SingleJob.find({ scheduleDateTime: curMinute }).exec(function(err, jobs) {

			if (err) return cb(err);

			function saveJob(jobRecord, done) {
				var job = new Job({
					command: jobRecord.command
					, parameters: jobRecord.parameters
				});
				job.save(done);
			}

			async.map(jobs, saveJob, cb);

		});

	}

	function handleResults(err, results) {

		if (err) return callback(err);
		return callback(null, _.union(results.schedule, results.singleJob));

	}

	return async.parallel(parallelJobs, handleResults);

};

/**
 * Determine if our given job is eligible for the current slot,
 *   based on the given date object
 */

Tock.prototype.isEligibleSlot = function(job, dateObj) {

	var curData = {
				minutes: dateObj.getMinutes() + ''
				, hours: dateObj.getHours() + ''
				, months: (dateObj.getMonth() + 1) + ''
				, daysOfMonth: dateObj.getDate() + ''
				, daysOfWeek: dateObj.getDay() + ''
			},
			flag = true;

	Object.keys(curData).forEach(function(key) {

		if (job[ key ] === '*') return;
		if (job[ key ] == curData[key]) return;
		if (job[ key ].indexOf(',') !== -1) {
			var nums = job[ key ].split(',');
			if (nums.indexOf(curData[ key ]) !== -1) {
				return;
			}
		} else if (job[ key ].indexOf('/') !== -1) {
			var denom = parseInt(job[ key ].split('/').pop(), 10);
			if (!(curData[ key ] % denom)) {
				return;
			}
		}

		flag = false;

	});

	return flag;

};

/**
 * Spawn a job to one of our workers
 */

Tock.prototype.spawnJob = function(job) {

	var self = this;

	this.getFileStreams(job, function(err, streams) {

		if (err) {
			self.emit('job:error', err);
			return logger.error(err);
		}

		// Save our job model to persist the stdOut and stdErr file names
		job.save(function(err) {
			if (err) return logger.error(err);
		});

		self.runningJobs[ job._id ] = {
			jobModel: job
			, stdOutStream: streams.stdOutStream
			, stdErrStream: streams.stdErrStream
		};

		self.client.spawnJob(job);

	});

};

/**
 * Get our file streams and send the data to the callback
 */

Tock.prototype.getFileStreams = function(jobModel, callback) {

	var stdOutStream
			, stdErrStream
			, parallelJobs = { stdOut: stdOut, stdErr: stdErr };

	// Set up our file names, if they don't exist
	if (!jobModel.stdOut) jobModel.stdOut = 'tock-stdout-' + jobModel._id;
	if (!jobModel.stdErr) jobModel.stdErr = 'tock-stderr-' + jobModel._id;

	function stdOut(cb) {

		stdOutStream = new GridStore(dbClient, jobModel.stdOut, 'w');
		stdOutStream.open(function(err, store) {
			if (err) return cb(err);
			return cb();
		});

	}

	function stdErr(cb) {
		stdErrStream = new GridStore(dbClient, jobModel.stdErr, 'w');
		stdErrStream.open(function(err, store) {
			if (err) return cb(err);
			return cb();
		});
	}

	function handleResults(err, results) {

		if (err) return callback(err);
		return callback(null, {
			stdOutStream: stdOutStream,
			stdErrStream: stdErrStream
		});

	}

	return async.parallel(parallelJobs, handleResults);

};

/**
 * Send a job kill signal to our worker
 */

Tock.prototype.killJob = function(jobId) {

	var job = this.runningJobs[ jobId ];
	if (!job) return logger.warn(new Error('Attempted to kill a non-running job'), { id: jobId });
	this.client.killJob(jobId);

	return this;

};

/**
 * Dispatch our jobs for the current minute, and re-queue our timeout to process
 */

Tock.prototype.dispatch = function() {

	var self = this;

	// I don't QUITE trust javascript's set-timeout, so instead of trusting that we ran on or after
	//   the :00 seconds, round the time to the nearest minute
	var curMinute = new Date(Math.round(Date.now() / (1000 * 60)) * 1000 * 60);
	this.emit('tock:start', { time: curMinute });
	debug('Tocked at ' + (new Date()));

	this.getJobs(curMinute, function(err, results) {
		results.forEach(function(job) {
			if (self.checkMaxRunning(job)) {
				self.spawnJob(job);
			} else {
				debug('Job ' + job._id + ' exceeded maximum concurrency, you got tock-blocked!');
				self.emit('job:max:concurrency', { date: new Date(), id: job._id });
			}
		});
	});

	return self.start();

};

/**
 * Schedule next tock-ing
 */

Tock.prototype.start = function() {

	// Add one minute to now, set the timeout to the difference (in milliseconds) from now
	var d = moment().add('minutes', 1)
			, nextMinute = moment([d.year(), d.month(), d.date(), d.hours(), d.minutes()]);

	// Make sure we only ever have one instance running
	if (this.pendulum) clearTimeout(this.pendulum);
	this.pendulum = setTimeout(this.dispatch.bind(this), nextMinute.diff(moment()));

	return this;

};

/**
 * Stop our tock service
 */

Tock.prototype.stop = function() {

	if (this.pendulum) clearTimeout(this.pendulum);
	return this;

};

/**
 * Turn off the timer, turn off all sockets, close file handlers, clear
 *   job queue.  THIS SHOULD PROBABLY ONLY BE USED WITH UNIT TESTING.
 */

Tock.prototype.destroy = function(callback) {

	var self = this;

	this.stop();
	this.client.removeAllListeners();
	this.client.close(function() {

		Object.keys(self.runningJobs).forEach(function(id) {
			if (self.runningJobs[ id ].stdOutStream) self.runningJobs[ id ].stdOutStream.close(function() {});
			if (self.runningJobs[ id ].stdErrStream) self.runningJobs[ id ].stdErrStream.close(function() {});
		});

		self.runningJobs = {};

		if (typeof callback === 'function') {
			return callback();
		}

	});

	return this;

};

/**
 * Check that spawning the given job will not violate the
 *   maximum number of running config
 */

Tock.prototype.checkMaxRunning = function(job) {

	var totalRunning = 0
			, idStr = job._id.toString();

	_.forEach(this.runningJobs, function(runningJob, id) {
		if (runningJob.jobModel.jobScheduleId && runningJob.jobModel.jobScheduleId == idStr) {
			totalRunning++;
		}
	});

	if (totalRunning >= job.maxRunning) {
		return false;
	}

	return true;

};

/**
 * Spawn a single job
 */

Tock.prototype.spawnSingleJob = function(request, callback) {

	var self = this
			, singleJobModel = new SingleJob(request.job, true)
			, job;

	if (!singleJobModel.scheduleDateTime) singleJobModel.scheduleDateTime = Date.now();

	function onError(err) {
		callback(err);
		return logger.error(err);
	}

	function onSingleJobSave(err) {

		if (err) onError(err);

		job = new Job({
			command: singleJobModel.command
			, parameters: singleJobModel.parameters
		});

		job.save(onJobSave);

	}

	function onJobSave(err) {

		if (err) onError(err);

		callback(null, job);
		if (request.job.runSync) {
			self.spawnJob(job);
		}

	}

	singleJobModel.save(onSingleJobSave);

};

/**
 * Get running job list
 */

Tock.prototype.getRunningJobs = function() {

	var self = this,
			ret = {};

	Object.keys(this.runningJobs).forEach(function(jobId) {
		ret[ jobId ] = self.runningJobs[ jobId ].jobModel;
		ret[ jobId ].status = 'running';
	});

	return ret;

};

/**
 * Get job by id, if it's already in memory, return that
 *   Otherwise, fetch from mongo, set in memory, and return
 */

Tock.prototype.getJobById = function(id, callback) {

	var self = this;

	if (this.runningJobs[ id ] && this.runningJobs[ id ].jobModel) {
		return process.nextTick(function() {
			return callback(null, self.runningJobs[ id ]);
		});
	} else if (this.runningJobs[ id ]) {
		return this.runningJobs[ id ].queue.push(callback);
	}

	this.runningJobs[ id ] = { queue: [] };

	return Job.findById(id, function(err, jobModel) {

		if (err) return callback(err);
		var jobEntry = { jobModel: jobModel };

		return self.getFileStreams(jobModel, function(err, results) {

			if (err) return callback(err);
			if (!self.runningJobs[ id ]) return logger.warn(new Error('Job is no longer running'), id);

			var tempQueue = self.runningJobs[ id ].queue.slice(0)
					, ret;

			jobEntry.stdOutStream = results.stdOutStream;
			jobEntry.stdErrStream = results.stdErrStream;
			self.runningJobs[ id ] = jobEntry;
			ret = callback(null, self.runningJobs[ id ]);

			tempQueue.forEach(function(cb) {
				cb(null, self.runningJobs[ id ]);
			});

			return ret;

		});

	});	

};

// If called directly, run this
if (require.main === module) {
	(new Tock).dispatch();
}
