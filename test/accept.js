var test = require('tap').test;
var pushover = require('../');

var fs = require('fs');
var path = require('path');
var exists = fs.exists || path.exists;

var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var http = require('http');

var seq = require('seq');

test('create, push to, and clone a repo', function (t) {
    t.plan(7);
    
    var repoDir = '/tmp/' + Math.floor(Math.random() * (1<<30)).toString(16);
    var srcDir = '/tmp/' + Math.floor(Math.random() * (1<<30)).toString(16);
    var dstDir = '/tmp/' + Math.floor(Math.random() * (1<<30)).toString(16);
    
    fs.mkdirSync(repoDir, 0700);
    fs.mkdirSync(srcDir, 0700);
    fs.mkdirSync(dstDir, 0700);
    
    var repos = pushover(repoDir, { autoCreate : false });
    var port = Math.floor(Math.random() * ((1<<16) - 1e4)) + 1e4;
    var server = http.createServer(function (req, res) {
        repos.handle(req, res);
    });
    server.listen(port);
    
    t.on('end', function () {
        server.close();
    });
    
    process.chdir(srcDir);
    seq()
        .seq(function () { repos.create('doom', this) })
        .seq(function () {
            var ps = spawn('git', [ 'init' ]);
            ps.stderr.pipe(process.stderr, { end : false });
            ps.on('exit', this.ok);
        })
        .seq(function () {
            fs.writeFile(srcDir + '/a.txt', 'abcd', this);
        })
        .seq(function () {
            spawn('git', [ 'add', 'a.txt' ]).on('exit', this.ok)
        })
        .seq_(function (next) {
            var ps = spawn('git', [ 'commit', '-am', 'a!!' ]);
            ps.on('exit', this.ok);
            ps.stdout.pipe(process.stdout, { end : false });
        })
        .seq(function () {
            spawn('git', [ 'tag', '0.0.1' ]).on('exit', this.ok)
        })
        .seq(function () {
            fs.writeFile(srcDir + '/a.txt', 'efgh', this);
        })
        .seq(function () {
            spawn('git', [ 'add', 'a.txt' ]).on('exit', this.ok)
        })
        .seq_(function (next) {
            var ps = spawn('git', [ 'commit', '-am', 'a!!' ]);
            ps.on('exit', this.ok);
            ps.stdout.pipe(process.stdout, { end : false });
        })
        .seq(function () {
            spawn('git', [ 'tag', '0.0.2' ]).on('exit', this.ok)
        })
        .seq_(function (next) {
            var ps = spawn('git', [
                'push', '--tags', 'http://localhost:' + port + '/doom', 'master'
            ]);
            ps.stderr.pipe(process.stderr, { end : false });
            ps.on('exit', function (code) {
                t.notEqual(code, 0);
                next();
            });
        })
        .seq(setTimeout, seq, 1000)
        .seq(function () {
            var glog = spawn('git', [ 'log' ], { cwd : repoDir + '/doom' });
            glog.on('exit', function (code) {
                t.notEqual(code, 0);
            });
            var data = '';
            glog.stderr.on('data', function (buf) { data += buf });
            glog.stderr.on('end', function (buf) {
                t.ok(/bad default revision 'HEAD'/.test(data));
            });
        })
        .catch(t.fail)
    ;
    
    repos.on('tag', function (tag) {
      tag.on('accept', function() {
        t.ok(true, 'push accepted');
      });
      tag.on('exit', function() {
        t.ok(true, 'push exited');
      });
    });
});
