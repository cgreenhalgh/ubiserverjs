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

// state utils - shared with client
var ubistate = require('../client/ubistate.js');

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

var version = 1;

var SUBSCRIPTIONS = '_SUBSCRIPTIONS';
var SENDERS = 'senders';

//======================================================================

function removePeerSender(peer,sid) {
	console.log(' remove sender '+sid);
	delete peer.senders[sid];
	// TODO send remove message....
}
function connectPeerSender(sender,sid,socket) {
	sender.connected(function(sendermsg) {
		var msg = {type: 'sender', sender: sid, msg: sendermsg};
		socket.json.send(msg);
		console.log('Sender sender msg '+JSON.stringify(msg));
	});
}
function addPeerSender(peer,senderid,peerid,state) {
	console.log(' add sender '+senderid+'/'+peerid+' for '+peer.id);
	var sender = state.sender(peer.id);
	peer.senders[senderid+'/'+peerid] = sender;
	if (peer.socket!==undefined)
		connectPeerSender(sender, senderid+'/'+peerid, peer.socket);
}

function connectPeerSenders(peer,socket) {
	for (var sid in peer.senders) {
		var sender = peer.senders[sid];
		connectPeerSender(sender,sid,socket);
	}
}

// peer just added - check other peers' subscriptions
function handlePeerNewReceiver(peer,senderid,state) {
	console.log('New receiver '+senderid+' for '+peer.id);
	for (var peerid in peers) {
//		if (peerid==peer.id)
//		continue;
		var p = peers[peerid];
		var subrecv = p.receivers[SUBSCRIPTIONS];
		if (subrecv!==undefined) 
			subrecv.state.get(SENDERS,function(senders) {
				if (senders!==undefined) {
					var senderNames = senders.split(',');
					var add = false;
					for (var si in senderNames) {
						var sn = senderNames[si];
						if (senderid==sn) {
							add = true;
							break;
						}
					}
					if (add) {
						addPeerSender(p,senderid,peer.id,state);
					}
				}
			});
	}
}
// subscriptions receiver just created for peer
function handlePeerInitSubscriptions(peer,subscriptionsReceiver) {
	var sstate = subscriptionsReceiver.state;
	//console.log('handlePeerInitSubscriptions for '+peer.id);
	var onchange = function(updates,timestamp) {
		var senders = updates[SENDERS];
		if (senders!==undefined) {
			console.log('Peer '+peer.id+' senders subscriptions changed to '+senders);
			var senderNames = senders.split(',');
			var removeids = [];
			for (var sid in peer.senders) {
				var retain = false;
				for (var si in senderNames) {
					var sn = senderNames[si]+'/';
					if (sid.indexOf(sn)==0) {
						// found!
						retain = true;
						break;
					}
				}
				if (!retain) {
					removeids.push(sid);
				}
			}
			for (sid in removeids) {
				removePeerSender(peer, sid);
			}
			// add
			for (var si in senderNames) {
				var sn = senderNames[si];
				for (var peerid in peers) {
//					if (peerid==peer.id)
//						continue;
					var p = peers[peerid];
					if (p.receivers[sn]!==undefined) {
						// add this one
						addPeerSender(peer,sn,p.id,p.receivers[sn].state);
					}
				}
			}
		} else {
			console.log('Peer '+peer.id+' senders subscription unchanged/unset');
		}
	};
	sstate.onchange(onchange);
	// initial value(s)
	sstate.list(onchange);
}

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
			if (msg.type=='init_peer_req') {
				// id, pindigest, name, version, reason?
				if (msg.version!=version) {
					socket.json.send({type:'reject',reason:'unsupported_version',message:'Version not supported (server version '+version+', client version '+msg.version+')'});
					socket.disconnect();
					return;
				}
				if (msg.pindigest===undefined || msg.id===undefined || msg.name===undefined) {
					console.log('incomplete init_peer_req message ('+JSON.stringify(msg)+')');
					socket.json.send({type:'reject',reason:'protocol_error',message:'Incomplete init_peer_req message'});
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
					peer.state = conn.state = STATE_PEERED;
					// peer state receivers, key by sender name
					peer.receivers = {};
					// key by sender name / (other) peer id
					peer.senders = {};
					peer.serverid = serverid;
					// add to peers
					peers[peer.id] = peer;
					conn.peer = peer;
					// TODO: timeout/soft state?
					// also: port, info
					var resp = { type: 'resp_peer_nopin', id: device.id, name: device.name,
							secret: Crypto.util.bytesToBase64(peer.secret) };
					console.log('New peer (no pin) id='+peer.id+', name='+peer.name);
					socket.json.send(resp);

					connectPeerSenders(peer,socket);
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
			else if (msg.type=='init_confirm_untrusted') {
				// id, confirmid, name, version
				if (msg.version!=version) {
					socket.json.send({type:'reject',reason:'unsupported_version',message:'Version not supported (server version '+version+', client version '+msg.version+')'});
					socket.disconnect();
					return;
				}
				if (msg.confirmid===undefined || msg.id===undefined || msg.name===undefined) {
					console.log('incomplete init_confirm_untrusted message ('+JSON.stringify(msg)+')');
					socket.json.send({type:'reject',reason:'protocol_error',message:'Incomplete init_confirm_untrusted message'});
					socket.disconnect();
					return;
				}
				// did they get our ID right?
				if (msg.confirmid!=device.id) {
					// no - reject
					socket.json.send({type:'reject',reason:'not_my_id',message:'Server ID incorrect (server ID '+device.id+', client specified '+msg.confirmid+')'});
					socket.disconnect();
					return;
				}
				// do we know them?
				var peer = peers[msg.id];
				if (peer===undefined) {
					// no - reject
					socket.json.send({type:'reject',reason:'unknown_peer',message:'Unknown peer ('+msg.id+')'});
					socket.disconnect();
					return;
				}
				// OK - update
				peer.socket = socket;
				peer.name = msg.name;
				// new secret?! current protocol doesn't confirm secret held
				peer.secret = Crypto.util.randomBytes(8);
				peer.state = conn.state = STATE_PEERED;
				conn.peer = peer;
				// TODO: timeout/soft state?
				// also: port, info
				var resp = { type: 'resp_peer_nopin', id: device.id, name: device.name,
						secret: Crypto.util.bytesToBase64(peer.secret) };
				console.log('Confirm peer (no pin) id='+peer.id+', name='+peer.name);
				socket.json.send(resp);
				
				connectPeerSenders(peer,socket);
				return;				
			}
			else {
				console.log('state NEW got '+msg.type);
				socket.disconnect();
				return;
			}
		}
		else if (conn.state==STATE_PEERED) {
			if (msg.type=='sender') {
				// sender, msg
				if (msg.sender===undefined || msg.msg===undefined) {
					console.log('incomplete sender message ('+JSON.stringify(msg)+')');
					socket.disconnect();
					return;
				}
				//console.log('sender message '+JSON.stringify(msg));
				var receiver = conn.peer.receivers[msg.sender];
				var newflag = false;
				if (receiver===undefined) {
					if (msg.msg.newstate!=true) {
						console.log('sender message for unknown receiver '+msg.sender+' not newstate - ignored');
						return;
					}
					receiver = new ubistate.Receiver;
					conn.peer.receivers[msg.sender] = receiver;
					newflag = true;
				}
				var ackmsg = receiver.received(msg.msg);
				if (ackmsg!=null) {
					var repl = {type:'receiver',sender:msg.sender,msg:ackmsg};
					socket.json.send(repl);
				}
				if (newflag) {
					if (msg.sender==SUBSCRIPTIONS) {
						handlePeerInitSubscriptions(conn.peer,receiver);
					}
					handlePeerNewReceiver(conn.peer,msg.sender,receiver.state);
				}
			}
			else if (msg.type=='receiver') {
				// sender,msg
				if (msg.sender===undefined || msg.msg===undefined) {
					console.log('incomplete receiver message ('+JSON.stringify(msg)+')');
					socket.disconnect();
					return;
				}
				var sender = conn.peer.senders[msg.sender];
				if (sender===undefined) {
					console.log('reveiver message for unknown sender '+msg.sender);
					return;
				}
				sender.acked(msg.msg);
			}
		}
		// ...
	});

	socket.on('disconnect', function () { 
		console.log('disconnect from '+serverid);
		if(conn.peer!==undefined && conn.peer.socket===socket) {
			// disconnect senders
			for (var sid in conn.peer.senders) {
				var sender = conn.peer.senders[sid];
				sender.disconnected();
			}
			delete conn.peer.socket;
		}
	});
});

//======================================================================
// a few state tests

function ubistateTests() {
	console.log('State tests...');
	var s = new ubistate.State;
	s.set('a',1);
	s.set('b',2);
	s.get('a', function(a) { 
		console.log('a='+a); 
	});
	s.list(function(vs) { 
		console.log('list:');
		for (var k in vs) { 
			console.log('  '+k+'='+vs[k]);
		}
	});
}
//ubistateTests();