/* - Bootstrap dependencies - */
var express = require('express');
var mongoose = require('mongoose');
var Job = require('model/job');
var JobSchedule = require('model/jobschedule');

var app = module.exports = express.createServer();

/**
 * [ description]
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}
 */
app.post('/jobschedule/post', function(req, res, next) {
	var JobScheduleModel = new JobSchedule(req.body);
	JobScheduleModel.save(function(err) {
		if (err) return next(err);
		return res.json({'Success': true});
	});
});

/**
 * [ description]
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}
 */
app.get('/jobschedule/:id', function(req, res, next) {
	JobSchedule.findById(req.params.id, function(err, jobScheduleModel) {
		if (err) return next(err);
		return res.json(jobScheduleModel);
	});
});

/**
 * [ description]
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}
 */
app.get('/job/:id', function(req, res, next) {
	Job.findById(req.params.id, function(err, jobModel) {
		if (err) return next(err);
		return res.json(jobModel);
	});
});
