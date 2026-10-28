const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/me',
  method: 'GET',
  headers: {
    'Cookie': 'session=5f7c7e422787b5a5cefa78715fa40008ec166cec9c3147886d856109f8f013c9'
  }
}, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Status:', res.statusCode, 'Response:', d));
});
req.end();