
/* ~ Application dependencies ~ */

var debug = require('debug')('tock-api'),
		envcfg = require('envcfg'),
		config = envcfg(__dirname + '/config.json'),
		express = require('express'),
		http = require('http'),
		app = express(),
		server = http.createServer(app),
		_ = require('underscore'),
		swig = require('swig'),
		cons = require('consolidate'),
		socketIo = require('socket.io'),
		mongoose = require(__dirname + '/mongocommon'),
		Job = require('./model/job'),
		JobSchedule = require(__dirname + '/model/jobschedule'),
		errorHandler = require(__dirname + '/errorhandler'),
		Tock = require('./tock');

var tock = new Tock(),
		dbClient = mongoose.connection.db,
		GridStore = mongoose.mongo.GridStore,
		destroyJobClients = {},
		syncJobClients = {},
		io = socketIo.listen(server);

/* - Bootstrap our express application object - */

app.configure(function() {
	app.use(express.static(__dirname + '/public'));
	app.use(express.cookieParser());
	app.use(express.bodyParser());
	app.use(express.session({ secret: 'leeroyjenkins' }));
	swig.init({
		root: __dirname + '/view',
		allowErrors: true
	});
	app.engine('html', cons.swig);
	app.set('view engine', 'html');
	app.set('views', __dirname + '/view');
	app.set('view options', { layout: false });
	app.use(function(req, res, next) {
		res.locals.year = (new Date()).getFullYear();
		next();
	});
});

// Create our socket.io api server config
io.sockets.on('connection', function(socket) {

	var jobList = [];

	// Create a running process list to send to the client
	_.forEach(tock.getRunningJobs(), function(job) {
		jobList.push({
			'type': 'In Progress',
			'jobId': job._id,
			'command': job.command,
			'params': job.parameters.join(" "),
			'time': new Date(),
			'message': 'Job in progress',
			'status': 'running'
		});
	});

	socket.emit('jobList', jobList);

	socket.on('jobSubscribe', function(data) {
		socket.set('jobId', data.jobId);
	});

});

tock.on('job:complete', function(job) {

	// Alert our socket clients that we have a finished job
	io.sockets.emit('news', {
		'type': 'Job Finished',
		'jobId': job.jobModel._id,
		'command': job.jobModel.command,
		'params': job.jobModel.parameters.join(" "),
		'time': new Date(),
		'message': 'Job ' + job.jobModel.command + ' finished',
		'status': 'finished'
	});

	if (syncJobClients[ job.jobModel._id ]) {
		syncJobClients[ job.jobModel._id ]();
		delete syncJobClients[ job.jobModel._id ];
	}

});

tock.on('job:stdOut', function(data) {

	_.forEach(io.sockets.clients(), function(dashClient) {
		dashClient.get('jobId', function(err, jobId) {
			if (jobId != data.id) return;
			dashClient.emit('stdOut', {
				'data': data.stdOut
			});
		});
	});

});

tock.on('job:stdErr', function(data) {

	_.forEach(io.sockets.clients(), function(dashClient) {
		dashClient.get('jobId', function(err, jobId) {
			if (jobId != data.id) return;
			dashClient.emit('stdErr', {
				'data': data.stdErr			
			});
		});
	});

});

tock.on('job:spawn', function(job) {

	io.sockets.emit('news', {
		'type': 'Job Spawned',
		'jobId': job._id,
		'command': job.command,
		'params': job.parameters.join(" "),
		'time': new Date(),
		'message': 'Command ' + job.command + ' was spawned',
		'status': 'running'
	});

});

// TODO: tock.on('job:error');
tock.on('job:killed', function(job) {

	destroyJobClients[ job.id ]();
	delete destroyJobClients[ job.id ];

});

/**
 * Convenience function for rendering based on a render type, allow people to either
 *   view the form(s), or get the json response (maybe for ajax)
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
 */

