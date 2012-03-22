//standard socket.io sample
//var io = require('socket.io').listen(49891);
//
//io.sockets.on('connection', function (socket) {
//  socket.emit('news', { hello: 'world' });
//  socket.on('my other event', function (data) {
//    console.log(data);
//  });
//});

// modules: connect, http, socket.io
var connect = require('connect'),
	http = require('http'),
    io = require('socket.io');

// set up the connect bit, e.g. static pages
var app = connect()
	// serve the client code from /client/...
	.use('/client', connect.static('../client'));

// http server, dispatching to connect app
var httpapp = http.createServer(app);
// link socket.io to it
io = io.listen(httpapp);
// start the http server listening
httpapp.listen(49891);

// protocol version 
var version = 1;

// server name 
// TODO more useful information :-)
var servername = 'ubiserver 1';

// group client sockets by client id, by group name
var groupclients = new Object;

// group state, by group name
var groupstates = new Object;

// reject a client - not yet in a group
function rejectclient(socket, clientid, reason) {
	console.log('rejectclient '+clientid+': '+reason);
	socket.emit('ubiserver.reject', { version: version, name: servername, reason: 'version='+version});
	socket.disconnect();
}

// socket.io client id
var nextclientid = 1;

// new socket.io client
io.sockets.on('connection', function(socket) {
	// client id
	var clientid = ''+(nextclientid++);
	socket.set('clientid', clientid);
	console.log('connection from client '+clientid);
	
	// client hello handling
	socket.on('ubiserver.newclient', function(data) {
		if (data.version!=version) {
			rejectclient(socket, clientid, 'Requires version '+version);
			return;
		}
		if (data.g===undefined) {
			rejectclient(socket, clientid, 'No group specified');
			return;			
		}
		// client general state
		var g = data.g;
		socket.set('g', g);
		var name = data.name;
		socket.set('name', name);
		var log = data.log==1;
		socket.set('log', log);

		// client/subclient persistence, indexed by subclient id
		var cstate = new Object;
		socket.set('state', cstate);
		
		// add to group set of clients
		var gcs = groupclients[g];
		if (gcs===undefined) {
			gcs = new Object;
			groupclients[g] = gcs;
		}
		gcs[clientid] = socket;
		
		console('added client '+clientid+': g='+g+', name='+name+', log='+log);
		
		// ok
		socket.emit('ubiserver.welcome', { version: version, name: servername, c: clientid });

		// listeners...
		socket.on('s', function(set) {
			
		});
		socket.on('j', function(join) {
			
		});
		socket.on('l', function(leave) {
			
		});
	});
	
	// client disconnect handling
	socket.on('disconnect', function() {
		
	});
});
