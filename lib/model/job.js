var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var Job = new Schema({
	jobScheduleId: { type: Schema.ObjectId, index: true },
	command: String,
	parameters: [String],
	host: String,
	port: Number,
	dateTimeRun: { type: Date, index: true, default: Date.now },
	totalRunTime: Number,
	pid: Number,
	errorCode: Number,
	stdOut: String,
	stdErr: String
});

exports = module.exports = mongoose.model('Job', Job, 'jobs');
