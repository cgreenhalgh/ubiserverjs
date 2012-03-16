// ubiserver2.js
// Flexible state sharing service, especially for mobile/multiuser ubicomp applications.
//
// requires socket.io,  connect and cryptojs
//
// see https://github.com/cgreenhalgh/ubihelper/blob/master/docs/Ubiserver2DesignNotes.html
// Chris Greenhalgh, Copyright (c) University of Nottingham, 2012

//======================================================================
// core (generic http/socket.io) server stuff

// modules: connect, http, socket.io
var connect = require('connect'),
	http = require('http'),
    io = require('socket.io'),
    os = require('os');

var Crypto = (require ('cryptojs')).Crypto;

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

//======================================================================
// server state

// peers, indexed by peerid, value is peer 
var peers = new Object;

var device = new Object;
device.id = 'ubiserver2:'+os.hostname()+':'+(new Date().getTime());
device.name = 'Ubserver2 on '+os.hostname();

var nextConn = 1;

var STATE_NEW = 1;
var STATE_PEERED = 2;
var STATE_KNOWN_CHALLENGED = 3;

var version = 1;

//======================================================================

//new socket.io client
io.sockets.on('connection', function(socket) {
	// state
	var conn = new Object;
	var serverid = nextConn++;
	conn.serverid = serverid;
	conn.state = STATE_NEW;
	
	// register listeners 
	console.log('new socket.io connection '+serverid);
	
	socket.on('message', function (msg) { 
		console.log('message from '+serverid+': '+JSON.stringify(msg));
		if (conn.state==STATE_NEW) {
			if (msg.type!='init_peer_req') {
				console.log('state NEW required init_peer_req; got '+msg.type);
				socket.disconnect();
				return;
			}
			// id, pindigest, name, version, reason?
			if (msg.version!=version) {
				socket.json.send({type:'reject',reason:'unsupported_version',message:'Version not supported (server version '+version+', client version '+msg.version+')'});
				socket.disconnect();
				return;
			}
			var peer = peers[msg.id];
			if (peer===undefined) {
				// new peer - return resp_peer_nopin
				peer = new Object;
				peer.socket = socket;
				peer.id = msg.id;
				peer.name = msg.name;
				// needs secret
				peer.secret = Crypto.util.randomBytes(8);
				peer.state = STATE_PEERED;
				peer.serverid = serverid;
				// add to peers
				peers[peer.id] = peer;
				// TODO: timeout/soft state?
				// also: port, info
				var resp = { type: 'resp_peer_nopin', id: device.id, name: device.name,
						secret: Crypto.util.bytesToBase64(peer.secret) };
				console.log('New peer (no pin) id='+peer.id+', name='+peer.name);
				socket.json.send(resp);
				return;
			} 
			else {
				// known peer - could return resp_peer_known
				if (msg.reason!==undefined) {
					// in this case resp_peer_known has/will fail. So this is effectively a new 
					// peer with a known peer id. That is really bad, so we return an error.
					console.log('Reject init_peer_req with reason='+msg.reason+' for known peer '+msg.id);
					socket.json.send({type:'reject',reason:'known_peer',message:'This peer ID is already known but client refuses or fails challenge'});
					socket.disconnect();
					return;
				}
				console.log('Reject init_peer_req for known peer '+msg.id+' - should not happen');
				socket.json.send({type:'reject',reason:'known_peer',message:'This peer ID is already known but client has not used init_confirm'});
				socket.disconnect();
				return;
/*				conn.id = msg.id;
				conn.state = STATE_KNOWN_CHALLENGED;
				// needs challenge1resp = base64-encoded MD5 digest of pindigest and secret
				var bytes = [];
				var pindigest = Crypto.util.base64ToBytes(msg.pindigest);
				var challenge1resp = bytes.concat(pindigest, peer.secret);			
				// and challenge2 = base64-encoded challenge
				conn.challenge2 = Crypto.util.randomBytes(8);
				// also: port, info
				var resp = { type: 'resp_peer_known', id: device.id, name: device.name,
						challenge1resp: Crypto.util.bytesToBase64(challenge1resp),
						challenge2: Crypto.util.bytesToBase64(conn.challenge2) };
				console.log('Issued challenge to known peer id='+peer.id+', name='+peer.name);
				socket.json.send(resp);
*/				return;				
			}
		}
		// ...
	});

	socket.on('disconnect', function () { 
		console.log('disconnect from '+serverid);
		// ...
	});
});

