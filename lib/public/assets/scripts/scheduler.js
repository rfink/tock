$(function() {

	/**
	 * Update the visible and non-visible value
	 * @param  {object} ui
	 * @param  {string} value
	 * @return {void}
	 */
	var updateValue = function(ui, value) {
		$(ui).parents('.tock-selection-div:first').find('input.tock-schedule-selector').val(value);
		$(ui).parents('.tock-selection-div:first').prevAll('h3:first').find('div.tock-value').html(value);
	};

	/**
	 * Get the value for the given ui pointer
	 * @param  {object} ui
	 * @return {string}
	 */
	var getValue = function(ui) {
		return $(ui).parents('.tock-selection-div:first').find('input.tock-schedule-selector').val();
	};

	$('.tabs').tabs();
	$('.accordion').accordion();
	$('.tock-select-all').click(function() {
		updateValue(this, '*');
	});
	$('.tock-select-each').click(function() {
		//$(this).parents('.tock-selection')
	});
	$('.slider').each(function() {
		var self = this;
		$(this).slider({
			min: 1,
			step: 1,
			max: $(this).data('max'),
			slide: function(event, ui) {
				updateValue(self, '*/' + ui.value);
			}
		});
	});
	$('.block-selector div span').live('click', function() {
		$(this).toggleClass('ui-active');
		var values = [];
		$(this).parents('.block-selector:first').find('div span.ui-active').each(function() {
			values.push($(this).data('value'));
		});
		if (!values.length) {
			updateValue(this, '*');
		} else {
			updateValue(this, values.join(','));
		}
	});
	$('input.tock-schedule-selector').each(function() {
		var val = $(this).val();
		if (!val) {
			val = '*';
		}
		updateValue(this, val);
	});
	(function populateMinuteBlock() {
		var breakPoint = 10;
		var $minuteBlock = $('#minute-block');
		var $divBlock = $('<div></div>');
		for (var i = 0; i < 60; ++i) {
			if (!(i % breakPoint)) {
				$minuteBlock.append($divBlock);
				$divBlock = $('<div></div>');
			}
			$divBlock.append($('<span data-value="' + i + '">' + i + '</span>'));
		}
		$minuteBlock.append($divBlock);
	})();
	(function populateHourBlock() {
		var breakPoint = 12;
		var $hourBlock = $('#hour-block');
		var $divBlock = $('<div></div>');
		for (var i = 0; i < 24; ++i) {
			if (!(i % breakPoint)) {
				$hourBlock.append($divBlock);
				$divBlock = $('<div></div>');
			}
			$divBlock.append($('<span data-value="' + i + '">' + i + '</span>'));
		}
		$hourBlock.append($divBlock);
	})();
	(function populateDayOfMonthBlock() {
		var breakPoint = 7;
		var $dayOfMonthBlock = $('#dayofmonth-block');
		var $divBlock = $('<div></div>');
		for (var i = 1; i < 32; ++i) {
			if (!((i - 1) % breakPoint)) {
				$dayOfMonthBlock.append($divBlock);
				$divBlock = $('<div></div>');
			}
			$divBlock.append($('<span data-value="' + i + '">' + i + '</span>'));
		}
		$dayOfMonthBlock.append($divBlock);
	})();
	(function populateMonthBlock() {
		var breakPoint = 13;
		var months = ['Spacer', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		var $monthBlock = $('#month-block');
		var $divBlock = $('<div></div>');
		for (var i = 1; i < 13; ++i) {
			if (!(i % breakPoint)) {
				$monthBlock.append($divBlock);
				$divBlock = $('<div></div>');
			}
			$divBlock.append($('<span data-value="' + i + '">' + months[i] + '</span>'));
		}
		$monthBlock.append($divBlock);
	})();
	(function populateDayOfWeekBlock() {
		var breakPoint = 8;
		var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		var $dayOfWeekBlock = $('#dayofweek-block');
		var $divBlock = $('<div></div>');
		for (var i = 0; i < 7; ++i) {
			if (!(i % breakPoint)) {
				$dayOfWeekBlock.append($divBlock);
				$divBlock = $('<div></div>');
			}
			$divBlock.append($('<span data-value="' + i + '">' + days[i] + '</span>'));
		}
		$dayOfWeekBlock.append($divBlock);
	})();
});