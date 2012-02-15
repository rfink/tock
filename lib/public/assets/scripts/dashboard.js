(function() {
	if (!io) {
		return;
	}
	socket = io.connect('http://localhost:17970');
	socket.on('news', function(data) {
		var $tr = $('<tr></tr>');
		$tr.append($('<td>' + data.type + '</td>'));
		$tr.append($('<td><a href="/job/' + data.jobId + '">' + data.jobId + '</a></td>'));
		$tr.append($('<td>' + data.command + '</td>'));
		$tr.append($('<td>' + data.params + '</td>'));
		$tr.append($('<td>' + data.host + '</td>'));
		$tr.append($('<td>' + data.time + '</td>'));
		$tr.append($('<td>' + data.message + '</td>'));
		$tr.hide().prependTo('table.dataTable tbody').slideDown('slow');
		var $li = $('table.dataTable tbody tr');
		if ($li.length > 20) {
			$li.last().remove();
		}
	});
})();