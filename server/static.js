// connect server?
var connect = require('connect')
  , http = require('http'),
    io = require('socket.io');

var app = connect()
  .use('/client', connect.static('../client'))
;//  .use('/socket.io', io);

//io = io.listen(app);

var httpapp = http.createServer(app);
io.listen(httpapp);
httpapp.listen(49891);

