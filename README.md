# atsTest
Test Programming Project for ATS by Drew McLain

# Setup
## Node
* Be sure you run npm install

## MySQL
* Create your user, and set a password for access to mysql.
* Grant appropriate permissions for your user to the database.
* Run the setup.sql SQL file against the database.

```mysql atsTest -u dmclain -p < setup/database.sql```
* Update the `mysqlConfig` variable in the server.js file to have your database credentials in it.

## Running
Run the main server with : 
```node server.js```

Take note of the port that it outputs at the start of running, as you will use this with : 
### Logs
```http://localhost:PORT/logs```

^^ This URL will show both the activity and error logs.

### Summary
```http://localhost:PORT/summary?cust_id=XX```

^^ Given a valid cust_id [ required ], this will give a summary report of daily CDR counts for the given Customer.

### Details
```http://localhost:PORT/details?filter=XX&value=YY&sort=asc|desc```

#### Filter [ required ]:
Valid `filter` values are:
cust_id, id, seq, added_dt, start_time, end_time, caller_id

#### Value [ required ]:
Valid `value` values differs a bit based on the Filter:
* cust_id, seq | Values should be numeric.
* id, caller_id | Values should be alphanumeric.
* added_dt, start_time, edit_time | Values should be YYYY-MM-DD Formatted dates.

#### Sort [ optional ]:
Values are sorted by added_dt.  Valid `sort` values are desc or asc.  If left blank, asc is assumed.  

For example:

```http://localhost:3000/details?filter=cust_id&value=1240&sort=desc```

^^ This would return all of the CDR's with a cust_id of 1240, sorted descendingly on added_dt

```http://localhost:3000/details?filter=start_time&value=2025-05-02&sort=desc```

^^ This would return all of the CDR's with an added_dt of 2025-05-02, sorted descendingly by added_dt.

#### Note : a filter and a value are required for a details call to be valid.

# Notes:
* Assumed that when a duplicate to the Primary Key comes in, that the row should be updated with the new data.  A 
REPLACE INTO was used instead of INSERT.