// ubiserver2.js
// see https://github.com/cgreenhalgh/ubihelper/blob/master/docs/Ubiserver2DesignNotes.html
// Chris Greenhalgh, Copyright (c) University of Nottingham, 2012

//======================================================================
// core (generic http/socket.io) server stuff

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

//======================================================================

//new socket.io client
io.sockets.on('connection', function(socket) {
	// ...
});

