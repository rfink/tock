var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var Job = new Schema({
	JobScheduleId: { type: Schema.ObjectId, index: true },
	Command: String,
	Parameters: [String],
	DateTimeRun: { type: Date, index: true },
	TotalRunTime: Number,
	Pid: Number,
	StdOut: String,
	StdErr: String
});

exports = module.exports = mongoose.model('Job', Job);
