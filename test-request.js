import http from 'http';

const data = JSON.stringify({
  email: "dev29123@gmail.com"
});

const options = {
  hostname: 'localhost',
  port: 5001,
  path: '/auth/request-otp',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.write(data);
req.end();
