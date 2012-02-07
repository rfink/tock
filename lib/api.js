var express = require('express');
var mongoose = require('mongoose');
var Job = require('model/job');
var JobSchedule = require('model/jobschedule');

var app = module.exports = express.createServer();

app.post('/job/post', function(req, res, next) {
	
});
