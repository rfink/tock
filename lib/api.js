/* - Bootstrap dependencies - */
var config = require('./config');
var express = require('express');
var _ = require('underscore');
var swig = require('swig');
var mongoose = require('mongoose');
var Job = require('./model/job');
var JobSchedule = require('./model/jobschedule');
var http = require('http');

mongoose.connect('mongodb://' + config.dataStore.host + '/Tock', function(err) {
	if (err) {
		console.error(err);
	}
});

/* - Bootstrap our express application object - */
var app = module.exports = express.createServer();
app.use(express.static(__dirname + '/public'));
app.use(express.cookieParser());
app.use(express.bodyParser());
app.use(express.session({ secret: "leeroyjenkins" }));
app.register('.html', swig);
app.set('view engine', 'html');
swig.init({
    root: './view/',
    allowErrors: true
});
app.set('views', './view');
app.set('view options', {layout: false});
app.helpers({
	'year': (new Date()).getFullYear()
});

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
	var jobScheduleData = req.param('JobSchedule');
	if (jobScheduleData._id) {
		JobSchedule.findById(jobScheduleData._id, function(err, JobScheduleModel) {
			if (err) return next(err);
			// My version of populate
			_.forEach(jobScheduleData, function(val, key) {
				if (key !== '_id') {
					JobScheduleModel[key] = val;
				}
			});
			JobScheduleModel.save(function(err) {
				if (err) return next(err);
				return res.redirect('/jobschedule/' + jobScheduleData._id);
			});
		});
	} else {
		var JobScheduleModel = new JobSchedule(jobScheduleData, true);
		JobScheduleModel.save(function(err) {
			if (err) return next(err);
			return res.redirect('/jobschedule');
		});
	}
});

/**
 * Display form to create job schedule record
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/jobschedule/create', function(req, res, next) {
	return res.render('jobschedule/create.html', { hosts: config.hosts });
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
		return renderer(res, _.extend(jobScheduleModel, { hosts: config.hosts }), req.params.op, 'jobschedule/create.html');
	});
});

/**
 * Job schedule index page
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/jobschedule', function(req, res, next) {
	JobSchedule.find().run(function(err, results) {
		if (err) return next(err);
		results.forEach(function(job) {
			job.Params = job.Parameters.join(' ');
		});
		return res.render('jobschedule/index.html', { schedule: results });
	});
});

/**
 * Kill an in-progress job with the given job id parameter
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/job/:id/kill', function(req, res, next) {
	var request = http.request({host: config.masterHost, port: config.masterPort, method: 'POST'}, function(response) {
		// TODO: Check for error I guess?
		var data = '';
		response.on('data', function(chunk) {
			data += chunk;
		});
		response.on('end', function() {
			return res.send(data);
		});
	});
	request.write(JSON.stringify({ requestType: 'killJob', id: req.params.id }));
	request.end();
});

/**
 * Render either a job record by id to specified format, or display form to edit
 *   specified record
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/job/:id', function(req, res, next) {
	Job.findById(req.params.id, function(err, jobModel) {
		if (err) return next(err);
		return res.render('job/view.html', jobModel);
	});
});

/**
 * Get a collection of recent jobs
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/job', function(req, res, next) {
	Job.find().sort('DateTimeRun', -1).limit(100).run(function(err, results) {
		if (err) return next(err);
		results.forEach(function(job) {
			job.Params = job.Parameters.join(" ");
		});
		return res.render('job/index.html', { 'jobs': results });
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
	var request = http.request({host: config.masterHost, port: config.masterPort, method: 'POST'}, function(response) {
		var data = '';
		response.on('data', function(chunk) {
			data += chunk;
		});
		response.on('end', function() {
			var dataObject = JSON.parse(data);
			// TODO: Check for error, flash message
			req.flash('Successfully scheduled job');
			return res.redirect('/singlejob/create');
		});
	});
	request.write(JSON.stringify({ requestType: 'spawnJob', 'job': req.param('Job') }));
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

/**
 * Display a dashboard for the user
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/dashboard', function(req, res, next) {
	// TODO: Do dashboard stuffs
	return res.render('dashboard/index.html');
});

/**
 * Index entry point for the admin tool
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/', function(req, res, next) {
	return res.render('index/index.html');
});

app.listen(config.apiPort);
