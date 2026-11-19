/** Static deployment build. Uses only Node's standard library. */
import {mkdir,rm,cp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dist=path.join(root,'dist');
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
await cp(path.join(root,'static'),path.join(dist,'static'),{recursive:true});
await cp(path.join(root,'static/index.html'),path.join(dist,'index.html'));
await rm(path.join(dist,'static/index.html'));
await writeFile(path.join(dist,'robots.txt'),'User-agent: *\nDisallow: /\n');
console.log('Built dist/ — frontend-only preview, no Python server or private files.');

const hosting=JSON.parse(await readFile(path.join(root,'vercel.json'),'utf8'));
await writeFile(path.join(dist,'_headers'),'/*\n'+hosting.headers[0].headers.map(h=>`  ${h.key}: ${h.value}`).join('\n')+'\n');
