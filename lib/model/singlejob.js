var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var SingleJob = new Schema({
	Command: String,
	Parameters: [String],
	ScheduleDateTime: { type: Date, index: true },
	RunSync: Boolean,
	BindCluster: String
});

exports = module.exports = mongoose.model('SingleJob', SingleJob, 'SingleJob');
