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
		Parameters: [],
		Minutes: '*',
		Hours: '*',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '*'
	},
	{
		Command: 'ps aux | grep -i node',
		Parameters: [],
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

var dispatch = function() {
	// I don't QUITE trust javascript's set-timeout, so instead of trusting that we ran on or after
	//   the :00 seconds, round the time to the nearest minute
	var curMinute = new Date(Math.round(Date.now() / (1000 * 60)) * 1000 * 60);
	_.forEach(jobs, function(job) {
		if (isEligibleSlot(job, curMinute)) {
			var JobModel = new Job(job);
			JobModel.save(function(err) {
				if (err) {
					// TODO: What??
					console.log(err);
					return;
				}
				var request = http.request({host: 'localhost', port: 8989, method: 'POST'}, function(res) {
					runningJobs[JobModel._id] = true;
					var data = '';
					res.on('data', function(chunk) {
						data += chunk;
					});
					res.on('end', function() {
						console.log(data);
					});
				});
				request.write(JSON.stringify(JobModel));
				request.end();
			});
		}
	});
	// Add one minute to now, set the timeout to the difference (in milliseconds) from now
	var d = moment().add('minutes', 1);
	var nextMinute = moment([d.year(), d.month(), d.date(), d.hours(), d.minutes()]);
	setTimeout(dispatch, nextMinute.diff(moment()));
};

http.createServer(function(request, response) {
	//console.log(arguments);
	var form = new formidable.IncomingForm();
	form.parse(request, function(err, fields, files) {
		if (err) {
			// TODO: What??
		}
		fs.unlink(files.stdOut.path);
		fs.unlink(files.stdErr.path);
		console.log('TA DA!');
	});
	response.end();
}).listen(15162);

dispatch();
