module.exports = exports = {
	/* This is a list of clusters (groups of machines) to process the jobs */
	hosts: [
		{
			host: 'localhost.localdomain',
			port: 8989
		},
		{
			host: 'localhost.localdomain',
			port: 8990
		}
	],
	/* This is used to store the schedule / one-off job information */
	dataStore: {
		storageType: 'mongo',
		host: '127.0.0.1',
		port: 27017,
		/*username: '',*/
		password: null
	}
};
