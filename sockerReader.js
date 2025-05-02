
// Make a GET request
// axios.get('https://api.atscall.me:3102/auth')
//   .then(response => {
//     console.log(response.data);
//   })
//   .catch(error => {
//     console.error(error);
//   });

// Acquire JWT for socket data transfer...
let authUrl = 'https://api.atscall.me:3102/auth';
let username = 'drew';
let password = 'password123';

axios.post(session_url, {}, {
	auth: {
		username: username,
		password: password
	}
}).then(authResponse => {
	console.log(authResponse);
	console.log(authResponse.data);
})
	.catch(error => {
	console.error(error);
});


// axios.post(authUrl, {
//     name: 'John Doe',
//     email: 'john.doe@example.com'
//   })
//   .then(response => {
//     console.log(response.data);
//   })
//   .catch(error => {
//     console.error(error);
//   });