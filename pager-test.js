const http = require('http');
const req = http.request({hostname:'localhost',port:3000,path:'/api/pager',method:'GET',headers:{'Cookie':'session=b0a1be9cb8bd5e4119630a40e7936955c4ce73c0f581e437c51ba5afadd0d27b'}},(res)=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log('Status:',res.statusCode,'Response:',d))});
req.end();