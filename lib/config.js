module.exports = exports = {
	/* This is used to store the schedule / one-off job information */
	dataStore: {
		host: 'localhost',
		port: 27017,
		/*username: '',*/
		password: null
	},
	masterHost: 'localhost',
	masterExternalPort: 16162,
	masterInternalPort: 31242,
	workerTimeoutRetry: 5,
	workerConnectTimeout: 1
};
