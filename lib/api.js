/* - Bootstrap dependencies - */
var config = require('./config');
var express = require('express');
var swig = require('swig');
var mongoose = require('mongoose');
var Job = require('./model/job');
var JobSchedule = require('./model/jobschedule');
var http = require('http');

mongoose.connect('mongodb://' + config.dataStore.host + '/Tock', function(err) {
	if (err) {
		console.error(err);
		process.exit(1);
	}
});

/* - Bootstrap our express application object - */
var app = module.exports = express.createServer();
app.use(express.static(__dirname + '/public'));
app.register('.html', swig);
app.set('view engine', 'html');
swig.init({
    root: './view/',
    allowErrors: true
});
app.set('views', './view/');
app.set('view options', {layout: false});

/**
 * Convenience function for rendering based on a render type, allow people to either
 *   view the form(s), or get the json response (maybe for ajax)
 * @param  {object} response
 * @param  {object} dataModel
 * @param  {string} renderType
 * @param  {string} viewName
 * @return {object}
 */
var renderer = function(response, dataModel, renderType, viewName) {
	switch(renderType) {
		case 'json':
			return response.json(dataModel);
		default:
			return response.render(viewName, dataModel);
	}
};

/**
 * Post a new job schedule to the databases
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.post('/jobschedule/post', function(req, res, next) {
	var JobScheduleModel = new JobSchedule(req.body);
	JobScheduleModel.save(function(err) {
		if (err) return next(err);
		return res.redirect('/jobschedule');
	});
});

/**
 * Render either a job schedule record by id to specified format, or dislpay form
 *   to edit specified record
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/jobschedule/:id/:op?', function(req, res, next) {
	JobSchedule.findById(req.params.id, function(err, jobScheduleModel) {
		if (err) return next(err);
		return renderer(res, jobScheduleModel, req.params.op, 'jobschedule/edit.html');
	});
});

/**
 * Update an existing job schedule record
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.put('/jobschedule/:id', function(req, res, next) {
	JobScheduleModel.findById(req.params.id, function(err) {
		if (err) return next(err);
		JobSchedule.populate(req.body, function(err) {
			if (err) return next(err);
			return res.redirect('/jobschedule/' + req.params.id);
		});
	});
});

/**
 * Display form to create job schedule record
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/jobschedule/create', function(req, res, next) {
	// TODO: Get paged job schedule list
	return res.render('jobschedule/index.html');
});

/**
 * Render either a job record by id to specified format, or display form to edit
 *   specified record
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/job/:id/:op?', function(req, res, next) {
	Job.findById(req.params.id, function(err, jobModel) {
		if (err) return next(err);
		switch (req.params.op) {
			case 'json':
				return res.json(jobModel);
			default:
				return res.render('job/view.html', jobModel);
		}
	});
});

/**
 * Post a single job over to our tock master
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.post('/singlejob/post', function(req, res, next) {
	// TODO: Host and port
	var request = http.request({host: 'localhost', port: 8989, method: 'POST'}, function(response) {
		// TODO: Check for error
		return res.redirect('/singlejob');
	});
	request.write(JSON.stringify(JobModel));
	request.end();	
});

/**
 * Display form to create a new one-off job record
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/singlejob/create', function(req, res, next) {
	return res.render('singlejob/index.html');
});

app.listen(13525);
