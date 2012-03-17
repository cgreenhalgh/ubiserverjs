// client2.js 
// client for ubiserver2, flexible state sharing service, especially for mobile/multiuser ubicomp applications.
//
// requires socket.io 
// See https://github.com/LearnBoost/socket.io-client
// requires crypto-js: Crypto and MD5
// See http://code.google.com/p/crypto-js
//
// Chris Greenhalgh, Copyright (c) University of Nottingham, 2012

//=============================================================================
// state etc.

var version = 1;

var device = new Object;
var peer = new Object;


var CONNECT_TIMEOUT = 5000;
// states
var STATE_NEW = 1;
var STATE_PEER_REQ = 2;
var STATE_PEERED = 3;
var STATE_CONFIRM_UNTRUSTED = 4;

// auto-shared client state
var clientState = new ubistate.State;
peer.senders = {};
peer.receivers = {};

var SUBSCRIPTIONS = '_SUBSCRIPTIONS';
var SENDERS = 'senders';
var subscriptions= new ubistate.State;
peer.senders[SUBSCRIPTIONS] = subscriptions.sender('server');

var onnewreceiver;
var onstatechange;

//=============================================================================
// util stuff

function callonstatechange(state) {
	if (onstatechange!==undefined) {
		try {
			onstatechange(state);
		}
		catch (err) {
			console.log('Error in onstatechange: '+err.message);
		}
	}
}

//redefine for different logging
var logmessage = function(direction,message,arguments) {
	console.log('Message '+direction+' '+message+' '+JSON.stringify(arguments));
}

//get nonce (8 bytes), as byte array
function getNonce() {
	// Note: not secure!! replace if possible
	return Crypto.util.randomBytes(8);
}

// get PIN as string
var DIGITS = "0123456789";
function getPin() {
	var bytes = Crypto.util.randomBytes(4);
	var pin = '';
	for (var i in bytes) {
		var byte = bytes[i];
		pin += DIGITS.charAt((byte & 0xff) % 10);
	}
	return pin;
}

// perform MD5 digest, return as base64
function getPinDigest(nonce, pin) {
	var bytes = [];
	for (var i in nonce)
		bytes.push(nonce[i]);
	var pinbytes = Crypto.charenc.UTF8.stringToBytes(pin);
	for (i in pinbytes)
		bytes.push(pinbytes[i]);
	var digest = Crypto.MD5(bytes, {asBytes:true});
	return Crypto.util.bytesToBase64(digest);
}

//=============================================================================

var RETRY_TIMEOUT = 10000;

