(function() {
	if (!io) {
		return;
	}
	socket = io.connect('http://localhost:17970');
	socket.on('news', function(data) {
		$('<li>' + data.message + '</li>').hide().prependTo('ul.messages').slideDown('slow');
		var $li = $('ul.messages li');
		if ($li.length > 20) {
			$li.last().remove();
		}
	});
})();