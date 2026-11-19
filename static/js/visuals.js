import {esc,clock,pad,t} from './utils.js';
const D=Math.PI/180;
const projection=(lon,lat,lon0,lat0,r,cx,cy)=>{
 const l=(lon-lon0)*D,p=lat*D,p0=lat0*D;
 return {x:cx+r*Math.cos(p)*Math.sin(l),y:cy-r*(Math.cos(p0)*Math.sin(p)-Math.sin(p0)*Math.cos(p)*Math.cos(l)),z:Math.sin(p0)*Math.sin(p)+Math.cos(p0)*Math.cos(p)*Math.cos(l)};
};
const line = points => points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
const visibleLine = points => {let d='',last=false;for(const p of points){if(p.z>=0){d+=`${last?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)} `;last=true;}else last=false;}return d;};

/** Geographic coastlines and ground-station coordinates; satellite placement is
 * deliberately schematic. This view never supplies data to the scheduler. */
export function drawGlobe(el,{land,scenario,result,selectedRequest='R-01',center=[60,24],zoom=1,showLinks=true,onStation,onSatellite,onView}) {
 let view=[...center],scale=zoom;
 const render=()=>{
  const cx=490,cy=258,r=227*scale,project=(lon,lat)=>projection(lon,lat,view[0],view[1],r,cx,cy);
  const coast=land.map(ring=>{
    const pts=ring.map(([lon,lat])=>project(lon,lat));if(!pts.some(p=>p.z>=0))return '';
    return `<path d="${line(pts.map(p=>{if(p.z>=0)return p;const a=Math.atan2(p.y-cy,p.x-cx);return{x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)};}))}Z"/>`;
  }).join('');
  const grid=[];
  for(let lon=-180;lon<180;lon+=30)grid.push(visibleLine(Array.from({length:181},(_,i)=>project(lon,i-90))));
  for(let lat=-60;lat<=60;lat+=30)grid.push(visibleLine(Array.from({length:361},(_,i)=>project(i-180,lat))));
  const selected=scenario.requests.find(q=>q.id===selectedRequest),chosenSat=selected?.satellite_id||scenario.satellites[0]?.id;
  const placements=[[-2,37],[31,63],[111,48],[122,-8],[70,-38],[15,-23],[90,5],[130,20]];
  const sats=scenario.satellites.map((sat,i)=>({sat,...project(...placements[i%placements.length])}));
  const stations=scenario.stations.map((s,i)=>({s,i,...project(s.longitude,s.latitude)}));
  const current=result?.schedule.find(a=>a.request_id===selectedRequest),selectedNode=sats.find(o=>o.sat.id===chosenSat);
  const links=showLinks&&selectedNode?.z>=0?stations.filter(st=>st.z>=0&&scenario.satellites.find(s=>s.id===chosenSat)?.allowed_station_ids.includes(st.s.id)).map(st=>{
    const active=current?.station_id===st.s.id;
    return `<path class="globe-link ${active?'assigned':''}" d="M${selectedNode.x} ${selectedNode.y} Q${(selectedNode.x+st.x)/2} ${Math.min(selectedNode.y,st.y)-70} ${st.x} ${st.y}"/>`;
  }).join(''):'';
  const pins=stations.filter(st=>st.z>=0).map(({s,x,y,i})=>{
    const labelY=y+([-38,18,55][i%3]),labelX=x+([57,-113,62][i%3]),down=scenario.outages.some(o=>o.station_id===s.id);
    return `<g class="station-pin ${down?'outage':''}" role="button" tabindex="0" data-station="${esc(s.id)}" aria-label="Inspect ${esc(s.name)}"><path class="leader" d="M${x} ${y}L${labelX} ${labelY}h${i%3===1?-42:51}"/><rect x="${x-5}" y="${y-5}" width="10" height="10"/><rect class="hitbox" x="${x-16}" y="${y-16}" width="32" height="32"/><text x="${labelX}" y="${labelY-7}" text-anchor="${i%3===1?'end':'start'}">${esc(s.id)}${down?' / OUTAGE':''}</text></g>`;
  }).join('');
  const vehicles=sats.filter(o=>o.z>=0).map(({sat,x,y})=>`<g class="satellite-pin ${sat.id===chosenSat?'selected':''}" role="button" tabindex="0" data-satellite="${esc(sat.id)}" aria-label="Inspect ${esc(sat.name)}, illustrative position"><path d="M${x-6} ${y}l6-6 6 6-6 6Z"/><path d="M${x-11} ${y-7}l-3 3 7 7 3-3m8 3 3-3 7 7-3 3"/><rect class="hitbox" x="${x-18}" y="${y-18}" width="36" height="36"/><text x="${x+16}" y="${y-9}">${esc(sat.id)}</text></g>`).join('');
  el.innerHTML=`<svg class="globe-svg" viewBox="0 0 980 520" role="img" aria-label="Interactive Earth reference: geographic stations, illustrative satellite positions. Drag to rotate." tabindex="0"><defs><clipPath id="globe-clip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs><g class="globe-surround"><path d="M32 50h35M32 50v35M948 50h-35M948 50v35M32 469h35M32 469v-35M948 469h-35M948 469v-35"/><text x="38" y="108">N</text><path d="M42 122v32m-5-24 5-8 5 8"/><text x="818" y="455">${Math.abs(view[0]).toFixed(0)}° ${view[0]>=0?'E':'W'}</text><text x="818" y="471">${Math.abs(view[1]).toFixed(0)}° ${view[1]>=0?'N':'S'}</text></g><circle class="globe-outline" cx="${cx}" cy="${cy}" r="${r}"/><g clip-path="url(#globe-clip)"><g class="globe-land">${coast}</g><g class="globe-grid">${grid.map(d=>`<path d="${d}"/>`).join('')}</g></g><g>${links}</g>${pins}${vehicles}<text class="map-watermark" x="490" y="420" text-anchor="middle">EARTH REFERENCE</text></svg>`;
  el.querySelectorAll('[data-station]').forEach(p=>{p.addEventListener('click',()=>onStation(p.dataset.station));p.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onStation(p.dataset.station);}});});
  el.querySelectorAll('[data-satellite]').forEach(p=>{p.addEventListener('click',()=>onSatellite(p.dataset.satellite));p.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSatellite(p.dataset.satellite);}});});
  const svg=el.querySelector('svg');let drag;
  svg.addEventListener('pointerdown',e=>{if(e.target.closest('[role="button"]'))return;drag={x:e.clientX,y:e.clientY,view:[...view]};svg.setPointerCapture(e.pointerId);});
  svg.addEventListener('pointerup',e=>{if(!drag)return;view=[drag.view[0]-(e.clientX-drag.x)*.25,Math.max(-65,Math.min(65,drag.view[1]+(e.clientY-drag.y)*.25))];drag=null;onView?.(view,scale);render();});
  svg.addEventListener('keydown',e=>{const moves={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,10],ArrowDown:[0,-10]};if(moves[e.key]){e.preventDefault();view=[view[0]+moves[e.key][0],Math.max(-65,Math.min(65,view[1]+moves[e.key][1]))];onView?.(view,scale);render();el.querySelector('svg').focus();}});
 };
 render();return {zoom:delta=>{scale=Math.min(1.5,Math.max(.7,scale+delta));onView?.(view,scale);render();},reset:()=>{view=[60,24];scale=1;onView?.(view,scale);render();}};
}