function connect_socketio(url, device, peer) {
	// Note: don't reconnect at the socket.io level - we'll do it at a higher level
	// Note: if the initial handshake fails then we don't get any event back - we'd just have to 
	// set a timeout for the lack of connecting.
	console.log('connect_socketio '+url);
	
	var socket = io.connect(url, { transports: [ 'jsonp-polling' ], // 'websocket'
		reconnect: false, 'connect timeout': 10000, 'force new connection':true });
	peer.socket = socket;
	peer.connected = false;

	// timeout for initial handshake (inferred from first call to connect - could trap connecting but then 
	// also deal with connect_failed, etc.)
	peer.connectTimeout = setTimeout(function() {
		logmessage('Event','connect timeout');
		socket.disconnect();
		peer.retryTimeout = setTimeout(function() {
			connect_socketio(url, device, peer);
		}, RETRY_TIMEOUT)
	}, CONNECT_TIMEOUT);
	
	socket.on('connect', function() {
		logmessage('Event','connect');
		// cancel connect timeout
		if (peer.connectTimeout!==undefined) {
			clearTimeout(peer.connectTimeout);
			delete peer.connectTimeout;
		}
		peer.connected = true;
		peer.connstate = STATE_NEW;
		if (!peer.known) {
			// new/unknown peer
			// send init_peer_req
			// requires initiator nonce and pin
			peer.nonce = getNonce();
			peer.pin = getPin();
			peer.pindigest = getPinDigest(peer.nonce, peer.pin);
			console.log('nonce='+peer.nonce+', pin='+peer.pin+', pindigest='+peer.pindigest);
			
			// Note: we set 'unknown_peer' to prevent a resp_peer_known response
			var m = {
				type: 'init_peer_req',	
				id: device.id,
				pindigest: peer.pindigest,
				name: device.name,
				version: version,
				reason: 'unknown_peer'
			};
			socket.json.send(m);
			logmessage('Send', 'init_peer_req', m);
			peer.connstate = STATE_PEER_REQ;
		}
		else {
			// known peer (unless it has crashed/restarted)
			// send init_confirm_untrusted
			var m = {
					type: 'init_confirm_untrusted',	
					id: device.id,
					confirmid: peer.id,
					name: device.name,
					version: version,
			};
			socket.json.send(m);
			logmessage('Send', 'init_confirm_untrusted', m);
			peer.connstate = STATE_CONFIRM_UNTRUSTED;
		}
	});
	socket.on('connecting', function(transport_type) {
		logmessage('Event','connecting',transport_type);
	});
	socket.on('connect_failed', function() {
		logmessage('Event','connect_failed','');
	});
	socket.on('close', function() {
		logmessage('Event','close','');
	});
	// called when disconnect called or detected
	socket.on('disconnect', function() {
		logmessage('Event','disconnect','');
		peer.connected = false;
		delete peer.socket;
		for (var senderid in peer.senders) {
			var sender = peer.senders[senderid];
			sender.disconnected();
		}
		peer.retryTimeout = setTimeout(function() {
			connect_socketio(url, device, peer);
		}, RETRY_TIMEOUT)
		
		if (peer.id===undefined)
			callonstatechange('connecting');
		else
			callonstatechange('reconnecting');
	});
	socket.on('reconnect', function(transport_type,reconnectionAttempts) {
		logmessage('Event','reconnect',{transport_type:transport_type,reconnectionAttempts:reconnectionAttempts});
	});
	socket.on('reconnecting', function(reconnectionDelay,reconnectionAttempts) {
		logmessage('Event','reconnecting',{reconnectionDelay:reconnectionDelay,reconnectionAttempts:reconnectionAttempts});
	});
	socket.on('reconnect_failed', function() {
		logmessage('Event','reconnect_failed','');
	});
    socket.on('message', function (msg) {
		logmessage('Recv','message',msg);
		if (peer.connstate==STATE_PEER_REQ || peer.connstate==STATE_CONFIRM_UNTRUSTED) {
			if (msg.type=='resp_peer_nopin') {
				// id, name, info? secret
				if (msg.id===undefined || msg.name===undefined || msg.secret===undefined) {
					console.log('incomplete resp_peer_nopin message ('+JSON.stringify(msg)+')');
					socket.disconnect();
					return;
				}
				peer.id = msg.id;
				peer.name = msg.name;
				peer.secret = msg.secret;
				peer.connstate = STATE_PEERED;
				console.log('Now peered with id='+peer.id+', name='+peer.name);
				peer.known = true;
				for (var senderid in peer.senders) {
					var sender = peer.senders[senderid];
					sender.connected(function(sendermsg) {
						var msg = {type: 'sender', sender: senderid, msg: sendermsg};
						socket.json.send(msg);
						logmessage('Send', 'sender', msg);
					});
				}
				callonstatechange('connected');
			}
			else if (msg.type=='resp_peer_known') {
				// id, name, challenge1resp, challenge2
				// but in this case we should have sent init_confirm !
				conole.log('resp_peer_known needs to be handled!!');
				disconnect();
			}
			else if (msg.type=='reject') {
				console.log('state STATE_PEER_REQ/CONFIRM_UNTRUSTED rejected: '+msg.message);
				// NB probably unrecoverable!!
				disconnect();
				return;
			} else {
				console.log('state STATE_PEER_REQ got '+msg.type);
				socket.disconnect();
				return;
			}

		}
		else if (peer.connstate==STATE_PEERED) {
			if (msg.type=='sender') {
				// sender, msg
				if (msg.sender===undefined || msg.msg===undefined) {
					console.log('incomplete sender message ('+JSON.stringify(msg)+')');
					socket.disconnect();
					return;
				}
				//console.log('sender message '+JSON.stringify(msg));
				var receiver = peer.receivers[msg.sender];
				if (receiver===undefined) {
					if (msg.msg.newstate!=true) {
						console.log('sender message for unknown receiver '+msg.sender+' not newstate - ignored');
						return;
					}
					receiver = new ubistate.Receiver;
					peer.receivers[msg.sender] = receiver;
					
					if (onnewreceiver!==undefined) {
						try {
							onnewreceiver(msg.sender,receiver.state);
						}
						catch (err) {
							console.log('error in onnewreceiver: '+err.message);
						}
						
					}
				}
				var ackmsg = receiver.received(msg.msg);
				if (ackmsg!=null) {
					var repl = {type:'receiver',sender:msg.sender,msg:ackmsg};
					socket.json.send(repl);
				}
			}
			else if (msg.type=='receiver') {
				// sender,msg
				if (msg.sender===undefined || msg.msg===undefined) {
					console.log('incomplete receiver message ('+JSON.stringify(msg)+')');
					socket.disconnect();
					return;
				}
				var sender = peer.senders[msg.sender];
				if (sender===undefined) {
					console.log('reveiver message for unknown sender '+msg.sender);
					return;
				}
				sender.acked(msg.msg);
			}
		}
    });
    
}


/** called to initiate (high-level) connectivity to server
 * @param url server URL
 * @param id device ID
 * @param name device name
 * @param group device group name
 * @param initialsubscriptions comma-separated list of senders (groups) to subscribe to initial
 * @param onnewreceiver2 callback when new receiver (state) found, arguments (name,state)
 * @param onstatechange callback when connection state changes, arguments (connstatename)
 */
function connect(url, id, name, group, initialsubscriptions, onnewreceiver2, onstatechange2) {
	// old connection?
	disconnectinternal();
	peer.known = false;
	// ...
	logmessage('Action','connect',{id:id,name:name,group:group});
	device.id = id;
	device.name = name;
	device.group = group;
	peer.url = url;
	
	clientState.begin();
	clientState.set('id',id);
	clientState.set('name',name);
	clientState.set('group',group);
	clientState.end();
	
	peer.senders[group] = clientState.sender('server');
	
	// subscribe to GROUP
	subscriptions.set(SENDERS,initialsubscriptions);
	subscriptions.get(SENDERS,function(value) {
		console.log('Initial value of SENDERS is '+value);
	})
	
	onnewreceiver = onnewreceiver2;
	onstatechange = onstatechange2;
	
	callonstatechange('connecting');
	
	connect_socketio(peer.url, device, peer);
}

function getsenderstate(name) {
	if (name===undefined)
		return clientState;
	var sender = peer.senders[name];
	if (sender!==undefined)
		return sender.state;
	return undefined;
}

function getreceiverstate(name) {
	if (name===undefined)
		return undefined;
	var receiver = peer.receivers[name];
	if (receiver===undefined)
		return undefined;
	return receiver.state;
}

function disconnectinternal() {
	if (peer.socket!==undefined) {
		peer.socket.disconnect();
		logmessage('Sent', 'disconnect');
	}
	clearTimeout(peer.connectTimeout);
	clearTimeout(peer.retryTimeout);
}
function disconnect() {
	disconnectinternal();
	callonstatechange('disconnected');
}

