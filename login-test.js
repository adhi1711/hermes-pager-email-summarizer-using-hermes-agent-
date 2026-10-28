const http = require('http');
const data = JSON.stringify({email:'test@test.com',password:'password123'});
const req = http.request({hostname:'localhost',port:3000,path:'/api/auth/login',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},(res)=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log('Status:',res.statusCode,'Response:',d))});
req.write(data);
req.end();