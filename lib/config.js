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
		storageType: 'redis',
		host: '127.0.0.1',
		port: 6379,
		/*username: '',*/
		password: null
	}
};
