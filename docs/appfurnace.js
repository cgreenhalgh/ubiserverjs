// Sample client code using ubiserver socket.io-based state/event server.
// Chris Greenhalgh, Copyright (c) The University of Nottingham, 2012

// Server to use
var serverurl = 'http://teaching.cs.nott.ac.uk:49891';

// communication group to use
var groupname = 'cmg-socketiotest';

//==============================================================================
// Generic ubiserver client functions

var socket;

var version = 1;

// redefine for different logging
var logmessage = function(direction,message,args) {
    log('Message '+direction+' '+message+' '+JSON.stringify(args));
};

// create connection...!
function connect(clientname,group,l,connectcallback,valuecallback) {
    // flash didn't seem to work on my mobile! most standard options don't work on simulator
    socket = io.connect(serverurl, {transports: [ 'jsonp-polling' ]});
    socket.on('connect', function() {
        // hello
        var newclient = { version: version, name: clientname, g: group, log: ((log!==undefined && log) ? 1 : 0) };
        socket.emit('ubiserver.newclient',  newclient);
        logmessage('Sent','ubiserver.newclient', newclient);
    });
    socket.on('ubiserver.welcome', function(welcome) {
        logmessage('Recv','ubiserver.welcome', welcome);
        if (connectcallback) connectcallback(true,welcome);
    });
    socket.on('ubiserver.reject', function(reject) {
        logmessage('Recv', 'ubiserver.reject', reject);
        socket = undefined;
        if(connectcallback) connectcallback(false,reject);
    });
    socket.on('disconnect', function() {
        logmessage('Recv', 'disconnect', null);
        socket = undefined;
        if (connectcallback) connectcallback(false,null);
    });
    socket.on('v', function(value) {
        logmessage('Recv', 'v', value);
        if (valuecallback) valuecallback(value);
    });
}

function set(n, v, p, c, e) {
    if (socket!==undefined) {
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
// helper to dynamically load javascript files, here for socket.io
function addScriptFile(src, callback) {
    var script = document.createElement("script");
    script.type = "text/javascript";

    script.onload = function(){
        callback();
    };
    script.src = src;
    window.document.body.appendChild(script);
}

//==============================================================================
// application-specific stuff...

// connect/disconnect callback
function connectcallback(ok, info) {
    // ...
    if(ok) {
        // handle initial connection
        ui.statustext.text('Connected');
        // e.g. monitor all 'name' values, including persistent (already stored)
        join('name',true);
    }
    else
        ui.statustext.text('Error/disconnected ('+info+')');
}
var logtext = '';
// handle a new value from the server
function valuecallback(value) {
    // e.g. just show in the log textarea
    var info = value.n+'='+value.v+' (c='+value.c+')';
    log('value: '+info);//JSON.stringify(value));
    logtext = info+'<br>'+logtext;
    ui.log.text(logtext);
}

// initialise the client - load socket.io and connect to server
function init() {
    ui.statustext.text('Loading socket.io');
    addScriptFile(serverurl+"/client/libs/socket.io.min.js", 
       function() {    
                ui.statustext.text('Connecting');
                // loaded...
                connect('socketiotest',groupname,true,connectcallback,valuecallback);
    });
}

// run it now!
init();

// ui - handle Set button pressed and set/update name with server
function setName() {
    var name = ui.nametext.text();
    // persistent, and client-specific, echo
    set('name', name, 1, '', 1);
}
