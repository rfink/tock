var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var JobSchedule = new Schema({
	command: String,
	parameters: [String],
	minutes: String,
	hours: String,
	daysOfMonth: String,
	months: String,
	daysOfWeek: String,
	maxRunning: Number
});

exports = module.exports = mongoose.model('JobSchedule', JobSchedule, 'jobSchedules');
