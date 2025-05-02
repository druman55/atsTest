const https = require('https');
const axios = require('axios');
const mysql = require('mysql2/promise');
const { setInterval } = require('timers');

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
        console.log('MySQL connection established');
        return true;
    } catch (error) {
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
        console.log('Connection for JWT...');
        return axios.post(authUrl, {}, {
            auth: {
                username: socketConfig.username,
                password: socketConfig.password
            }
        }).then(authResponse => {
            let jwtObject = authResponse.data;
            if(jwtObject.token && jwtObject.token.length) {
                console.log('Jwt Retreived.')
                return resolve(jwtObject.token);
            } else {
                console.log('Failed to receive JWT.')
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
                console.log('Received ' + dataObject.length + ' cdrs');
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
        let insertPromises = [];
        cdrs.forEach(cdr => {
            if(isValidData(cdr)) {
                insertPromises.push(connection.execute(
                    'REPLACE INTO cdrs (cust_id, id, seq, added_dt, start_time, end_time, caller_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [cdr.cust_id,  cdr.id, cdr.seq, cdr.added_dt, cdr.start_time, cdr.end_time, cdr.caller_id]
                ));
            }
        })
        // console.log('Data stored successfully');
    } finally {
        connection.release();
    }
} // end function storeDataInDatabase

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
    
    console.log(`Attempting to reconnect in ${delay/1000} seconds...`);
    setTimeout(() => {
        connectToATSSocket().catch(error => {
            console.error('Reconnection failed:', error);
            scheduleReconnect();
        });
    }, delay);
} // end function scheduleReconnect

/**
 * Graceful shutdown
 */
async function shutdown() {
    console.log('Shutting down...');
    
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