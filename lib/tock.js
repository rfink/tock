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
var formidable = require('formidable');
var Job = require('./model/job');
var JobSchedule = require('./model/jobschedule');

mongoose.connect('mongodb://' + config.dataStore.host + '/Tock', function(err) {
	if (err) {
		console.error(err);
		process.exit(1);
	}
});

var runningJobs = {};
var jobs = [
	{
		Command: 'ls',
		Parameters: ['al'],
		Minutes: '*',
		Hours: '*',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '*'
	},
	{
		Command: 'ps',
		Parameters: ['aux'],
		Minutes: '*',
		Hours: '5',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '*'
	},
	{
		Command: 'pwd',
		Parameters: [],
		Minutes: '*',
		Hours: '*',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '0'
	}
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
		if (typeof job[key] === 'string') {
			if (job[key] !== '*' && job[key] != curData[key]) {
				flag = false;
			}
		} else if (_.isArray(job[key])) {
			if (job[key].indexOf('*') === -1 && job[key].indexOf(curData[key]) === -1) {
				flag = false;
			}
		}
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
			console.log(err);
			return;
		}
		var request = http.request({host: host.host, port: host.port, method: 'POST'}, function(res) {
			runningJobs[JobModel._id] = JobModel;
		});
		request.write(JSON.stringify(JobModel));
		request.end();
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
 * Create our server to receive responses from the running jobs
 * @param  {object} request
 * @param  {object} response
 * @return {object}
 */
http.createServer(function(request, response) {
	var form = new formidable.IncomingForm();
	form.parse(request, function(err, fields, files) {
		if (err) {
			// TODO: What??
		}
		// Remove from running job queue
		var jobData = JSON.parse(fields.job);
		if (jobData && runningJobs[jobData._id]) {
			delete runningJobs[jobData._id];
		}
		var JobModel = Job.findById(jobData._id, function(err, MyJob) {
			if (err) {
				console.error(err);
				// TODO: What??
			}
			MyJob.TotalRunTime = fields.totalRunTime;
			MyJob.Pid = fields.pid;
			console.log(MyJob);
			MyJob.save(function(err) {
				if (err) {
					console.error(err);
					// TODO: What??
				}
				fs.unlink(files.stdOut.path);
				fs.unlink(files.stdErr.path);
			});
		});
	});
	response.end();
}).listen(15162);

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
