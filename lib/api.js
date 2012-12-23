/* ~ Bootstrap dependencies ~ */

var config = require('./config'),
		express = require('express'),
		_ = require('underscore'),
		swig = require('swig'),
		socketIo = require('socket.io'),
		mongoose = require('mongoose'),
		Job = require('./model/job'),
		JobSchedule = require('./model/jobschedule');

// Connect to mongo
mongoose.connect('mongodb://' + config.dataStore.host + '/Tock', function(err) {
	if (err) {
		console.error(err);
	}
});

var tock = require('./tock');

// Localize these vars for gridFS
var dbClient = mongoose.connection.db,
		gridStore = mongoose.mongo.GridStore,
		destroyJobClients = {},
		syncJobClients = {},
		masterExternalPort = process.env.TOCK_MASTER_API_PORT || config.masterExternalPort;

/* - Bootstrap our express application object - */

var app = module.exports = express.createServer();
app.use(express.static(__dirname + '/public'));
app.use(express.cookieParser());
app.use(express.bodyParser());
app.use(express.session({ secret: 'leeroyjenkins' }));
app.register('.html', swig);
app.set('view engine', 'html');
swig.init({
    root: __dirname + '/view',
    allowErrors: true
});
app.set('views', __dirname + '/view');
app.set('view options', {layout: false});
app.helpers({
	'year': (new Date()).getFullYear(),
	'masterExternalPort': masterExternalPort
});

// Now start up our socket.io app
var io = socketIo.listen(app);

// Create our socket.io api server config
io.set('log level', 1);
// TODO: Send running process list
io.sockets.on('connection', function(socket) {
	socket.on('jobSubscribe', function(data) {
		socket.set('jobId', data.jobId);
	});
});

tock.listener.on('job:complete', function(job) {

	// Alert our socket clients that we have a finished job
	io.sockets.emit('news', {
		'type': 'Job Finished',
		'jobId': job.JobModel._id,
		'command': job.JobModel.Command,
		'params': job.JobModel.Parameters.join(" "),
		'time': new Date(),
		'message': 'Job ' + job.JobModel.Command + ' finished'
	});

	if (syncJobClients[job.JobModel._id]) {
		syncJobClients[job.JobModel._id]();
		delete syncJobClients[job.JobModel._id];
	}

});

tock.listener.on('job:stdOut', function(data) {

	_.forEach(io.sockets.clients(), function(dashClient) {
		dashClient.get('jobId', function(err, jobId) {
			if (jobId != data.id) return;
			dashClient.emit('stdOut', {
				'data': data.stdOut
			});
		});
	});

});

tock.listener.on('job:stdErr', function(data) {

	_.forEach(io.sockets.clients(), function(dashClient) {
		dashClient.get('jobId', function(err, jobId) {
			if (jobId != data.id) return;
			dashClient.emit('stdErr', {
				'data': data.stdErr			
			});
		});
	});

});

tock.listener.on('job:spawn', function(job) {

	io.sockets.emit('news', {
		'type': 'Job Spawned',
		'jobId': job._id,
		'command': job.Command,
		'params': job.Parameters.join(" "),
		'time': new Date(),
		'message': 'Command ' + job.Command + ' was spawned'
	});

});

// TODO: tock.listener.on('job:error');
tock.listener.on('job:killed', function(job) {

	destroyJobClients[job.id]();
	delete destroyJobClients[job.id];

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
function renderer(response, dataModel, renderType, viewName) {

	switch(renderType) {
		case 'json':
			return response.json(dataModel);
		default:
			return response.render(viewName, dataModel);
	}

}

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

	JobSchedule.find().exec(function(err, results) {
		if (err) return next(err);
		results.forEach(function(job) {
			job.Params = job.Parameters.join(' ');
		});
		return res.render('jobschedule/index.html', { schedule: results });
	});

});

/**
 * Retrieve a file from our gridFS store
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/job/getfile/:file', function(req, res, next) {

	var myStore = new gridStore(dbClient, req.params.file, 'r');

	myStore.open(function(err) {
		if (err) return next(err);
		res.header('Content-Type', 'text/plain');
		res.header('Content-disposition', 'attachment; filename=' + req.params.file + '.txt');
		var myStream = myStore.stream(true);
		myStream.on('data', function(chunk) {
			res.write(chunk.toString());
		});
		myStream.on('close', res.end);
	});

});

/**
 * Search for a subset of jobs
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/job/search/:op?', function(req, res, next) {

	var filterParams = req.param('Filter'),
			filterQuery = _.filter(filterParams, function(val, key) { return val !== '' && val !== null; });

	Job.find(filterQuery).sort('DateTimeRun', -1).limit(100).exec(function(err, results) {
		if (err) return next(err);
		results.forEach(function(job) {
			job.Params = job.Parameters.join(' ');
		});
		return renderer(res, { results: results, hosts: config.hosts }, req.params.op, 'job/search.html');
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

	destroyJobClients[req.params.id] = function() {
		return res.json({ jobKilled: req.params.id });
	};
	tock.killJob(req.params.id);

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

	Job.find().sort('DateTimeRun', -1).limit(100).exec(function(err, results) {
		if (err) return next(err);
		results.forEach(function(job) {
			job.Params = job.Parameters.join(' ');
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

	tock.spawnSingleJob(req, function(jobModel) {
		if (req.params.job.RunSync) {
			syncJobClients[jobModel._id] = function() {
				req.flash('success', 'Successfully scheduled job');
				return res.redirect('/singlejob/create');
			};
		}
	});

});

/**
 * Display form to create a new one-off job record
 * @param  {object} req
 * @param  {object} res
 * @param  {Function} next
 * @return {object}
 */
app.get('/singlejob/create', function(req, res, next) {

	return res.render('singlejob/index.html', {messages: req.flash()});

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

app.listen(masterExternalPort);
tock.start();
