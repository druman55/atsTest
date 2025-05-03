const https = require('https');
const axios = require('axios');
const mysql = require('mysql2/promise');
const fs = require('fs');
const { v4 } = require('uuid');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors());

/*********************************/
/** Configuration               **/
/*********************************/

// Socket Config
const socketConfig = {
	host: 'api.atscall.me',
	port: 3102,
	username: 'drew',
	password: 'Password123',
	authUrl: '/auth',
	streamUrl: '/cdrs'
};

// MySQL Config
const mysqlConfig = {
	host: 'localhost',
	user: 'dmclain',
	password: 'someMySQLPassword',
	database: 'atstest',
	connectionLimit: 10
};

const keepAliveInterval = 5000; // 5 seconds

/*********************************/
/** API Routes                  **/
/*********************************/

// /details route
app.get('/details', async (req, res) => {
    let filter = null;
    let value = null;
    let sort = null;
	try {
		// Read and Validate filter
		filter = req.query.filter;
		if(!filter) {
			throw new Error('filter not found in query string.  Please provide one to retrieve the summary for.');
		}
		let allowedFilters = [`cust_id`,`id`,`seq`,`added_dt`,`start_time`,`end_time`,`caller_id`];
		if(!allowedFilters.includes(filter)) {
			throw new Error('Invalid filter given.  Valid values are : ' + JSON.stringify(allowedFilters));
		}

		// Read and Validate value
		// @Todo in a production system, I would want to do more validating here.
		value = req.query.value;
		if(!value) {
			throw new Error('value not found in query string.  Please provide one to retrieve the summary for.');
		}

		// Read and Validate sort
		sort = req.query.sort;
		if(!sort || sort.length === 0) {
			sort = 'asc';
		}
		if(sort !== 'asc' && sort !== 'desc') {
			throw new Error('Invalid sort. Valid values are asc or desc.  Leave blank for asc.');
		}

		// Generated the results, and return them.
		const detailsData = await getDetails(filter, value, sort);
		res.json({ details: detailsData });
		return;
	} catch(err) {
		errorLog(err.message);
		res.json({ error: err.message });
		return;
	}
}); // end /details

// /summary route
app.get('/summary', async (req, res) => {
    let cust_id = null;
	try {
		// Read the cust_id from the query string.
		cust_id = req.query.cust_id;
		if(!cust_id) {
			throw new Error('cust_id not found in query string.  Please provide one to retrieve the summary for.');
		}
		// It should be a number.
		cust_id = parseInt(cust_id);
		if(typeof cust_id !== 'number') {
			throw new Error('cust_id is not a number.  Please provide a numeric cust_id.');	
		}

		// Generated the results, and return them.
		const summaryData = await getSummary(cust_id);
		res.json({ summary: summaryData });
		return;
	} catch(err) {
		errorLog(err.message);
		res.json({ error: err.message });
		return;
	}
}); // end /summary

// /logs route
app.get('/logs', (req, res) => {
    let activityData = '';
    let errorData = '';

	// Ensure the activity.log file exists, and read it if it does.
    if(fs.existsSync('data/activity.log')) {
        activityData = fs.readFileSync('data/activity.log', 'utf8');
    }

	// Ensure the errors.log file exists, and read it if it does.
    if(fs.existsSync('data/errors.log')) {
        errorData = fs.readFileSync('data/errors.log', 'utf8');
    }

	// Split the data on /n making an array of the results.
    const activityArray = activityData.split("\n");
    const errorArray = errorData.split("\n");
    res.json({ activity: activityArray, errors: errorArray });
});  // End /logs

// Better listen!
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

/*********************************/
/** Setup the Socket Reader     **/
/*********************************/

// Global variables
let mysqlPool;
let req = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

/**
 * Initialize MySQL connection pool
 * @returns boolean
 */
async function initMySQL() {
    try {
        mysqlPool = mysql.createPool(mysqlConfig);
        await mysqlPool.query('SELECT 1'); // Test connection
        activityLog('MySQL connection established');
        return true;
    } catch (error) {
        activityLog('MySQL connection error')
        console.error('MySQL connection error:', error);
        return false;
    }
} // end function initMySQL

