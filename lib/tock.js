/**
 * Tock Master module, this contains the logic for generating the calls to the workers,
 *   pulling the jobs from our datastore, and receiving one-off jobs to run.
 * @author Ryan Fink <ryanjfink@gmail.com>
 * @since  February 11, 2012
 */

/* ~ Bootstrap our dependencies ~ */

var debug = require('debug')('tock-master'),
		envcfg = require('envcfg'),
		config = envcfg(__dirname + '/config.json'),
		moment = require('moment'),
		_ = require('underscore'),
		async = require('async'),
		mongoose = require(__dirname + '/mongocommon'),
		axon = require('axon')
		Job = require('./model/job'),
		JobSchedule = require('./model/jobschedule'),
		SingleJob = require('./model/singlejob'),
		EventEmitter = require('events').EventEmitter,
		errorHandler = require('./errorhandler');

var dbClient = mongoose.connection.db,
		GridStore = mongoose.mongo.GridStore;

subscriberSocket.on('message', function(message) {

	var router = {

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

});

exports = module.exports = Tock;

/**
 * Tock constructor
 */

function Tock() {

	EventEmitter.call(this);
	this.runningJobs = {};
	this.pendulum;

	this.startSubscriberSocket();
	this.startPublisherSocket();

	this.subscriberSocket.on('message', this.router.bind(this));

}

Tock.prototype.__proto__ = EventEmitter.prototype;

/**
 * Router for incoming subscriber messages
 */

Tock.prototype.router = function(message) {

	var routes = {
		'master:reconnect': this.onReconnect.bind(this),
		'job:complete': this.onJobCompleted.bind(this),
		'job:killed': this.onJobKilled.bind(this),
		'job:stdOut': this.onJobStdOut.bind(this),
		'job:stdErr': this.onJobStdErr.bind(this),
		'job:error': this.onJobError.bind(this)
	};

	if (routes[ message.event ]) return routes[ message.event ](message.data);
	else return errorHandler(errorHandler.ERROR_WARNING, new Error('Route ' + message.event + ' not found'));

	return this;

};

/**
 * Called when this is notified that it has reconnected to workers that were previously running
 */

Tock.prototype.onReconnect = function(data) {
	return this;
};

/**
 * Called when a job completes
 */

Tock.prototype.onJobCompleted = function(data) {

	var self = this;

	return this.getJobById(data.id, function(err, job) {

		if (err) return errorHandler(errorHandler.ERROR_WARNING, err);

		// Close our gridfs files
		job.stdOutStream.close(function() {});
		job.stdErrStream.close(function() {});
		job.jobModel.totalRunTime = data.stats.totalRunTime;
		job.jobModel.pid = data.stats.pid;

		debug('Total time: ' + data.stats.totalRunTime);

		job.jobModel.save(function(err) {

			if (err) return errorHandler(errorHandler.ERROR_CRITICAL, err);

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

		if (err) return errorHandler(errorHandler.ERROR_WARNING, err);

		job.stdOutStream.write(data.stdOut, function(err) {
			if (err) return errorHandler(errorHandler.ERROR_WARNING, JSON.stringify(err));
		});

		this.emit('job:stdOut', data);

	});

};

/**
 * Called when a job received standard error output
 */

Tock.prototype.onJobStdErr = function(data) {

	var self = this;

	return this.getJobById(data.id, function(err, job) {

		if (err) return errorHandler(errorHandler.ERROR_WARNING, err);

		job.stdErrStream.write(data.stdErr, function(err) {
			if (err) return errorHandler(errorHandler.ERROR_WARNING, JSON.stringify(err));
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

		if (err) return errorHandler(errorHandler.ERROR_WARNING, err);

		job.jobModel.errorCode = data.errorCode;
		self.emit('job:error', data);
		return errorHandler(errorHandler.ERROR_WARNING, data.errorCode);

	});

};

/**
 * Start our publisher socket
 */

Tock.prototype.startPublisherSocket = function() {

	// Connect our publisher socket, this will publish jobs to the slaves
	this.publisherSocket = axon.socket('req');
	this.publisherSocket.format('json');
	this.publisherSocket.bind(config.masterInternalPort);

	return this;

};

/**
 * Start our subscriber socket
 */

Tock.prototype.startSubscriberSocket = function() {

	// Connect our subscriber socket, this will receive data from the slaves
	this.subscriberSocket = axon.socket('pull');
	this.subscriberSocket.format('json');
	this.subscriberSocket.connect(config.slaveInternalPort);

	return this;

};

/**
 * Get our jobs to run
 */
Tock.prototype.getJobs = function(curMinute, callback) {

	var self = this;

	return async.parallel(
		{
			schedule: function(cb) {

				return JobSchedule.find().exec(function(err, results) {

					if (err) return cb(err);
					var validJobs = [];
					results.forEach(function(job) {
						if (self.isEligibleSlot(job, curMinute)) {
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

};

/**
 * Determine if our given job is eligible for the current slot,
 *   based on the given date object
 */
Tock.prototype.isEligibleSlot = function(job, dateObj) {

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

};

/**
 * Spawn a job to one of our workers
 */
Tock.prototype.spawnJob = function(job) {

	var self = this;

	if (!publisherSocket.sock.socks.length) {
		this.emit('job:error', new Error('No clients available'));
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
			self.emit('job:error', err);
			return errorHandler(errorHandler.ERROR_CRITICAL, err);
		}

		self.getFileStreams(jobModel, function(err, streams) {

			if (err) {
				self.emit('job:error', err);
				return errorHandler(errorHandler.ERROR_CRITICAL, JSON.stringify(err));
			}

			// Save our job model to persist the stdOut and stdErr file names
			jobModel.save(function(err) {
				if (err) return errorHandler(errorHandler.ERROR_WARNING, err);
			});

			self.runningJobs[jobModel._id] = {
				jobModel: jobModel,
				stdOutStream: streams.stdOutStream,
				stdErrStream: streams.stdErrStream
			};

			publisherSocket.emit('job:spawn', jobModel);
			self.emit('job:spawn', jobModel);

		});

	});

};

/**
 * Get our file streams and send the data to the callback
 */
Tock.prototype.getFileStreams = function(jobModel, callback) {

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

};

/**
 * Send a job kill signal to our worker
 */
Tock.prototype.killJob = function(jobId) {

	var job = this.runningJobs[jobId];
	if (!job) return errorHandler(errorHandler.ERROR_WARNING, 'Attempted to kill a non-running job');
	publisherSocket.emit('job:' + job.workerId + ':kill', { jobId: jobId });

};

/**
 * Dispatch our jobs for the current minute, and re-queue our timeout
 *   to process
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
	var d = moment().add('minutes', 1),
			nextMinute = moment([d.year(), d.month(), d.date(), d.hours(), d.minutes()]);

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
 * Check that spawning the given job will not violate the
 *   maximum number of running config
 */
Tock.prototype.checkMaxRunning = function(job) {

	var totalRunning = 0,
			idStr = job._id.toString();

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

	var self = this,
			singleJobModel = new SingleJob(request.job, true);

	if (!singleJobModel.scheduleDateTime) singleJobModel.scheduleDateTime = Date.now();

	singleJobModel.save(function(err) {
		if (err) {
			callback(err);
			return errorHandler(errorHandler.ERROR_CRITICAL, err);
		}
		callback(null, singleJobModel);
		if (request.job.runSync) {
			self.spawnJob(request.job);
		}
	});

};

/**
 * Get running job list
 */
Tock.prototype.getRunningJobs = function() {

	var self = this,
			ret = {};

	Object.keys(this.runningJobs).forEach(function(jobId) {
		ret[jobId] = self.runningJobs[ jobId ].jobModel;
		ret[jobId].status = 'running';
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
			var tempQueue = self.runningJobs[ id ].queue.slice(0),
					ret;

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

}

// If called directly, run this
if (require.main === module) {
	(new Tock).dispatch();
}
