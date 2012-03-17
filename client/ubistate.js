// ubistate.js
// Library/module for ubihelper/ubiserver state sharing protocol.
//
// Chris Greenhalgh, Copyright (c) The University of Nottingham, 2012

(function (exports, global) {
	/** ubistate namespace */
	var ubistate = exports;
	
	// if in Node
	if ('object' === typeof module && 'function' === typeof require) {
		// require(...)
	}
	
	/** expose constructor */
	ubistate.State = State;
	
	/** state set constructor */
	function State() {
		// keyed by key
		this.values = {};
		// keyed by peerid
		this.senders = {};
		this.transactionupdates = {};
		this.transaction = 0;
		this.timestamp = new Date().getTime();
	}
	
	/** begin transaction */
	State.prototype.begin = function() {
		this.transaction++;
	}
	/** end transaction */
	State.prototype.end = function() {
		this.transaction--;
		if (this.transaction<0) {
			console.log('Too many State.end');
			this.transaction = 0;
		}
		if (this.transaction==0) {
			var newtimestamp = new Date().getTime();
			if (newtimestamp<=this.timestamp) {
				console.log('Note: new timestamp would have been lower/unchanged: '+newtimestamp);
				newtimestamp = this.timestamp+1;
			}
			this.timestamp = newtimestamp;
			// notify sender(s)
			for (var peerid in this.senders) {
				var sender = this.senders[peerid];
				sender.updated(this.transactionupdates, this.timestamp);
			}
			this.transactionupdates = {};
		}
	}
	/** set key/value */
	State.prototype.set = function(key,value,fn) {
		var intransaction = this.transaction==0;
		if (!intransaction)
			this.begin();
		if (value==null || value===undefined) {
			if (this.values[key]!==undefined)
				this.transactionupdates[key] = null;
			delete this.values[key];			
		}
		else {
			this.values[key] = value;
			this.transactionupdates[key] = value;
		}
		if (!intransaction)
			this.end();
		if (fn!==undefined)
			fn();
		return this;
	}
	/** get value.
	 * @param fn function to call with (value) */
	State.prototype.get = function(key,fn) {
		var value = this.values[key];
		if (fn!==undefined)
			fn(value);
		return this;
	}
	/** list key/values (not copied; don't mutate!).  
	 * @param fn function to call with (values,timestamp) - {key:value, ...} 
	 */
	State.prototype.list = function(fn) {
		// TODO pattern
		// TODO transactions
		if (this.transaction>0) {
			console.log('Warning: State.list when in a transaction');
		}
		if (fn!==undefined)
			fn(this.values, this.timestamp);
		return this;
	}
	
	/** send to a peer */
	State.prototype.sender = function(peerid) {
		var sender = this.senders[peerid];
		if (sender===undefined) {
			var sender = new Sender(this, peerid);
			this.senders[peerid] = sender;
		}
		return sender;
	}
	
	/** constructor */
	ubistate.Sender = Sender;
	
	/** magic key */
	var TIMESTAMP = "_TIMESTAMP";
	/** Sender - handles pushing of state to a peer as/when connectivity is available. */
	function Sender(state, peerid) {
		this.state = state;
		this.peerid = peerid;
		this.isconnected = false;
		this.nextackid = 1;
		// state - not sent, maybe received-awaiting ack, maybe received-no ack, known received
		// get and queue initial state
		var self = this;
		// just key/values
		this.statenotsent = {};
		state.list(function (values,timestamp) {
			for (var key in values) {
				self.statenotsent[key] = values[key];
			}
			self.statenotsent[TIMESTAMP] = timestamp;
		});
		// ackid:{key/values}
		this.stateawaitingack = {};
		// just key/values
		this.statenoack = {};
		// known received, just key/value
		this.stateknown = {};
	}
	
	/** notify connected.
	 * @param sendfn send message function (sendermsg) */
	Sender.prototype.connected = function(sendfn) {
		this.sendfn = sendfn;
		this.isconnected = true;
		this.check();
	}
	
	Sender.prototype.check = function() {
		var awaitingack = false;
		for (var key in this.stateawaitingack) {
			awaitingack = true;
			break;
		}
		if (awaitingack) {
			if (!this.isconnected) {
				// these should be noack now
				for (var ackid in this.stateawaitingack) {
					var s = this.stateawaitingack[ackid];
					for (key in s) {
						this.statenoack[key] = s[key];
					}
				}
				this.stateawaitingack = {};
				console.log('check: failed awaitingack messages without connection');
				return;
			}
			console.log('check: awaitingack for '+JSON.stringify(this.stateawaitingack));
			return;
		}
		if (!this.isconnected) {
			console.log('check: not connected');
			return;
		}
		// send unsent
		var notsent = false;
		for (key in this.statenotsent) {
			notsent = true;
			break;
		}
		if (!notsent) {
			// send unsent
			var noack = false;
			for (key in this.statenoack) {
				noack = true;
				break;
			}
			if (noack) {
				console.log('check: nothing to send');
				return;
			}
		}
		// Stuff to send - previous noack and/or notsent
		var send = {};
		for (key in this.statenoack) {
			send[key] = this.statenoack[key];
		}
		// over-write with notsent
		// (be sure TIMESTAMP is up to date)
		for (key in this.statenotsent)
			send[key] = this.statenotsent[key];
		// move all to stateawaitingack
		var ackid = this.nextackid++;
		this.statenotsent = {};
		this.statenoack = {};
		this.stateawaitingack[ackid] = send;
		
		var sendermsg = { ackid: ackid, updates: send };
		this.sendfn(sendermsg);
		// debug
		this.dump();
	}
	
	/** notify ack */
	Sender.prototype.acked = function(ackmsg) {
		// TODO
	}
	/** notify disconnected */
	Sender.prototype.disconnected = function() {
		this.isconnected = false;
		delete this.sendfn;
		this.check();
	}
	/** notify State updated 
	 * @param updates {key:value,...} - value is null if deleted
	 */
	Sender.prototype.updated = function(updates, timestamp) {
		// merge into statenotsent 
		for (var key in updates) {
			this.statenotsent[key] = updates[key];
		}
		this.statenotsent[TIMESTAMP] = timestamp;
		this.check();
	}

	/** dump */
	Sender.prototype.dump = function() {
		console.log('Sender dump (peerid='+this.peerid+')');
		console.log('  statenotsent='+JSON.stringify(this.statenotsent));
		console.log('  stateawaitingack='+JSON.stringify(this.stateawaitingack));
		console.log('  statenoack='+JSON.stringify(this.statenoack));
		console.log('  stateknown='+JSON.stringify(this.stateknown));
	}
	
	/** expose constructor */
	ubistate.Receiver = Receiver;
	
	/** receiver */
	function Receiver() {
		this.state = new State;
		this.state.timestamp = 0;
	}
	/** get state */
	Receiver.prototype.state = function() {
		return this.state;
	}
	/** handle sendermessage, return optional message (ackmsg) */
	Receiver.prototype.received = function(sendermsg) {
		// TODO
		return null;
	}
})('object' === typeof module ? module.exports : (this.ubistate = {}), this);