/**
 * Generate JWT from the ATS auth API URL.
 * @returns string
 */
async function generateToken() {
    return new Promise((resolve, reject) => {
        let authUrl = 'https://' + socketConfig.host + ':' + socketConfig.port + '/auth';
        activityLog('Retrieving JWT...');
        return axios.post(authUrl, {}, {
            auth: {
                username: socketConfig.username,
                password: socketConfig.password
            }
        }).then(authResponse => {
            let jwtObject = authResponse.data;
            if(jwtObject.token && jwtObject.token.length) {
                activityLog('Jwt Retreived.')
                return resolve(jwtObject.token);
            } else {
                console.error('Failed to receive JWT.')
                return resolve(null);
            }
        }).catch(error => {
            console.error(error);
            return reject(error);
        });
    })
} // end function generateToken

/**
 * Connect to ATS Socket API, read data from it, and push to the database function.
 */
async function connectToATSSocket() {
    try {
        // Authenticate and get the Jwt
        let token = await generateToken();
        if(!token) {
            console.error('Unable to retrieve token.');
            throw new Error('Unable to retrieve token.');
        }

        // Create the agent so we can keepalive
        const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });

        // Connection Configuration
        const options = {
            hostname: socketConfig.host,
            port: socketConfig.port,
            path: socketConfig.streamUrl,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Connection': 'keep-alive',
                'Accept': 'application/json' // Adjust based on expected response type
            },
            agent: agent,
        };

        // Create the request
        req = https.request(options, (res) => {
            // Handle the streaming response
            res.on('data', (data) => {
                let dataObject = JSON.parse(data);
                activityLog('Received ' + dataObject.length + ' cdrs');
                storeDataInDatabase(dataObject);
            });

            // Handle any errors
            res.on('error', (err) => {
                console.error('Response error:', err);
            });
        });

        // Handle request errors
        req.on('error', (err) => {
            console.error('Request error:', err);
        });

        // End the request
        req.end();

    } catch (error) {
        console.error(error);   
    }
} // end function connectToATSSocket

/**
 * Store received data in MySQL
 * @param {Array} cdrs
 */
async function storeDataInDatabase(cdrs) {
    const connection = await mysqlPool.getConnection();
    try {
        cdrs.forEach(cdr => {
            if(isValidData(cdr)) {
               connection.execute(
                    'REPLACE INTO cdrs (cust_id, id, seq, added_dt, start_time, end_time, caller_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [cdr.cust_id,  cdr.id, cdr.seq, cdr.added_dt, cdr.start_time, cdr.end_time, cdr.caller_id]
               );
            }
        })
    } finally {
        connection.release();
    }
} // end function storeDataInDatabase

/**
 * Lookup the Summary data, a count of rows by date for a given cust_id
 * @param {integer} cust_id 
 * @returns Array
 */
async function getSummary(cust_id) {
	// Generate a UUID here so the two activity logs can be matched together in case a request takes a long time.
	let uuid = v4();
	activityLog('[' + uuid + '] Summary requested for ' + cust_id);
	return new Promise(async (resolve, reject) => {
		// Connect to mysql
		const connection = await mysqlPool.getConnection();
		try {
			// Run the query to get the date and count for that date from CDR's, given the cust_id.
			const [results] = await connection.query(
				'select substring(added_dt, 1, 10) as date, count(*) as count ' + 
				'from cdrs ' + 
				'where cust_id = "' + cust_id + '" ' + 
				'group by substring(added_dt, 1, 10);'
			);

			activityLog('[' + uuid + '] Summary completed successfully for ' + cust_id);
			return resolve(results);
		} catch(err) {
			return reject(err);
		} finally {
			connection.release();
		}
	});
} // end function getSummary

/**
 * Lookup the Detailed Search data, a listing of all records based on a filter and value.
 * @param {string} filter Column to filter.
 * @param {string} value Value to filter to.
 * @param {string} sortDirection asc or desc
 * @returns Array
 */
