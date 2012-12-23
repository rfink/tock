(function() {
	if (!io) {
		return;
	}
	socket = io.connect('http://localhost:16162');
	socket.on('news', function(data) {
		var $tr = $('<tr></tr>');
		$tr.append($('<td>' + data.type + '</td>'));
		$tr.append($('<td><a href="/job/' + data.jobId + '">' + data.jobId + '</a></td>'));
		$tr.append($('<td>' + data.command + '</td>'));
		$tr.append($('<td>' + data.params + '</td>'));
		$tr.append($('<td>' + data.host + '</td>'));
		$tr.append($('<td>' + data.time + '</td>'));
		$tr.append($('<td>' + data.message + '</td>'));
		$tr.append($('<td><a href="/job/' + data.jobId + '/kill" class="tock-kill-job">Kill Job</a></td>'));
		$tr.hide().prependTo('table.dataTable tbody').slideDown('slow');
		var $li = $('table.dataTable tbody tr');
		if ($li.length > 20) {
			$li.last().remove();
		}
	});
})();

$('.tock-kill-job').live('click', function() {
	$.getJSON(
		$(this).attr('href'),
		function(response) {
			alert(response);
		}
	);
	return false;
});
