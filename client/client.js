// client javascript
// requires socket.io and jQuery

// standard socket.io example

var socket = io.connect('http://teaching.cs.nott.ac.uk:49891');
socket.on('news', function (data) {
  console.log(data);
  socket.emit('my other event', { my: 'data' });
});
