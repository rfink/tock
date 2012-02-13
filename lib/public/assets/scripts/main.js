$(function() {
	$('input[type="submit"]').button();
	$('ul.sf-menu').superfish();
	$('.dataTable').dataTable({
		bJQueryUI: true
	});
});