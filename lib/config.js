module.exports = exports = {
	/* This is a list of clusters (groups of machines) to process the jobs */
	hosts: [
		{
			host: 'localhost',
			port: 8989
		},
		{
			host: 'localhost',
			port: 8990
		}
	],
	/* This is used to store the schedule / one-off job information */
	dataStore: {
		host: 'localhost',
		port: 27017,
		/*username: '',*/
		password: null
	},
	ioSocketPort: 17970,
	jobResponsePort: 15162
};
