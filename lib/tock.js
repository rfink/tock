var moment = require('moment');
var config = require('./config');
var _ = require('underscore');
var http = require('http');

var jobs = [
	{
		Command: 'ls -al',
		Minutes: '*',
		Hours: '*',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '*'
	},
	{
		Command: 'ps aux | grep -i node',
		Minutes: '*',
		Hours: '5',
		DaysOfMonth: '*',
		Months: '*',
		DaysOfWeek: '*'
	},
	{
		Command: 'pwd',
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
			var request = http.request({host: 'localhost', port: 8989, method: 'POST'}, function(res) {
				var data = '';
				res.on('data', function(chunk) {
					data += chunk;
				});
				res.on('end', function() {
					var doc = JSON.parse(data);
					console.log(doc);
				});
			});
			request.write(JSON.stringify(job));
			request.end();
		}
	});
	// Add one minute to now, set the timeout to the difference (in milliseconds) from now
	var d = moment().add('minutes', 1);
	var nextMinute = moment([d.year(), d.month(), d.date(), d.hours(), d.minutes()]);

	setTimeout(dispatch, nextMinute.diff(moment()));
};

dispatch();
