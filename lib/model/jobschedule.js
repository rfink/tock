var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var JobSchedule = new Schema({
	Command: String,
	Parameters: [String],
	Minutes: String,
	Hours: String,
	DaysOfMonth: String,
	Months: String,
	DaysOfWeek: String,
	RetryOnError: Boolean,
	LogOutputOnSuccess: Boolean
});

exports = module.exports = mongoose.model('JobSchedule', JobSchedule);
