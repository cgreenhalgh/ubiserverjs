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
		this.listeners = [];
	}

	/** register listener.
	 * @param callback function with signature (updates,timestamp,values) */
	State.prototype.onchange = function(callback) {
		this.listeners.push(callback);
	}
	/** begin transaction */
	State.prototype.begin = function() {
		this.transaction++;
	}
	State.prototype.intransaction = function() {
		return this.transaction>0;
	}
	/** end transaction */
	State.prototype.end = function(opttimestamp) {
		this.transaction--;
		if (this.transaction<0) {
			console.log('Too many State.end');
			this.transaction = 0;
		}
		if (this.transaction==0) {
			var newtimestamp = opttimestamp;
			if (newtimestamp===undefined) 
				newtimestamp = new Date().getTime();
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
			// notify listeners
			for (var listenerid in this.listeners) {
				try {
					this.listeners[listenerid](this.transactionupdates, this.timestamp, this.values);
				}
				catch (err) {
					console.log('Error in state listener: '+err.message);
				}
			}
			this.transactionupdates = {};
		}
	}
	/** set key/value */
	State.prototype.set = function(key,value,fn) {
		var intransaction = this.transaction>0;
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
	
	function empty(a) {
		var yes = true;
		for (var i in a) {
			yes = false;
			break;
		}
		return yes;
	}
	
	Sender.prototype.check = function() {
		if (!this.isconnected) {
			console.log('check: not connected');
			return;
		}
		if (!empty(this.stateawaitingack)) {
			console.log('check: awaitingack for '+JSON.stringify(this.stateawaitingack));
			return;
		}
		// send unsent
		if (empty(this.statenotsent)) {
			// send unsent
			if (empty(this.statenoack)) {
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
		if (empty(this.stateknown))
			// new state flag
			sendermsg.newstate = true;
		// complete update in one... (this is set in the first message of a new update)
		sendermsg.newupdate = send[TIMESTAMP];
		
		this.sendfn(sendermsg);
		// debug
		this.dump();
	}
	
	/** notify ack */
	Sender.prototype.acked = function(ackmsg) {
		var ackids = ackmsg.ackids;
		if (ackids===undefined) {
			console.log('Warning: ackmsg.ackids undefined: '+JSON.stringify(ackmsg));
			return;
		}
		var docheck = false;
		for (var i in ackids) {
			var ackid = ackids[i];
			var state = this.stateawaitingack[ackid];
			if (state===undefined) {
				console.log('received unknown ackid '+ackid+' (nextackid='+this.nextackid+')');
			} else {
				console.log('received ack '+ackid);
				// move to known
				var timestamp;
				for (var key in state) {
					if (key==TIMESTAMP)
						// don't update timestamp until/unless all updates acked
						timestamp = state[key];
					else
						this.stateknown[key] = state[key];
				}
				delete this.stateawaitingack[ackid];
				if (timestamp!==undefined) {
					if (empty(this.stateawaitingack) && empty(this.statenoack)) {
						console.log('know that received '+timestamp);
						this.stateknown[timestamp] = timestamp;
					}
				}
				docheck = true;
			}
		}
		if (docheck)
			this.check();
	}
	/** notify disconnected */
	Sender.prototype.disconnected = function() {
		this.isconnected = false;
		delete this.sendfn;
		// these should be noack now
		for (var ackid in this.stateawaitingack) {
			var s = this.stateawaitingack[ackid];
			for (key in s) {
				this.statenoack[key] = s[key];
			}
		}
		this.stateawaitingack = {};
		console.log('disconnect: failed awaitingack messages without connection');
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
		this.newstate = true;
		this.intransaction = false;
		//this.newupdate
		//this.newupdateackid
	}
	/** get state */
	Receiver.prototype.state = function() {
		return this.state;
	}
	/** handle sendermessage, return optional message (ackmsg) */
	Receiver.prototype.received = function(sendermsg) {
		if (sendermsg.newstate==true) {
			if (!this.newstate) {
				this.state = new State;
				console.log('receiver reset state on newstate');
			}
		}
		var ackids = [];
		// ackid, updates, newstate?, newupdate?
		if (sendermsg.newupdate!==undefined) {
			this.newupdate = sendermsg.newupdate;
			this.newupdateackid = sendermsg.ackid;
		} else {
			// hope in order
			if (sendermsg.ackid==this.newupdateackid+1)
				this.newupdateackid = sendermsg.ackid;
		}
		ackids.push(sendermsg.ackid);
		
		if (!this.intransaction) {
			this.state.begin();
			this.intransaction = true;
		}
		// handle updates
		for (var key in sendermsg.updates) {
			if (key!=TIMESTAMP) {
				this.state.set(key, sendermsg.updates[key]);
			}
		}
		var timestamp = sendermsg.updates[TIMESTAMP];
		if (timestamp!==undefined && this.newupdateackid==sendermsg.ackid) {
			// completed update!
			this.state.end(timestamp);
			this.intransaction = false;
			console.log('updated state to '+timestamp+': '+JSON.stringify(this.state.values));
		}
		else
		{
			console.log('updated state to intermediate of '+this.newupdate+': '+JSON.stringify(this.state.values));			
		}
		
		if (!empty(ackids))
			return {ackids:ackids};			
		return null;
	}
})('object' === typeof module ? module.exports : (this.ubistate = {}), this);
