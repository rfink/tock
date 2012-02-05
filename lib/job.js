var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var Job = new Schema({
	Command: String,
	Minutes: [String],
	Hours: [String],
	DaysOfMonth: [String],
	Months: [String],
	DaysOfWeek: [String]
});

exports = module.exports = mongoose.model('Job', Job);