async function getDetails(filter, value, sortDirection) {
	// Generate a UUID here so the two activity logs can be matched together in case a request takes a long time.
	let uuid = v4();
	activityLog('[' + uuid + '] Details requested for ' + filter + ' of ' + value + ' sorted by ' + sortDirection);
	return new Promise(async (resolve, reject) => {
		// Calculate the column to filter.  This will either just by the column, or a sub function on that column.
		let filterColumn = filter;
		// If its one the dates, then we need to do something a little different.
		if(['added_dt', 'start_time', 'end_time'].includes(filter)) {
			filterColumn = 'substring(' + filterColumn + ', 1, 10)';
		}
	
		const connection = await mysqlPool.getConnection();
		try {
			const [results, fields] = await connection.query(
				'select * from cdrs ' + 
				'where ' + filterColumn + ' = "' + value + '" ' + 
				'order by added_dt ' + sortDirection
			);
			activityLog('[' + uuid + '] Details completed successfully.');
			return resolve(results);
		} catch(err) {
			return reject(err);
		} finally {
			connection.release();
		}
	});
} // end function getSummary

/**
 * Validate a CDR
 * @param {object} cdr 
 * @Todo Could do more here to better validate these, if there is potential for variability in the incoming data.
 * @returns boolean
 */
function isValidData(cdr) {
    let requiredKeys = ['cust_id', 'id', 'seq', 'added_dt', 'start_time', 'end_time', 'caller_id'];
    requiredKeys.forEach(requiredKey => {
        if(!Object.keys(cdr).includes(requiredKey) || cdr[requiredKey].length === 0) {
            console.error(requiredKey + ' missing, skipping.')
            return false;
        }
    })
    return true;
} // end function isValidData

/**
 * Handle reconnection
 */
function scheduleReconnect() {
    if (reconnectAttempts >= maxReconnectAttempts) {
        console.error('Max reconnection attempts reached. Exiting...');
        process.exit(1);
    }

    reconnectAttempts++;
    const delay = Math.min(1000 * reconnectAttempts, 30000); // Exponential backoff with max 30s
    
    activityLog(`Attempting to reconnect in ${delay/1000} seconds...`);
    setTimeout(() => {
        connectToATSSocket().catch(error => {
            console.error('Reconnection failed:', error);
            scheduleReconnect();
        });
    }, delay);
} // end function scheduleReconnect

/**
 * Write an activity to the log
 * @param {string} activity What Activity are we logging?
 */
function activityLog(activity) {
    const today = new Date();
    const date = today.toLocaleString();
    console.log(date + ' : ' + activity);
    // Appending to a file
    fs.appendFile('data/activity.log', "\n" + date + ' : ' + activity, (err) => {
    if (err) {
        errorLog("Activity Log error", err);
        return;
    }
  });
} // end function activityLog

/**
 * Logs any errors
 * @param {string} error Error to log.
 * @param {Object} errObj Error Object to log.
 */
function errorLog(error, errObj) {
    const today = new Date();
    const date = today.toLocaleString();

    console.error(date + ' : ' + error, errObj);
    // Appending to a file
    fs.appendFile('data/errors.log', "\n" + date + ' : ' + error, (err) => {
        if (err) {
        console.error("Error Log error:", err);
        return;
        }
    });
    fs.appendFile('data/errors.log', "\n" + JSON.stringify(errObj), (err) => {
    if (err) {
      return;
    }
  });
} // end function errorLog

/**
 * Graceful shutdown
 */
async function shutdown() {
    activityLog('Shutting down...')
    
    if (req) {
        req.end();
    }
    
    if (mysqlPool) {
        await mysqlPool.end();
    }
    
    process.exit(0);
} // end function shutdown

/**
 * Main function
 */
async function main() {
    try {
        // Initialize MySQL
        const mysqlReady = await initMySQL();
        if (!mysqlReady) {
            throw new Error('Failed to connect to MySQL');
        }

        await connectToATSSocket();

        // Set up graceful shutdown
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    } catch (error) {
        console.error('Initialization failed:', error);
        scheduleReconnect();
    }
} // end function main

// Start the server
main();