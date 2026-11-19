/** Dependency-free HTTP preview. No API, authentication or real mission control. */
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||5173);
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 try{
  const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(route==='/api/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'frontend-preview',live_control:false}));return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Method not allowed');return;}
  const filename=route==='/'?path.join(root,'static/index.html'):path.resolve(root,'.'+route);
  const staticRoot=path.join(root,'static')+path.sep;
  if(!filename.startsWith(staticRoot)){res.writeHead(404);res.end('Not found');return;}
  const info=await stat(filename);if(!info.isFile())throw new Error('Not a file');
  res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
  res.end(req.method==='HEAD'?undefined:await readFile(filename));
 }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
});
server.on('error',err=>{console.error(`Preview could not start: ${err.message}`);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`\nPassRescue / frontend preview\nOpen http://127.0.0.1:${port}\nBrowser heuristic only. Keep this terminal open.\n`));