app.post('/jobschedule/post', function(req, res, next) {

	var jobScheduleData = req.param('jobSchedule');

	if (jobScheduleData._id) {
		return JobSchedule.findById(jobScheduleData._id, function(err, jobScheduleModel) {
			if (err) return next(err);
			// My version of populate
			_.forEach(jobScheduleData, function(val, key) {
				if (key !== '_id') {
					jobScheduleModel[ key ] = val;
				}
			});
			return jobScheduleModel.save(function(err) {
				if (err) return next(err);
				return res.redirect('/jobschedule/' + jobScheduleData._id);
			});
		});
	} else {
		var jobScheduleModel = new JobSchedule(jobScheduleData, true);
		return jobScheduleModel.save(function(err) {
			if (err) return next(err);
			return res.redirect('/jobschedule');
		});
	}

});

/**
 * Display form to create job schedule record
 */

app.get('/jobschedule/create', function(req, res, next) {

	return res.render('jobschedule/create.html');

});

/**
 * Render either a job schedule record by id to specified format, or dislpay form
 *   to edit specified record
 */

app.get('/jobschedule/:id/:op?', function(req, res, next) {

	JobSchedule.findById(req.params.id, function(err, jobScheduleModel) {
		if (err) return next(err);
		return renderer(res, jobScheduleModel, req.params.op, 'jobschedule/create.html');
	});

});

/**
 * Job schedule index page
 */

app.get('/jobschedule', function(req, res, next) {

	JobSchedule.find().exec(function(err, results) {
		if (err) return next(err);
		results.forEach(function(job) {
			job.params = job.parameters.join(' ');
		});
		return res.render('jobschedule/index.html', { schedule: results });
	});

});

/**
 * Retrieve a file from our gridFS store
 */

app.get('/job/getfile/:file', function(req, res, next) {

	var myStore = new GridStore(dbClient, req.params.file, 'r');

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
 */

app.get('/job/search/:op?', function(req, res, next) {

	var filterParams = req.param('filter'),
			filterQuery = _.filter(filterParams, function(val, key) { return val !== '' && val !== null; });

	Job.find(filterQuery).sort({ 'DateTimeRun': -1 }).limit(100).exec(function(err, results) {
		if (err) return next(err);
		results.forEach(function(job) {
			job.params = job.parameters.join(' ');
		});
		return renderer(res, { results: results }, req.params.op, 'job/search.html');
	});

});

/**
 * Kill an in-progress job with the given job id parameter
 */

app.get('/job/:id/kill', function(req, res, next) {

	destroyJobClients[ req.params.id ] = function() {
		return res.json({ jobKilled: req.params.id });
	};
	tock.killJob(req.params.id);

});

/**
 * Render either a job record by id to specified format, or display form to edit
 *   specified record
 */

app.get('/job/:id', function(req, res, next) {

	Job.findById(req.params.id, function(err, jobModel) {
		if (err) return next(err);
		return res.render('job/view.html', jobModel);
	});

});

/**
 * Get a collection of recent jobs
 */

app.get('/job', function(req, res, next) {

	Job.find().sort('DateTimeRun', -1).limit(100).exec(function(err, results) {
		if (err) return next(err);
		results.forEach(function(job) {
			job.params = job.parameters.join(' ');
		});
		return res.render('job/index.html', { 'jobs': results });
	});

});

/**
 * Post a single job over to our tock master
 */

app.post('/singlejob/post', function(req, res, next) {

	tock.spawnSingleJob(req, function(jobModel) {
		if (req.params.job.runSync) {
			syncJobClients[ jobModel._id ] = function() {
				req.flash('success', 'Successfully scheduled job');
				return res.redirect('/singlejob/create');
			};
		}
	});

});

/**
 * Display form to create a new one-off job record
 */

app.get('/singlejob/create', function(req, res, next) {

	return res.render('singlejob/index.html', { messages: req.flash() });

});

/**
 * Render dashboard
 */

app.get('/dashboard', function(req, res, next) {

	return res.render('dashboard/index.html');

});

/**
 * Index
 */

app.get('/', function(req, res, next) {

	return res.render('index/index.html');

});

/**
 * Error handler
 */

app.use(function(err, req, res, next) {

	errorHandler(errorHandler.ERROR_WARN, err);

	return res.json(500, {
		error: err.toString(),
		stack: err.stack.toString()
	});

});

server.listen(config.masterExternalPort);
tock.start();
