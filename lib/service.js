var HttpDuplex = require('http-duplex');
var Stream = require('stream');
var inherits = require('inherits');
var spawn = require('child_process').spawn;

module.exports = function (opts, req, res) {
    var service = new Service(opts, req, res);
    
    Object.keys(opts).forEach(function (key) {
        service[key] = opts[key];
    });
    return service;
};

var headerRE = {
    'receive-pack' : '([0-9a-fA-F]+) ([0-9a-fA-F]+) refs\/(heads|tags)\/(.*?)( |00|\u0000)',
    'upload-pack' : '7bwant ([0-9a-fA-F]+)'
};

function Service (opts, req, res) {
    var self = this;
    HttpDuplex.call(self, req, res);
    
    var piped = false;
    self.on('pipe', function () {
        piped = true;
    });
    
    var buffered = [];
    var data = '';
    self.on('data', function ondata (buf) {
        buffered.push(buf);
        data += buf;
        
        var ops = data.match(new RegExp(headerRE[self.service], 'gi'));
        if (!ops) return;
        data = undefined;
       
        ops.forEach(function(op) {
            var m = op.match(new RegExp(headerRE[self.service]));
            if (!m) return;

            var action = new Action();
            req.pipe(action).pipe(res);
            action.status = 'pending';
            action.repo = opts.repo;
            action.service = opts.service;
            action.cwd = opts.cwd;
            action.buffered = buffered.toString();
            buffered = undefined;

            if (self.service === 'receive-pack') {
                action.last = m[1];
                action.commit = m[2];

                if (m[3] == 'heads') {
                    var type = 'branch';
                    action.evName = 'push';
                } else {
                    var type = 'version';
                    action.evName = 'tag';
                }

                action[type] = m[4];
                self.emit('header', action);
            }
            else if (self.service === 'upload-pack') {
                action.commit = m[1];
                action.evName = 'fetch';
                self.emit('header', action);
            }
        });
    });
}

inherits(Service, HttpDuplex);

var Action = function() {
    // piped
    var self = this;
    self.piped = false;
    Stream.call(self);
    self.readable = self.writable = true;
    self.write = function (data) {
        self.emit('data', data);
    };
    self.end = function (data) {
        if (arguments.length) self.emit('data', data);
    };

    self.once('accept', function () {
        process.nextTick(function () {
            console.log('spawn process');
            var ps = spawn('git-' + self.service, [
                '--stateless-rpc',
                self.cwd
            ]);
            self.emit('service', ps);
            ps.stdout.pipe(process.stdout, { end : false });
            ps.stdout.pipe(self, { end : !self.piped });
            
            console.log('buffered '+self.buffered.toString());
            self.buffered.forEach(function (buf) {
                ps.stdin.write(buf);
            });
            self.buffered = undefined;
            
            self.pipe(ps.stdin);
            ps.on('exit', self.emit.bind(self, 'exit'));
        });
    });
}

inherits(Action, Stream);

Action.prototype.accept = function () {
    if (this.status !== 'pending') return;
    
    this.status = 'accepted';
    this.emit('accept');
};

Action.prototype.reject = function (code, msg) {
    if (this.status !== 'pending') return;
    
    if (msg === undefined && typeof code === 'string') {
        msg = code;
        code = 500;
    }
    this.statusCode = code || 500;
    if (msg) this.write(msg);
    
    this.status = 'rejected';
    this.emit('reject');
};
