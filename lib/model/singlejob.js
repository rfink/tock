var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var SingleJob = new Schema({
	Command: String,
	Parameters: [String],
	ScheduleDateTime: Date,
	RunSync: Boolean,
	RetryOnError: Boolean,
	LogOutputOnSuccess: Boolean,
	BindHost: String
});

exports = module.exports = mongoose.model('SingleJob', SingleJob);
