$(function() {
	$('input[type="submit"]').button();
	$('ul.sf-menu').superfish();
	$('#tock-param-add').click(function() {
		var $el = $('<div class="input-row"></div>');
		$el.append($('<label></label>'));
		$el.append($('<input type="text" id="input-params" name="JobSchedule[Params][]"></input>'));
		$el.append($('<img src="/assets/images/cross-circle.png" class="tock-param-remove"></img>'));
		$el.insertAfter($(this).parents('.input-row:first'));
	});
	$('.tock-param-remove').live('click', function() {
		$(this).parents('.input-row:first').remove();
	});
	$('.dataTable').dataTable({
		bJQueryUI: true
	});
});