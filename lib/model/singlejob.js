var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var SingleJob = new Schema({
	command: String,
	parameters: [String],
	scheduleDateTime: { type: Date, index: true },
	runSync: Boolean
});

exports = module.exports = mongoose.model('SingleJob', SingleJob, 'singleJobs');
