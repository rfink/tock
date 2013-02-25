
var should = require('should')
    , Tock = require('../lib/tock')
    , Worker = require('../lib/worker')
    , JobSchedule = require('../lib/model/jobschedule')
    , SingleJob = require('../lib/model/singlejob')
    , Job = require('../lib/model/job')
    , mongoose = require('../lib/mongocommon')
    , jobScheduleData = {
        command: 'sleep'
        , parameters: [ '1' ]
        , minutes: '*'
        , hours: '*'
        , daysOfMonth: '*'
        , months: '*'
        , daysOfWeek: '*'
        , maxRunning: 1
      }
    , singleJobData = {
        command: 'sleep'
        , parameters: [ '1' ]
        , scheduleDateTime: new Date(Math.round((Date.now() + 3600) / (1000 * 60)) * 1000 * 60) 
        , runSync: true
      }
    , singleJob
    , jobSchedule;

describe('tock', function() {

  var tock
      , worker;

  beforeEach(function(done) {

    var ctr = 2;

    tock = new Tock();
    worker = new Worker();
    singleJob = new SingleJob(singleJobData);
    jobSchedule = new JobSchedule(jobScheduleData);

    function finish(err) {
      if (!--ctr) return done();
    }

    singleJob.save(finish);
    jobSchedule.save(finish);

  });

  afterEach(function(done) {
    var destroy = (function() {
      var ctr = 2;
      return function() {
        if (!--ctr) {
          mongoose.connection.db.dropDatabase(function(err) {
            done();
          });
        }
      };
    })();
    worker.destroy(destroy);
    tock.destroy(destroy);
  });

  it('should parse stuff correctly', function(done) {
    var test = { minutes: '*', hours: '*/3', months: '2,3', daysOfMonth: '4', daysOfWeek: '1' }
        , dateObj = new Date('2013-03-04 15:20:00')
        , isValid = tock.isEligibleSlot(test, dateObj);
    isValid.should.equal(true);
    done();
  });

  it('should start a job and then kill it', function(done) {
    function spawn(job) {
      should.exist(job.pid);
      should.exist(job.host);
      tock.killJob(job._id);
    };
    var kill = (function() {
      var ctr = 2;
      return function(data) {
        if (!--ctr) {
          done();
        }
      };
    })();
    function ready() {
      tock.on('job:killed', kill);
      tock.on('job:spawn', spawn); 
      tock.dispatch();
    }
    worker.on('connect', ready);
    worker.start();
  });

  it('should start a job and finish as expected', function(done) {
    var complete = (function() {
      var ctr = 2;
      return function() {
        if (!--ctr) {
          done();
        }
      }
    })();
    tock.on('job:complete', complete);
    worker.on('connect', function() {
      tock.dispatch();
    });
    worker.start();
  });

  it('should run a synchronous job', function(done) {
    var singleJob = new SingleJob({
      command: 'echo'
      , parameters: [ 'merf' ]
    });
    tock.on('job:complete', function(job) {
      done();
    });
    worker.on('connect', function() {
      tock.spawnJob(singleJob);
    });
    singleJob.save(function(err) {
      worker.start();
    });
  });

});