export function timeline(s,result,{zone='UTC',focus=true,selected='',baseline=false}={}) {
 const schedule=baseline?(result?.baseline_schedule||[]):(result?.schedule||[]);
 const first=s.windows.length?Math.min(...s.windows.map(w=>t(w.start))):t(s.start);
 let from=focus?Math.max(t(s.start),first-10*60000):t(s.start),to=focus?Math.min(t(s.end),first+95*60000):t(s.end);
 const range=to-from, at=v=>Math.max(0,Math.min(100,(t(v)-from)/range*100));
 const markers=Array.from({length:8},(_,i)=>from+range*i/7);
 const rows=s.stations.map(st=>{
   const wins=s.windows.filter(w=>w.station_id===st.id&&t(w.end)>from&&t(w.start)<to);
   const contacts=schedule.filter(a=>a.station_id===st.id&&t(a.reserved_end)>from&&t(a.reserved_start)<to);
   const outages=s.outages.filter(o=>o.station_id===st.id&&t(o.end)>from&&t(o.start)<to);
   return `<div class="timeline-row"><div class="timeline-label"><strong>${esc(st.id)}</strong><span>${esc(st.name.split(' ·')[0])}</span></div><div class="timeline-track">${markers.map((_,i)=>`<i class="timeline-gridline" style="--left:${i/7*100}%"></i>`).join('')}${wins.map(w=>`<div class="visibility" style="--left:${at(w.start)}%;--width:${Math.max(.2,at(w.end)-at(w.start))}%" title="${esc(w.satellite_id)} visibility: ${clock(w.start,zone)}–${clock(w.end,zone)}"></div>`).join('')}${outages.map(o=>`<div class="outage-block" style="--left:${at(o.start)}%;--width:${at(o.end)-at(o.start)}%" title="${esc(o.reason)}"><span>UNAVAILABLE</span></div>`).join('')}${contacts.map(a=>{const r=s.requests.find(r=>r.id===a.request_id);return `<button class="contact-block ${r?.priority==='critical'?'critical':''} ${selected===a.request_id?'selected':''}" style="--left:${at(a.reserved_start)}%;--width:${Math.max(.25,at(a.reserved_end)-at(a.reserved_start))}%" data-inspect="${esc(a.request_id)}" aria-label="${esc(a.request_id)} at ${esc(st.id)}, ${clock(a.start,zone,true)} to ${clock(a.end,zone,true)}" title="${esc(a.request_id)} / ${esc(a.satellite_id)} / ${clock(a.start,zone,true)}–${clock(a.end,zone,true)}"><span>${esc(a.request_id)}</span></button>`;}).join('')}</div></div>`;
 }).join('');
 return `<div class="timeline-wrap" tabindex="0" role="region" aria-label="Contact timeline. Scroll horizontally on narrow screens."><div class="timeline-inner"><div class="timeline-axis"><span>${zone==='UTC'?'UTC':'IST'}</span><div>${markers.map((v,i)=>`<span style="--left:${i/7*100}%">${clock(v,zone)}</span>`).join('')}</div></div>${rows}</div></div>`;
}

export function stationLoad(s,result) {
 return s.stations.map(st=>{const windows=s.windows.filter(w=>w.station_id===st.id).length,count=result?.schedule.filter(a=>a.station_id===st.id).length||0;
 return `<div class="load-row"><div><strong>${esc(st.id)}</strong><span>${pad(count)} contacts</span></div><div class="load-segments">${Array.from({length:12},(_,i)=>`<i class="${i<Math.min(12,Math.round(count/Math.max(windows,1)*12))?'filled':''}"></i>`).join('')}</div><span class="muted">${windows} windows</span></div>`;}).join('');
}
