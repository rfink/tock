exports = module.exports = errorHandler;

/**
 * Our error handler for the master
 */
function errorHandler(errorLevel, message) {
  console.error('Error: ' + errorLevel, message);
  // TODO: Mail or sumthin' tss tss
}

// Constants for the error handler
errorHandler.ERROR_NONE = 0;
errorHandler.ERROR_NOTICE = 1;
errorHandler.ERROR_WARNING = 2;
errorHandler.ERROR_CRITICAL = 3;