// client javascript
// requires socket.io and jQuery

// standard socket.io example

var socket;

var version = 1;

// redefine for different logging
var logmessage = function(direction,message,arguments) {
	console.log('Message '+direction+' '+message+' '+JSON.stringify(arguments));
}

// create connection...!
function connect(clientname,group,log,connectcallback,valuecallback) {
	socket = io.connect('http://:49891');
	socket.on('connect', function() {
		// hello
		var newclient = { version: version, name: clientname, g: group, log: ((log!==undefined && log) ? 1 : 0) };
		socket.emit('ubiserver.newclient',  newclient);
		logmessage('Sent','ubiserver.newclient', newclient);
	});
	socket.on('ubiserver.welcome', function(welcome) {
		logmessage('Recv','ubiserver.welcome', welcome);
		connectcallback && connectcallback(true,welcome);
	});
	socket.on('ubiserver.reject', function(reject) {
		logmessage('Recv', 'ubiserver.reject', reject);
		socket = undefined;
		connectcallback && connectcallback(false,reject);
	})
	socket.on('disconnect', function() {
		logmessage('Recv', 'disconnect', null);
		socket = undefined;
		connectcallback && connectcallback(false,null);
	});
	socket.on('v', function(value) {
		logmessage('Recv', 'v', value);
		valuecallback && valuecallback(value);
	});
}

function set(n, v, p, c, e) {
	if (socket!=undefined) {
		var s = { n: n };
		if (v!==undefined)
			s.v = v;
		if (p!==undefined)
			s.p = p;
		if (c!==undefined)
			s.c = c;
		if (e!==undefined)
			s.e = e;
		socket.emit('s', s);
		logmessage('Send', 's', s);
	}
}

function join(n, p) {
	if (socket!==undefined) {
		var join = { n : n };
		if (p!==undefined)
			join.p = 1;
		socket.emit('j', join);
		logmessage('Send', 'j', join);
	}
}

function leave(n) {
	if (socket!==undefined) {
		var leave = { n : n };
		socket.emit('l', leave);
		logmessage('Send', 'l', leave);
	}
}

function disconnect() {
	if (socket!==undefined) {
		socket.disconnect();
		logmessage('Sent', 'disconnect');
	}
}
//socket.on('news', function (data) {
//  console.log(data);
//  socket.emit('my other event', { my: 'data' });
//});
