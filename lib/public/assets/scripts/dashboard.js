(function() {
	if (!io) {
		return;
	}
	var socket = new io.Socket('localhost', { port: 48151 });
	socket = io.connect('http://localhost:48151');
	socket.on('news', function(data) {
		// TODO: Do stuff
	});
})();