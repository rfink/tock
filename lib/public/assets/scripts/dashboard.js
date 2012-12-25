(function() {

	if (!io || ! ioPort) return;

	socket = io.connect('http://localhost:' + ioPort);

	socket.on('connect', function() {
		$(function() {
			$('#messages').html(null);
		});
	});

	socket.on('news', function(data) {
		var template = _.template($('#tock-dash-row-template').html());
		$(function() {
			$(template({ data: data })).hide().prependTo('table.dataTable tbody').slideDown('slow');
			var $li = $('table.dataTable tbody tr');
			if ($li.length > 20) {
				$li.last().remove();
			}
		});
	});

	socket.on('jobList', function(data) {
		var template;
		$(function() {
			var tbodyHtml = '',
					template = template || _.template($('#tock-dash-row-template').html());
			_.forEach(data, function(job) {
				tbodyHtml += template({ data: job });
			});
			$('table.dataTable tbody').html(tbodyHtml);
		});
	});

	socket.on('disconnect', function() {
		$('#messages').html('<div class="error">Server appears to be down</div>');
		$('table.dataTable tbody').html(null);
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
