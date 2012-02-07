var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var Job = new Schema({
	JobScheduleId: { type: Schema.ObjectId, index: true },
	Command: String,
	DateTimeRun: Date,
	Pid: Number,
	StdOut: String,
	StdErr: String
});

exports = module.exports = mongoose.model('Job', Job);
