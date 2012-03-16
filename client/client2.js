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

//=============================================================================
// util stuff

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

function connect_socketio(device, peer) {
	// Note: don't reconnect at the socket.io level - we'll do it at a higher level
	// Note: if the initial handshake fails then we don't get any event back - we'd just have to 
	// set a timeout for the lack of connecting.
	var socket = io.connect('http://:49891', { transports: [ 'jsonp-polling' ], // 'websocket'
		reconnect: false, 'connect timeout': 10000 });
	peer.socket = socket;
	peer.connected = false;

	// timeout for initial handshake (inferred from first call to connect - could trap connecting but then 
	// also deal with connect_failed, etc.)
	peer.connectTimeout = setTimeout(function() {
		logmessage('Event','connect timeout');
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
			// todo...
			console.log('Connect to known peer unimplemented');
			socket.disconnect();
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
		if (peer.connstate==STATE_PEER_REQ) {
			if (msg.type=='resp_peer_nopin') {
				// id, name, info? secret
				peer.id = msg.id;
				peer.name = msg.name;
				peer.secret = msg.secret;
				peer.connstate = STATE_PEERED;
				console.log('Now peered with id='+peer.id+', name='+peer.name);
			}
			else if (msg.type=='resp_peer_known') {
				// id, name, challenge1resp, challenge2
				// but in this case we should have sent init_confirm !
				
			}
			else {
				console.log('state STATE_PEER_REQ got '+msg.type);
				socket.disconnect();
				return;
			}

		}
    });
    
}


// called to initiate (high-level) connectivity to server
function connect(id, name, group) {
	// old connection?
	disconnect();
	peer.known = false;
	// ...
	logmessage('Action','connect',{id:id,name:name,group:group});
	device.id = id;
	device.name = name;
	device.group = group;
	
	connect_socketio(device, peer);
}

function disconnect() {
	if (peer.socket!==undefined) {
		peer.socket.disconnect();
		logmessage('Sent', 'disconnect');
	}
}
