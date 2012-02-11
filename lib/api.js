/* - Bootstrap dependencies - */
var config = require('./config');
var express = require('express');
var swig = require('swig');
var mongoose = require('mongoose');
var Job = require('model/job');
var JobSchedule = require('model/jobschedule');
var http = require('http');

var app = module.exports = express.createServer();
app.register('.html', swig);
app.set('view engine', 'html');

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
		return res.redirect({'Success': true});
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

/**
 * [ description]
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}
 */
app.get('/singlejob/post', function(req, res, next) {
	// TODO: Host and port
	var request = http.request({host: 'localhost', port: 8989, method: 'POST'}, function(response) {
		// TODO: Check for error
		return res.json(response);
	});
	request.write(JSON.stringify(JobModel));
	request.end();	
});
