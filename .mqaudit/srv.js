const http=require('http'),fs=require('fs'),path=require('path');
const root='D:/blog/public';
const mt={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.xml':'application/xml'};
http.createServer((rq,rs)=>{
  let p=decodeURIComponent(rq.url.split('?')[0]);
  let f=path.join(root,p);
  try{ if(fs.statSync(f).isDirectory()) f=path.join(f,'index.html'); }catch(e){ rs.writeHead(404); return rs.end('nf'); }
  try{ const b=fs.readFileSync(f); rs.writeHead(200,{'Content-Type':mt[path.extname(f)]||'application/octet-stream'}); rs.end(b);}catch(e){rs.writeHead(404);rs.end('nf');}
}).listen(8899,'127.0.0.1',()=>console.log('listening 8899'));
