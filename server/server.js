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

// remove a client - in a group
function removeclient(socket, clientid, g) {
	var gcs = groupclients[g];
	if (gcs!==undefined) 
		delete gcs[clientid];
	// TODO GC groups?
}


//reject a client - in a group
function failclient(socket, clientid, g, reason) {
	console.log('failclient '+clientid+': '+reason);
	socket.emit('ubiserver.reject', { version: version, name: servername, reason: 'version='+version});
	socket.disconnect();
	removeclient(socket, clientid, g);
}

function matches(sub, name) {
	return sub.test(name);
}
function checkvalue(socket, sub, n, val, c) {
	if (matches(sub, n)) {
		var value = { n : n, t : new Date().getTime(), v : val };
		if (c!==undefined)
			value.c = c;
		socket.emit('v', value);
	}
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
		
		// client subscriptions
		var subs = [];
		socket.set('subs', subs);
		
		// test
		socket.get('subs', function(err, ss) {
			console.log('subs='+JSON.stringify(ss));
		});
		
		// add to group set of clients
		var gcs = groupclients[g];
		if (gcs===undefined) {
			gcs = new Object;
			groupclients[g] = gcs;
		}
		gcs[clientid] = socket;

		// group state
		var gstate = groupstates[g];
		if (gstate===undefined) {
			gstate = new Object;
			groupstates[g] = gstate;
		}

		console.log('added client '+clientid+': g='+g+', name='+name+', log='+log);
		
		// ok
		socket.emit('ubiserver.welcome', { version: version, name: servername, c: clientid });

		// listeners...
		socket.on('s', function(set) {
			if (set.n===undefined) {
				failclient(socket, clientid, g, 's message had no "n" (name) element');
				return;
			}
			var c = set.c;
			if (c!==undefined) {
				if (c.length==0)
					c = clientid;
				else
					c = clientid+'/'+c;
			}
			if (set.p) {
				// save
				var state;
				if (c===undefined) {
					// g scope
					state = gstate;
					console.log('set group '+g+' '+set.n+'='+set.v);
				} else {
					// client/sub scrope
					state = cstate[c];
					if (state===undefined) {
						state = new Object;
						cstate[c] = state;
					}					
					console.log('set group '+g+' client '+c+' '+set.n+'='+set.v);
				}
				if (set.v===undefined)
					delete state[set.n];
				else
					state[set.n] = set.v;
			}// done set
			
			// value
			var value = { n : set.n, t : new Date().getTime() };
			if (set.v!==undefined)
				value.v = set.v;
			if (c!==undefined)
				value.c = c;
			
			// match/send
			for (var cid in gcs) {
				// clients in group
				var c = gcs[cid];
				if (c===socket && !(set.e)) 
					continue;
				
				c.get('subs', function(err, subs) {
					if (subs) {
						for (var i=0; i<subs.length; i++) {
							var sub = subs[i];
							if (matches(sub, set.n))
								c.emit('v', value);
						}
					}
					else 
						console.log('Error getting subs for '+cid+': '+err);
				});
			}
		});
		socket.on('j', function(join) {
			if (join.n===undefined) {
				failclient(socket, clientid, g, 'j message had no "n" (name) element');
				return;
			}
			
			console.log('Join for '+clientid+' ('+g+') n='+join.n);
			var sub = new RegExp('^'+join.n+'$')
			subs.splice(subs.length, 0, sub);
			
			if (join.p) {
				// group state
				for (var n in gstate) {
					checkvalue(socket, sub, n, gstate[n]);
				}
				// group client state
				for (var cid in gcs) {
					var client = gcs[cid];
					if (client===socket)
						continue;// not self
					client.get('state', function (err, cstate) {						
						for (var c in cstate) {
							var st = cstate[c];
							for (var n in st) {
								checkvalue(socket, sub, n, st[n], c);
							}
						}
					});
				}
			}
		});
		socket.on('l', function(leave) {
			if (leave.n===undefined) {
				failclient(socket, clientid, g, 'l message had no "n" (name) element');
				return;
			}
			var done = false;
			var pat = '^'+leave.n+'$';
			for (var ix=0; ix<subs.length; ix++) {
				var sub = subs[ix];
				if (pat==sub.source) {
					console.log('Leave for '+clientid+' ('+g+') n='+leave.n);
					subs.splice(ix, 1);
					done = true;
					break;
				}
			}
			if (!done) {
				console.log('Leave unknown for '+clientid+' n='+leave.n);
				return;
			}
		});
		// client disconnect handling
		socket.on('disconnect', function() {
			console.log('disconnect from '+clientid);
			removeclient(socket, clientid, g);
			// clear persistent client values to subscriptions
			for (var cid in cstate) {
				var st = cstate[cid];
				for (var n in st) {
					// value
					var value = { n : n, t : new Date().getTime(), c: cid };
					// match/send
					for (var cid in gcs) {
						// clients in group
						var c = gcs[cid];
						if (c===socket) 
							continue;
						
						c.get('subs', function(err, subs) {
							if (subs) {
								for (var i=0; i<subs.length; i++) {
									var sub = subs[i];
									if (matches(sub, n))
										c.emit('v', value);
								}
							}
							else 
								console.log('Error getting subs for '+cid+': '+err);
						});
					}

				}
			}
		});
	});
	
});
