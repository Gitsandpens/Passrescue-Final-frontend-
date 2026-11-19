import {validateScenario,makePlan,contactErrors} from './engine.js';
import {drawGlobe,timeline,stationLoad} from './visuals.js';
import {esc,pad,t,clock,day,utcInput,fromInput,minutes,nice,percent,fmtCoords,icon,logo} from './utils.js';

const STORAGE='passrescue.command.v2';
const CONFIG=window.PASSRESCUE_CONFIG||{mode:'auto',apiBase:'',apiTimeoutMs:60000};
const routes={
 overview:{index:'01',name:'Mission control',group:'OPERATIONS',icon:'globe',description:'Review proposed contacts, station availability and unserved requests.'},
 schedule:{index:'02',name:'Contact planner',group:'OPERATIONS',icon:'schedule',description:'Allocate antenna time without breaking mission constraints.'},
 recovery:{index:'03',name:'Recovery lab',group:'OPERATIONS',icon:'recover',description:'Change the conditions. Find out what can still be served.'},
 requests:{index:'04',name:'Mission requests',group:'INPUTS',icon:'requests',description:'Set the priority, required duration and deadline for each contact.'},
 stations:{index:'05',name:'Ground network',group:'INPUTS',icon:'station',description:'Define station resources and approved satellite pairings.'},
 data:{index:'06',name:'Data workspace',group:'INPUTS',icon:'data',description:'Know where every input came from. Save a reproducible scenario.'},
 evaluation:{index:'07',name:'Evaluation',group:'REVIEW',icon:'chart',description:'Check the constraints and compare like-for-like scheduling results.'},
 activity:{index:'08',name:'Run log',group:'REVIEW',icon:'log',description:'A local record of edits, calculations and exported proposals.'}
};
const state={scenario:null,land:[],result:null,reference:[],runInput:null,engine:'browser',health:null,dirty:false,busy:false,error:'',route:'overview',zone:'UTC',focus:true,compareBaseline:false,selected:'R-01',mapCenter:[60,24],mapZoom:1,showLinks:true,requestQuery:'',requestPriority:'all',requestStatus:'all',stationFilter:'all',log:[],storage:false};
let demo,globe,toastTimer;
const $=s=>document.querySelector(s);
const clone=structuredClone;
const request=id=>state.scenario.requests.find(r=>r.id===id)||state.runInput?.scenario.requests.find(r=>r.id===id);
const assignment=id=>state.result?.schedule.find(a=>a.request_id===id);
const engineLabel=()=>state.engine==='api'?'OR-TOOLS CP-SAT':'BROWSER HEURISTIC';
const badge=(value,label=value)=>`<span class="badge ${esc(value)}">${esc(label)}</span>`;
const action=(name,text,{primary=false,small=false,iconName='',disabled=false,id='',data=''}={})=>`<button ${id?`id="${id}"`:''} class="button ${primary?'primary':''} ${small?'small':''}" data-action="${name}" ${data} ${disabled||state.busy?'disabled':''}>${esc(text)}${iconName?icon(iconName):''}</button>`;
const intro=()=>`<div class="engine-line"><div class="inline"><i class="status-square ${state.dirty?'hollow':''}"></i><strong>${state.busy?'CALCULATING':state.dirty?'INPUTS CHANGED':state.result?'SCHEDULE CHECKED':'AWAITING PLAN'}</strong><span class="muted">/ ${engineLabel()} / ${state.scenario.mode==='synthetic'?'SYNTHETIC WINDOWS':'ORBIT REPLAY'}</span></div><span class="muted">${pad(state.scenario.satellites.length)} SATELLITES &nbsp; ${pad(state.scenario.stations.length)} STATIONS &nbsp; ${(t(state.scenario.end)-t(state.scenario.start))/3600000}H HORIZON</span></div>`;
const dirtyNotice=()=>state.dirty?`<div class="notice" role="status"><p><strong>Inputs changed.</strong> Figures below belong to the last checked plan. Recalculate before exporting a proposal.</p>${action(state.reference.length?'repair':'build','Recalculate',{small:true,iconName:'arrow'})}</div>`:'';
const noResult=()=>`<div class="empty"><span class="eyebrow muted">NO PLAN YET</span><h2 class="mt">Build the first schedule.</h2><p>Load your requirements and calculate a proposed allocation. No infrastructure will be booked.</p>${action('build','Build schedule',{primary:true,iconName:'arrow'})}</div>`;

function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);}
function log(type,message) {state.log.unshift({at:new Date().toISOString(),type,message});state.log=state.log.slice(0,100);save();}
function save() {try{localStorage.setItem(STORAGE,JSON.stringify({scenario:state.scenario,reference:state.reference,zone:state.zone,log:state.log}));state.storage=true;}catch{state.storage=false;}}
function setDirty(message) {state.dirty=true;state.error='';log('INPUT EDIT',message);render();toast(`${message} Recalculate to update the plan.`);}
function nav(view) {location.hash=`/${view}`;}
function download(name,body,type='application/json') {
 const data=type==='application/json'?JSON.stringify(body,null,2):body;
 const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function api(path,body,timeout=CONFIG.apiTimeoutMs||60000) {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetch(`${CONFIG.apiBase||''}${path}`,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:controller.signal});
  const data=await response.json();
  if(!response.ok){let detail=data.detail||'The calculation failed.';if(Array.isArray(detail))detail=detail.map(d=>`${(d.loc||[]).join('.')}: ${d.msg}`).join('; ');throw new Error(String(detail));}
  return data;
 }catch(e){if(e.name==='AbortError')throw new Error('The server took too long to respond. No replacement plan was accepted.');throw e;}finally{clearTimeout(timer);}
}
async function compute(kind='build',quiet=false) {
 if(state.busy)return;
 state.busy=true;state.error='';render();
 const scenario=clone(state.scenario),previous=kind==='repair'?clone(state.reference.filter(a=>scenario.requests.some(r=>r.id===a.request_id))):[];
 try{
  validateScenario(scenario);
  await new Promise(resolve=>setTimeout(resolve,20)); // Let the calculating state paint.
  const input={scenario,previous,time_limit_s:8};
  const result=state.engine==='api'?await api('/api/plan',input):makePlan(scenario,previous);
  if(!result.validation?.valid)throw new Error('The engine returned an unchecked plan. It has not been accepted.');
  state.result=result;state.runInput=input;state.dirty=false;
  if(kind==='build')state.reference=clone(result.schedule);
  log(kind==='repair'?'PLAN REPAIRED':'PLAN BUILT',`${result.metrics.scheduled}/${result.metrics.requested} requests scheduled; ${result.validation.violation_count} declared-constraint violations. ${engineLabel()}.`);
  if(!quiet)toast(kind==='repair'?`Recovery checked. ${result.recovery.recovered} disrupted contacts recovered; ${result.metrics.unserved} requests remain unserved.`:`Schedule checked. ${result.metrics.scheduled} requests assigned; ${result.metrics.unserved} unserved.`);
 }catch(e){state.error=e.message||'Calculation failed.';state.dirty=true;if(!quiet)toast(state.error);log('CALCULATION ERROR',state.error);}
 finally{state.busy=false;save();render();}
}

function syncNavigation() {
 const sidebar=$('#sidebar');if(!sidebar)return;
 const opened=sidebar.classList.contains('open');
 sidebar.inert=window.matchMedia('(max-width:800px)').matches&&!opened;
 document.querySelector('[aria-label="Toggle navigation"]')?.setAttribute('aria-expanded',String(opened));
}
function shell() {
 $('#app').innerHTML=`<aside class="sidebar" id="sidebar" aria-label="Application navigation"><a class="brand" href="#/overview" aria-label="PassRescue mission control">${logo()}<span><span class="brand-word">PASSRESCUE</span><span class="brand-sub">GROUND OPERATIONS</span></span></a><nav class="nav">${['OPERATIONS','INPUTS','REVIEW'].map(group=>`<div class="nav-group"><span class="nav-group-name">${group}</span>${Object.entries(routes).filter(([,r])=>r.group===group).map(([key,r])=>`<a class="nav-link" href="#/${key}" data-nav="${key}">${icon(r.icon)}<span>${r.name}</span><span class="nav-index">${r.index}</span></a>`).join('')}</div>`).join('')}</nav><div class="sidebar-bottom"><button class="text-link" data-action="guide">Guide & assumptions ${icon('diagonal')}</button><div class="scope-note"><span class="eyebrow">PROPOSALS, NOT COMMANDS</span><p>Planning environment.<br>No live spacecraft connection.</p></div></div></aside><button class="mobile-scrim" data-action="menu" aria-label="Close navigation"></button><div class="app-frame"><header class="topbar"><button class="button icon-only mobile-menu" data-action="menu" aria-label="Toggle navigation" aria-expanded="false">${icon('menu')}</button><div class="breadcrumbs"><span class="muted">WORKSPACE</span><span class="muted">/</span><strong id="breadcrumb">Mission control</strong></div><div class="topbar-right"><span class="badge emphasis"><i class="status-square"></i>SIMULATION</span><div class="replay-date" id="replay-date"></div><label class="sr-label" for="timezone" hidden>Display timezone</label><select id="timezone" aria-label="Display timezone"><option value="UTC">UTC</option><option value="Asia/Kolkata">IST</option></select></div></header><main id="main-content" tabindex="-1"></main></div>`;
 $('#timezone').value=state.zone;syncNavigation();
}
function headActions() {
 switch(state.route){
  case 'requests':return action('export-inputs','Export inputs',{iconName:'download'})+action('add-request','Add request',{primary:true,iconName:'plus'});
  case 'recovery':return action('preset','Load test outage',{iconName:'plus'})+action('repair',state.busy?'Calculating…':'Repair schedule',{primary:true,iconName:'recover',disabled:!state.reference.length});
  case 'data':return action('export-inputs','Export inputs',{iconName:'download'})+action('import-scenario','Import scenario',{primary:true,iconName:'upload'});
  case 'evaluation':return action('export-report','Export run report',{primary:true,iconName:'download',disabled:!state.result||state.dirty});
  case 'activity':return action('export-log','Export log',{iconName:'download'});
  case 'stations':return action('export-inputs','Export inputs',{iconName:'download'})+action('build','Build schedule',{primary:true,iconName:'arrow'});
  default:return action('export-csv','Export proposal',{iconName:'download',disabled:!state.result||state.dirty})+action('build',state.busy?'Calculating…':'Build schedule',{primary:true,iconName:'arrow'});
 }
}
function render() {
 if(!state.scenario||!$('#main-content'))return;
 const focused=document.activeElement?.id,selection=document.activeElement?.selectionStart;
 const route=routes[state.route];
 document.title=`PassRescue — ${route.name}`;$('#breadcrumb').textContent=route.name;
 $('#replay-date').innerHTML=`${esc(day(state.scenario.start,state.zone).toUpperCase())}<span>REPLAY DATE · NOT LIVE</span>`;
 document.querySelectorAll('[data-nav]').forEach(a=>{if(a.dataset.nav===state.route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 const pages={overview,schedule:planner,recovery,requests:requestsPage,stations:stationsPage,data:dataPage,evaluation,activity};
 $('#main-content').innerHTML=`<div class="page-head"><div><div class="eyebrow">${route.index} / ${route.group}</div><h1>${route.name}</h1><p>${route.description}</p></div><div class="page-actions">${headActions()}</div></div>${intro()}${state.error?`<div class="notice" role="alert"><p><strong>Calculation not accepted.</strong> ${esc(state.error)}</p></div>`:''}${dirtyNotice()}${pages[state.route]()}<footer class="workspace-footer"><span>PASSRESCUE / COMMAND EDITION 02 &nbsp; — &nbsp; ${state.storage?'SAVED IN THIS BROWSER':'STORAGE UNAVAILABLE · EXPORT YOUR INPUTS'}</span><span>SYNTHETIC WORKLOAD · NO LIVE BOOKING OR SPACECRAFT CONTROL</span></footer>`;
 if($('#globe'))globe=drawGlobe($('#globe'),{land:state.land,scenario:state.scenario,result:state.result,selectedRequest:state.selected,center:state.mapCenter,zoom:state.mapZoom,showLinks:state.showLinks,onStation:inspectStation,onSatellite:inspectSatellite,onView:(center,zoom)=>{state.mapCenter=center;state.mapZoom=zoom;}});
 if(focused&&document.getElementById(focused)&&!$('#dialog').open){const element=document.getElementById(focused);element.focus({preventScroll:true});if(typeof selection==='number'&&element.setSelectionRange)try{element.setSelectionRange(selection,selection);}catch{}}
}
function metric(label,value,total,note,{accent=false,progress=0}={}) {
 return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value ${accent?'accent':''}">${value}${total!==null?`<span>/ ${total}</span>`:''}</div><div class="metric-note">${note}</div><div class="metric-progress">${Array.from({length:20},(_,i)=>`<i class="${i<progress/5?'filled':''}"></i>`).join('')}</div></div>`;
}
function metricsBar() {
 const s=state.scenario,m=state.result?.metrics;
 return `<section class="metrics" aria-label="Schedule metrics">${metric('Scheduled contacts',m?.scheduled??'—',m?.requested??s.requests.length,'Requests assigned within their deadlines',{accent:true,progress:percent(m?.scheduled,s.requests.length)})}${metric('Critical requests',m?.critical_scheduled??'—',s.requests.filter(r=>r.priority==='critical').length,'Scheduled before the required deadline',{progress:percent(m?.critical_scheduled,m?.critical_requested)})}${metric('Unserved requests',m?pad(m.unserved):'—',null,'Explicitly flagged for operator review',{progress:percent(m?.unserved,s.requests.length)})}${metric('Ground stations',pad(s.stations.length),null,`${s.outages.length?new Set(s.outages.map(o=>o.station_id)).size+' with declared outages':'No outages declared'} · simulated network`,{progress:100})}</section>`;
}
function mapPanel() {
 return `<section class="instrument" aria-labelledby="network-title"><div class="instrument-head"><h2 id="network-title">Ground network</h2><span class="eyebrow push">REGIONAL REFERENCE</span><div class="segmented" aria-label="Map link display"><button data-action="show-links" aria-pressed="${state.showLinks}">Links</button><button data-action="hide-links" aria-pressed="${!state.showLinks}">Stations</button></div></div><div class="globe-frame"><div class="map-kicker"><span class="eyebrow">SELECTED SPACECRAFT</span><strong>${esc(request(state.selected)?.satellite_id||state.scenario.satellites[0]?.id||'NONE')}</strong></div><div class="globe-container" id="globe"></div><div class="map-legend"><span><i></i>Ground station</span><span><i class="diamond"></i>Satellite · schematic</span></div><div class="map-controls"><button class="button icon-only" data-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button class="button icon-only" data-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button><button class="button icon-only" data-action="reset-map" aria-label="Reset map view">${icon('reset')}</button></div></div><div class="instrument-foot"><p>Illustrative satellite positions. Station coordinates from scenario.</p><button class="text-link" data-action="map-guide">View model ${icon('diagonal')}</button></div></section>`;
}
function overview() {
 const r=state.result,s=state.scenario;
 const next=r?.schedule.find(a=>t(a.reserved_start)>=t(s.decision_time)),priorities=s.requests.filter(q=>q.priority==='critical').slice(0,3);
 const timePanel=`<section class="instrument"><div class="instrument-head"><h2>Antenna timeline</h2><span class="eyebrow push">${state.focus?'FOCUS WINDOW':'FULL HORIZON'}</span><a class="text-link" href="#/schedule" aria-label="Open contact planner">${icon('diagonal')}</a></div>${timeline(s,r,{zone:state.zone,focus:state.focus,selected:state.selected})}<div class="instrument-foot">${timelineKey()}<span class="muted">Preparation buffers included</span></div></section>`;
 return `${metricsBar()}<div class="control-grid"><div class="control-main">${mapPanel()}${timePanel}</div><aside class="priority-column" aria-label="Priority contacts"><section class="next-contact"><div class="eyebrow">FIRST PROPOSED CONTACT</div><div class="next-time">${next?clock(next.start,state.zone,true):'—'}<span>${state.zone==='UTC'?'UTC':'IST'}</span></div><div class="route-line">${next?`${esc(next.satellite_id)} ${icon('arrow')} ${esc(next.station_id)}`:'No contact assigned'}</div><div class="priority-list">${priorities.map(q=>{const a=assignment(q.id);return `<button class="queue-item" data-inspect="${esc(q.id)}"><div class="queue-top"><strong>${esc(q.id)} / ${esc(q.satellite_id)}</strong>${badge('critical','P1')}</div><p>${esc(q.label)}</p><small>BY ${clock(q.deadline,state.zone)} · ${a?esc(a.station_id):'UNSERVED'}</small></button>`;}).join('')}</div></section><section class="attention-note"><h3>${r?pad(r.metrics.unserved):'—'} requests need a decision.</h3><p>${r?.metrics.unserved?'Inspect missing windows, competing requests and unapproved pairings.':'Review the model before using any proposed schedule.'}</p><a class="text-link" href="#/recovery">Open recovery lab ${icon('arrow')}</a></section><section class="instrument allocation"><div class="instrument-head"><h2>Planned allocation</h2><span class="eyebrow push">BY STATION</span></div><div class="instrument-body">${stationLoad(s,r)}</div></section></aside></div>`;
}
function timelineKey() {return '<div class="timeline-key"><span><i></i>Visibility</span><span><i class="payload"></i>Reservation</span><span><i class="critical"></i>Critical</span></div>';}
function planner() {
 if(!state.result)return noResult();
 const r=state.result,s=state.scenario,rows=(state.compareBaseline?r.baseline_schedule:r.schedule).filter(a=>state.stationFilter==='all'||a.station_id===state.stationFilter);
 return `${metricsBar()}<section class="instrument"><div class="instrument-head"><h2>Contact reservations</h2><div class="segmented push" aria-label="Timeline range"><button data-action="focus-timeline" aria-pressed="${state.focus}">Focus window</button><button data-action="full-timeline" aria-pressed="${!state.focus}">Full horizon</button></div></div>${timeline(s,r,{zone:state.zone,focus:state.focus,selected:state.selected,baseline:state.compareBaseline})}<div class="instrument-foot">${timelineKey()}<p>Block width includes acquisition and turnaround.</p></div></section><div class="section-title mt"><h2>Proposed contact ledger</h2><span class="muted">${rows.length} records</span></div><div class="toolbar"><div class="segmented" aria-label="Schedule comparison"><button data-action="selected-plan" aria-pressed="${!state.compareBaseline}">Selected plan</button><button data-action="baseline-plan" aria-pressed="${state.compareBaseline}">Greedy baseline</button></div><select id="station-filter" aria-label="Filter contact station"><option value="all">All stations</option>${s.stations.map(st=>`<option value="${esc(st.id)}" ${state.stationFilter===st.id?'selected':''}>${esc(st.id)}</option>`).join('')}</select><span class="push muted">Times in ${state.zone==='UTC'?'UTC':'IST'}</span></div>${rows.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Request / payload</th><th>Satellite</th><th>Station</th><th>Payload interval</th><th>Reserved interval</th><th>Priority</th><th></th></tr></thead><tbody>${rows.map(a=>{const q=request(a.request_id);return `<tr><td><button class="record-name" data-inspect="${esc(q.id)}"><strong>${esc(q.id)}</strong><span>${esc(q.label)}</span></button></td><td>${esc(a.satellite_id)}</td><td>${esc(a.station_id)}</td><td>${clock(a.start,state.zone,true)}–${clock(a.end,state.zone,true)}</td><td class="muted">${clock(a.reserved_start,state.zone,true)}–${clock(a.reserved_end,state.zone,true)}</td><td>${badge(q.priority)}</td><td><button class="button icon-only quiet" data-inspect="${esc(q.id)}" aria-label="Inspect ${esc(q.id)}">${icon('diagonal')}</button></td></tr>`;}).join('')}</tbody></table></div>`:`<div class="empty"><h2>No contacts in this selection.</h2><p>Choose another station or inspect the unserved requests.</p></div>`}<div class="table-footer"><span>Proposal only. Half-open reservation intervals: [start, end).</span><span>${esc(state.compareBaseline?'Baseline planner':r.solver.status)} / ${s.slot_seconds}-SECOND GRID</span></div>`;
}
function changeRoute(a,label) {return `<div><span>${label}</span>${a?`${esc(a.station_id)} / ${clock(a.start,state.zone,true)}–${clock(a.end,state.zone,true)}`:'NOT ASSIGNED'}</div>`;}
function recovery() {
 const s=state.scenario,r=state.result,recovered=r?.recovery.is_recovery;
 const impacted=state.reference.filter(a=>contactErrors(s,a,state.reference).length);
 const changes=recovered?r.changes.filter(c=>c.status!=='unchanged'&&c.status!=='scheduled'):[];
 return `<div class="recovery-layout"><section class="config-panel"><div class="step-label">01 / DECLARE A DISRUPTION</div><h2>One station down.<br>What changes?</h2><p>Mark a station unavailable for a period. The planner checks alternatives against the saved reference schedule.</p><form id="outage-form"><div class="form-grid"><div class="field full"><label for="outage-station">Ground station</label><select id="outage-station" name="station_id">${s.stations.map(st=>`<option value="${esc(st.id)}">${esc(st.id)} / ${esc(st.name.split(' ·')[0])}</option>`).join('')}</select></div><div class="field full"><label for="outage-start">Unavailable from · UTC</label><input id="outage-start" name="start" type="datetime-local" required value="${utcInput(s.metadata?.recommended_outage?.start||s.windows[0]?.start||s.start)}"></div><div class="field full"><label for="outage-end">Available again · UTC</label><input id="outage-end" name="end" type="datetime-local" required value="${utcInput(s.metadata?.recommended_outage?.end||new Date(t(s.windows[0]?.start||s.start)+2700000).toISOString())}"></div><div class="field full"><label for="outage-reason">Reason</label><input id="outage-reason" name="reason" maxlength="160" value="Antenna maintenance" required></div></div><div class="form-actions"><button class="button" type="submit" ${state.busy?'disabled':''}>Add outage ${icon('plus')}</button></div></form><div class="section-title mt"><span class="eyebrow">DECLARED OUTAGES / ${pad(s.outages.length)}</span></div>${s.outages.length?s.outages.map(o=>`<div class="outage-item"><div class="inline"><strong>${esc(o.station_id)}</strong><button class="button icon-only quiet push" data-action="remove-outage" data-id="${esc(o.id)}" aria-label="Remove outage ${esc(o.id)}">${icon('close')}</button></div><div>${clock(o.start,state.zone)}–${clock(o.end,state.zone)} ${state.zone==='UTC'?'UTC':'IST'}</div><p>${esc(o.reason)}</p></div>`).join(''):'<p class="muted" style="font-size:var(--text-xs)">No outages declared. Use the prepared scenario or add your own.</p>'}</section><section><div class="step-label">02 / CHECK THE CONSEQUENCES</div><div class="section-title"><h2>Recovery proposal</h2>${badge(state.dirty?'unserved':'routine',state.dirty?'NEEDS RECALCULATION':recovered?'CHECKED':'REFERENCE SAVED')}</div><div class="recovery-stats"><div><span>DISRUPTED CONTACTS</span><strong>${recovered&&!state.dirty?pad(r.recovery.affected):pad(impacted.length)}</strong><span>From the saved reference</span></div><div><span>RECOVERED</span><strong class="accent">${recovered&&!state.dirty?pad(r.recovery.recovered):'—'}</strong><span>Eligible replacement found</span></div><div><span>KEPT UNCHANGED</span><strong>${recovered&&!state.dirty?pad(r.metrics.unchanged):'—'}</strong><span>Same station and interval</span></div></div>${recovered?`${r.metrics.critical_scheduled<r.metrics.critical_requested?`<div class="notice"><p><strong>${r.metrics.critical_requested-r.metrics.critical_scheduled} critical request remains unserved.</strong> Do not interpret a valid schedule as completion of every mission request.</p></div>`:''}<section class="instrument"><div class="instrument-head"><h2>Repaired timetable</h2><span class="eyebrow push">${state.zone==='UTC'?'UTC':'IST'}</span></div>${timeline(s,r,{zone:state.zone,focus:true,selected:state.selected})}</section><div class="section-title mt"><h2>Decisions, explained</h2><span class="muted">${changes.length} to review</span></div>${changes.length?changes.map(c=>`<article class="decision"><div class="decision-head"><h3>${esc(c.request_id)}</h3>${badge(c.status)}<button class="text-link push" data-inspect="${esc(c.request_id)}">Inspect ${icon('diagonal')}</button></div><p>${esc(request(c.request_id)?.label)}</p><div class="change-route">${changeRoute(c.before,'REFERENCE')}${icon('arrow')}${changeRoute(c.after,'PROPOSAL')}</div><p>${esc(c.reason)}</p></article>`).join(''):'<div class="empty"><h2>No contact changed.</h2><p>The reference remains feasible under the current inputs.</p></div>'}`:`<div class="empty"><span class="eyebrow muted">REFERENCE / ${state.reference.length} CONTACTS</span><h2 class="mt">Test the plan before<br>you need a backup.</h2><p>Add a station outage, then select Repair schedule. The result will show replaced contacts, unchanged bookings and requests with no feasible alternative.</p>${action('preset','Load prepared outage',{primary:true,iconName:'plus'})}</div>${impacted.length?`<div class="section-title mt"><h2>Currently affected</h2></div>${impacted.map(a=>`<article class="decision"><div class="decision-head"><h3>${esc(a.request_id)}</h3>${badge(request(a.request_id)?.priority||'routine')}</div><p>${esc(contactErrors(s,a,state.reference).join(' '))}</p></article>`).join('')}`:''}`}${r?.warnings.length?`<section class="mt"><h2>Operator review required</h2>${r.warnings.map(w=>`<div class="notice mt"><p>${esc(w)}</p></div>`).join('')}</section>`:''}</section></div>`;
}
function requestsPage() {
 const s=state.scenario,query=state.requestQuery.toLowerCase();
 const rows=s.requests.filter(q=>[q.id,q.label,q.satellite_id].join(' ').toLowerCase().includes(query)&&(state.requestPriority==='all'||q.priority===state.requestPriority)&&(state.requestStatus==='all'||(state.requestStatus==='scheduled')===!!assignment(q.id)));
 const totals=['critical','high','routine'].map(p=>`${pad(s.requests.filter(q=>q.priority===p).length)} ${p.toUpperCase()}`).join(' / ');
 return `<div class="toolbar"><div class="search-field">${icon('search')}<input id="request-search" type="search" value="${esc(state.requestQuery)}" placeholder="Search ID, payload or satellite" aria-label="Search mission requests"></div><select id="priority-filter" aria-label="Filter request priority">${['all','critical','high','routine'].map(p=>`<option value="${p}" ${state.requestPriority===p?'selected':''}>${p==='all'?'All priorities':p[0].toUpperCase()+p.slice(1)}</option>`).join('')}</select><select id="status-filter" aria-label="Filter request status">${['all','scheduled','unserved'].map(p=>`<option value="${p}" ${state.requestStatus===p?'selected':''}>${p==='all'?'All statuses':p[0].toUpperCase()+p.slice(1)}</option>`).join('')}</select><span class="push muted">${pad(rows.length)} / ${pad(s.requests.length)}</span></div>${rows.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Request / payload</th><th>Satellite</th><th>Priority</th><th>Duration</th><th>Deadline · ${state.zone==='UTC'?'UTC':'IST'}</th><th>Last plan</th><th class="text-right">Action</th></tr></thead><tbody>${rows.map(q=>`<tr><td><button class="record-name" data-inspect="${esc(q.id)}"><strong>${esc(q.id)} ${q.locked?icon('lock'):''}</strong><span>${esc(q.label)}</span></button></td><td>${esc(q.satellite_id)}</td><td>${badge(q.priority)}</td><td>${minutes(q.duration_s)} min</td><td>${clock(q.deadline,state.zone,true)}</td><td>${badge(assignment(q.id)?'scheduled':'unserved',state.result?(assignment(q.id)?'Assigned':'Unserved'):'Not calculated')}</td><td><div class="row-actions"><button class="button small" data-action="edit-request" data-id="${esc(q.id)}">Edit</button></div></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><h2>No matching requests.</h2><p>Change your search or filters, or add a new mission request.</p>${action('clear-filters','Clear filters',{small:true})}</div>`}<div class="table-footer"><span>${totals}</span><span>Locks protect an existing eligible contact, not an impossible one.</span></div><div class="notice neutral mt"><p>Each request must fit inside one contact window. Duration is useful transmission time; station preparation buffers are added separately.</p></div>`;
}
function stationsPage() {
 const s=state.scenario;
 return `<section class="station-grid">${s.stations.map(st=>{const outage=s.outages.filter(o=>o.station_id===st.id),count=state.result?.schedule.filter(a=>a.station_id===st.id).length||0;
 return `<article class="station-summary"><div class="inline"><span class="eyebrow">${esc(st.id)} / SIMULATED</span><span class="push">${badge(outage.length?'unserved':'routine',outage.length?'OUTAGE DECLARED':'AVAILABLE INPUT')}</span></div><h2>${esc(st.name.split(' ·')[0])}</h2><p>${fmtCoords(st.latitude,st.longitude)}</p><div class="station-meta"><div><span>ANTENNAS</span><strong>01 exclusive</strong></div><div><span>CONTACTS PLANNED</span><strong>${pad(count)}</strong></div><div><span>ACQUISITION</span><strong>${st.acquisition_s} seconds</strong></div><div><span>TURNAROUND</span><strong>${st.turnaround_s} seconds</strong></div></div><button class="text-link" data-action="edit-station" data-id="${esc(st.id)}">Edit station ${icon('diagonal')}</button></article>`;}).join('')}</section><div class="section-title"><div><div class="step-label">SATELLITE × STATION</div><h2>Approved pairings</h2></div><span class="muted">${s.satellites.reduce((n,sat)=>n+sat.allowed_station_ids.length,0)} declared pairings</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Satellite / input name</th>${s.stations.map(st=>`<th class="matrix-cell">${esc(st.id)}</th>`).join('')}<th>Pairing status</th></tr></thead><tbody>${s.satellites.map(sat=>`<tr><td><button class="record-name" data-action="inspect-satellite" data-id="${esc(sat.id)}"><strong>${esc(sat.id)}</strong><span>${esc(sat.name)}</span></button></td>${s.stations.map(st=>`<td class="matrix-cell"><label><input type="checkbox" data-pair-sat="${esc(sat.id)}" data-pair-station="${esc(st.id)}" ${sat.allowed_station_ids.includes(st.id)?'checked':''} aria-label="Allow ${esc(sat.id)} at ${esc(st.id)}" ${state.busy?'disabled':''}></label></td>`).join('')}<td>${sat.allowed_station_ids.length?`${sat.allowed_station_ids.length} station${sat.allowed_station_ids.length===1?'':'s'}`:badge('unserved','No approved station')}</td></tr>`).join('')}</tbody></table></div><div class="notice neutral mt"><p>These are scenario permissions, not real ground-station access. Geometry alone does not establish radio compatibility, spectrum approval or a provider booking.</p></div>`;
}
function comparisonRow(label,a,b,max) {
 return `<div class="compare-row"><div><span>${label}</span><span><strong>${nice(a)}</strong><span class="muted"> / ${nice(b)}</span></span></div><div class="compare-bars"><div class="compare-bar selected" title="Selected: ${a}"><i style="--width:${percent(a,max)}%"></i></div><div class="compare-bar" title="Baseline: ${b}"><i style="--width:${percent(b,max)}%"></i></div></div></div>`;
}
function evaluation() {
 const r=state.result;if(!r)return noResult();const m=r.metrics,b=r.baseline_metrics;
 return `<div class="two-column"><section class="comparison"><div class="step-label">01 / SAME INPUTS, SAME CONSTRAINTS</div><h2>Compare both<br>scheduling results.</h2><p>${state.engine==='api'?'The selected plan and priority-aware greedy baseline receive the same candidate windows, protected contacts and scheduling rules.':'Browser mode runs the greedy baseline itself. Both columns therefore match; no improvement or optimality is claimed.'}</p><div class="inline wrap" style="font-size:var(--text-xs);margin-bottom:var(--s-5)"><span class="accent">— Selected plan</span><span class="muted">— Greedy baseline</span></div>${comparisonRow('Requests scheduled',m.scheduled,b.scheduled,m.requested)}${comparisonRow('Critical requests scheduled',m.critical_scheduled,b.critical_scheduled,m.critical_requested)}${comparisonRow('Planned payload · minutes',m.planned_payload_minutes,b.planned_payload_minutes,Math.max(m.planned_payload_minutes,b.planned_payload_minutes,1))}${comparisonRow('Existing contacts unchanged',m.unchanged,b.unchanged,state.reference.length)}<div class="source-row"><span>Solver status</span><div>${esc(r.solver.status)}</div></div><div class="source-row"><span>Candidate slots</span><div>${r.candidate_count} / ${state.scenario.slot_seconds}-second grid</div></div><div class="source-row"><span>Measured runtime</span><div>${nice(r.runtime_s*1000)} ms <span class="muted">(this run, not a benchmark)</span></div></div><div class="source-row"><span>Guarantee</span><div>${esc(r.solver.message)}</div></div></section><section class="instrument"><div class="validation-head"><strong>${pad(r.validation.violation_count)}</strong><div><h2>Constraint violations</h2><p>${r.validation.checks.length} checks on the published proposal.</p></div></div><ul class="validation-list">${r.validation.checks.map(name=>`<li>${icon('check')}<span>${esc(name[0].toUpperCase()+name.slice(1))}</span><span>CHECKED</span></li>`).join('')}</ul><div class="instrument-body"><p class="muted" style="font-size:var(--text-xs)">${esc(r.validation.scope)}</p></div></section></div><div class="notice neutral mt"><p><strong>Scheduled does not mean transmitted.</strong> These numbers describe a proposed plan. A valid plan may leave requests unserved, and this fixture may produce a tie between algorithms.</p></div><div class="section-title mt"><h2>Unserved requests</h2><span class="muted">${pad(r.unserved.length)} TO REVIEW</span></div>${r.unserved.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Request</th><th>Priority</th><th>Why it was not assigned</th><th></th></tr></thead><tbody>${r.unserved.map(c=>`<tr><td>${esc(c.request_id)}</td><td>${badge(request(c.request_id)?.priority||'routine')}</td><td style="white-space:normal;min-width:240px">${esc(c.reason)}</td><td><button class="button small" data-inspect="${esc(c.request_id)}">Inspect</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><h2>Every request has an assignment.</h2><p>The plan still requires review against real operational requirements.</p></div>'}`;
}
function dataPage() {
 const s=state.scenario,orbitReady=state.engine==='api'&&state.health?.skyfield_available;
 return `<input id="scenario-file" type="file" accept=".json,application/json" hidden><div class="two-column"><section class="config-panel"><div class="step-label">01 / INPUT PROVENANCE</div><h2>${esc(s.name)}</h2><p>Imported windows drive the schedule. The globe does not compute visibility or radio performance.</p><div class="source-row"><span>Input mode</span><div>${badge('emphasis',s.mode==='synthetic'?'Synthetic replay':'Orbit replay')}</div></div><div class="source-row"><span>Source</span><div>${esc(s.metadata?.provenance||'Operator-supplied scenario. Review the source separately.')}</div></div><div class="source-row"><span>Horizon · UTC</span><div>${day(s.start)} ${clock(s.start)} →<br>${day(s.end)} ${clock(s.end)}</div></div><div class="source-row"><span>Decision time</span><div>${day(s.decision_time)} / ${clock(s.decision_time)} UTC</div></div><div class="source-row"><span>Lead time</span><div>${s.booking_lead_s/60} minutes before a new reservation</div></div><div class="source-row"><span>Grid resolution</span><div>${s.slot_seconds} seconds</div></div><div class="source-row"><span>Window records</span><div>${s.windows.length} declared contact windows</div></div><div class="source-row"><span>Persistence</span><div>${state.storage?'Stored in this browser. Not synced or backed up.':'Browser storage unavailable. Export your scenario.'}</div></div><div class="form-actions">${action('planning-settings','Edit planning settings',{small:true})}${action('reset','Reset to test scenario',{small:true,iconName:'reset'})}</div></section><section class="instrument"><div class="instrument-head"><h2>Import / export</h2><span class="eyebrow push">JSON + CSV</span></div><div class="instrument-body"><h2>Keep a reproducible run.</h2><p class="muted" style="font-size:var(--text-sm);margin-top:var(--s-3)">The run report contains the exact calculation inputs, reference contacts, engine label and result. Edited inputs cannot be exported as a checked schedule.</p><div class="source-row"><span>Scenario JSON</span><div>${action('export-inputs','Export inputs',{small:true,iconName:'download'})}</div></div><div class="source-row"><span>Schedule CSV</span><div>${action('export-csv','Export proposal',{small:true,iconName:'download',disabled:state.dirty||!state.result})}</div></div><div class="source-row"><span>Full run JSON</span><div>${action('export-report','Export run report',{small:true,iconName:'download',disabled:state.dirty||!state.result})}</div></div><div class="source-row"><span>Restore inputs</span><div>${action('import-scenario','Import scenario',{small:true,iconName:'upload'})}</div></div><div class="source-row"><span>Test fixture</span><div>${action('download-demo','Download sample',{small:true,iconName:'download'})}</div></div></div></section></div><section class="instrument mt"><div class="instrument-head"><h2>Optional orbital-data adapter</h2><span class="badge push">${orbitReady?'AVAILABLE LOCALLY':'SEPARATE INTEGRATION'}</span></div><div class="instrument-body"><div class="two-column"><div><h2>Calculate windows from orbital elements.</h2><p class="muted" style="font-size:var(--text-sm);margin-top:var(--s-3)">This path requires the Python backend and Skyfield. The supplied ISS sample is historical, with a May 2024 epoch. It is not current satellite data.</p><div class="notice neutral mt"><p>${orbitReady?'Use a replay near the supplied epoch. The adapter creates synthetic requests and simulated station pairings.':'The frontend preview does not propagate orbits. Start the local backend and install requirements-orbits.txt to enable this adapter.'}</p></div>${action('load-orbits','Load historical sample',{small:true})}</div><form id="orbit-form"><div class="field"><label for="orbit-json">OMM records · JSON array</label><textarea id="orbit-json" name="records" spellcheck="false" placeholder='[{"OBJECT_NAME": "…", "EPOCH": "…"}]' required></textarea></div><label class="check-label mt"><input type="checkbox" id="orbit-ack" required><span>I understand that generated requests and station pairings are simulated.</span></label><div class="form-actions"><button class="button primary" type="submit" ${!orbitReady||state.busy?'disabled':''}>Calculate windows ${icon('arrow')}</button></div></form></div></div></section>`;
}
function activity() {
 return `<div class="notice neutral"><p>These timestamps record actions in this browser, not events on a spacecraft. The log is editable local storage, not a tamper-proof operational audit.</p></div><div class="section-title"><h2>Session history</h2><span class="muted">${state.log.length} RECORDS / LATEST FIRST</span></div>${state.log.length?state.log.map(entry=>`<article class="log-entry"><time datetime="${esc(entry.at)}">${day(entry.at,state.zone)}<br>${clock(entry.at,state.zone,true)} ${state.zone==='UTC'?'UTC':'IST'}</time><span class="eyebrow">${esc(entry.type)}</span><p>${esc(entry.message)}</p></article>`).join(''):'<div class="empty"><h2>No actions recorded.</h2><p>Build a schedule or edit the scenario to start the local record.</p></div>'}`;
}

function openDialog(title,body,{eyebrow='PASSRESCUE / WORKSPACE',drawer=false}={}) {
 const d=$('#dialog');d.className=drawer?'drawer':'';d.innerHTML=`<div class="dialog-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h2 id="dialog-title">${esc(title)}</h2></div><button class="button icon-only quiet" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}<div class="dialog-error" id="dialog-error" role="alert" hidden></div></div>`;
 if(!d.open)d.showModal();
}
function detail(label,value) {return `<div><span>${label}</span><strong>${value}</strong></div>`;}
function inspectRequest(id) {
 const q=request(id);if(!q)return;state.selected=id;
 if(state.route==='overview')render();
 const a=assignment(id),change=state.result?.changes.find(c=>c.request_id===id);
 openDialog(`${q.id} / ${q.label}`,`<div class="inline wrap">${badge(q.priority)}${badge(a?'scheduled':'unserved',state.result?(a?'Assigned':'Unserved'):'Not calculated')}${q.locked?badge('routine','LOCKED INPUT'):''}</div>${state.dirty?'<div class="notice mt"><p>Inputs changed. This assignment belongs to the previous calculation.</p></div>':''}<div class="detail-data">${detail('SATELLITE',esc(q.satellite_id))}${detail('TRANSMISSION TIME',`${minutes(q.duration_s)} min`)}${detail(`EARLIEST · ${state.zone==='UTC'?'UTC':'IST'}`,clock(q.earliest,state.zone,true))}${detail(`DEADLINE · ${state.zone==='UTC'?'UTC':'IST'}`,clock(q.deadline,state.zone,true))}${detail('ASSIGNED STATION',a?esc(a.station_id):'Not assigned')}${detail('WINDOW',a?esc(a.window_id):'—')}</div><h3>Why this decision?</h3><p style="margin-top:var(--s-3)">${esc(change?.reason||'Build a schedule to evaluate this request.')}</p>${a?`<div class="detail-data">${detail('RESERVATION START',clock(a.reserved_start,state.zone,true))}${detail('PAYLOAD START',clock(a.start,state.zone,true))}${detail('PAYLOAD END',clock(a.end,state.zone,true))}${detail('RESERVATION END',clock(a.reserved_end,state.zone,true))}</div>`:''}${change?.diagnostics?`<h3>Candidate checks</h3><div class="source-row"><span>Compatible windows</span><div>${change.diagnostics.compatible_windows}</div></div><div class="source-row"><span>Fitting windows</span><div>${change.diagnostics.fitting_windows}</div></div><div class="source-row"><span>Eligible grid slots</span><div>${change.diagnostics.candidate_count}</div></div>`:''}<div class="form-actions"><button class="button" data-action="edit-request" data-id="${esc(id)}">Edit request</button><button class="button primary" data-action="focus-request" data-id="${esc(id)}">Show on timeline ${icon('arrow')}</button></div>`,{drawer:true,eyebrow:'CONTACT INSPECTOR / PROPOSAL ONLY'});
}
function inspectStation(id) {
 const st=state.scenario.stations.find(s=>s.id===id);if(!st)return;
 const pairings=state.scenario.satellites.filter(s=>s.allowed_station_ids.includes(id));
 openDialog(st.name.split(' ·')[0],`<div class="inline">${badge('emphasis',id)}${badge('routine','SIMULATED')}</div><div class="detail-data">${detail('COORDINATES',fmtCoords(st.latitude,st.longitude))}${detail('ANTENNAS','01 / exclusive')}${detail('ACQUISITION',`${st.acquisition_s} s`)}${detail('TURNAROUND',`${st.turnaround_s} s`)}${detail('ELEVATION MASK',`${st.minimum_elevation_deg}°`)}${detail('ASSIGNED CONTACTS',String(state.result?.schedule.filter(a=>a.station_id===id).length||0))}</div><h3>Declared station pairings</h3><p style="margin-top:var(--s-3)">${pairings.map(s=>esc(s.id)).join(' · ')||'No satellites are approved for this station.'}</p><p class="muted mt">Coordinates place the station on the map. They do not establish access to a real facility or validate the hand-authored windows.</p><div class="form-actions"><button class="button" data-action="edit-station" data-id="${esc(id)}">Edit station</button><button class="button primary" data-action="station-outage" data-id="${esc(id)}">Test an outage ${icon('arrow')}</button></div>`,{drawer:true,eyebrow:'GROUND RESOURCE / SCENARIO INPUT'});
}
function inspectSatellite(id) {
 const sat=state.scenario.satellites.find(s=>s.id===id);if(!sat)return;
 const rs=state.scenario.requests.filter(r=>r.satellite_id===id);
 const first=rs.find(r=>assignment(r.id))||rs[0];if(first)state.selected=first.id;
 if(state.route==='overview')render();
 openDialog(`${sat.id} / ${sat.name}`,`${badge('routine',state.scenario.mode==='synthetic'?'FICTIONAL SATELLITE':'ORBIT REPLAY OBJECT')}<div class="detail-data">${detail('REQUESTS',pad(rs.length))}${detail('ASSIGNED',pad(rs.filter(r=>assignment(r.id)).length))}${detail('APPROVED STATIONS',sat.allowed_station_ids.map(esc).join(' / ')||'None')}${detail('SIMULTANEOUS LINKS','01 in this model')}</div><p>Satellite locations on the globe are schematic. They are not live positions and do not drive contact eligibility.</p><h3>Mission requests</h3>${rs.map(r=>`<button class="queue-item" data-inspect="${esc(r.id)}"><div class="queue-top"><strong>${esc(r.id)}</strong>${badge(r.priority)}</div><p>${esc(r.label)}</p><small>DEADLINE ${clock(r.deadline,state.zone,true)} ${state.zone==='UTC'?'UTC':'IST'}</small></button>`).join('')}`,{drawer:true,eyebrow:'SPACECRAFT INPUT / SINGLE-LINK MODEL'});
}
function requestForm(id) {
 if(id&&!state.scenario.requests.some(r=>r.id===id)){toast('This request was removed. Recalculate to refresh the proposal.');return;}
 const s=state.scenario,existing=id?request(id):null;
 const next=Math.max(0,...s.requests.map(r=>Number(r.id.match(/\d+$/)?.[0])||0))+1;
 const start=s.windows[0]?.start||s.start;
 const q=existing||{id:`R-${pad(next)}`,label:'',satellite_id:s.satellites[0].id,priority:'routine',duration_s:240,earliest:start,deadline:new Date(Math.min(t(s.end),t(start)+3600000)).toISOString(),locked:false};
 openDialog(existing?`Edit ${q.id}`:'Add a mission request',`<p>Define one indivisible transmission. Station preparation time is added separately. All editing times below are UTC.</p><form id="request-form" data-original="${esc(id||'')}"><div class="form-grid"><div class="field"><label for="request-id">Request ID</label><input id="request-id" name="id" value="${esc(q.id)}" maxlength="40" ${existing?'readonly':''} required></div><div class="field"><label for="request-satellite">Satellite</label><select id="request-satellite" name="satellite_id">${s.satellites.map(sat=>`<option value="${esc(sat.id)}" ${q.satellite_id===sat.id?'selected':''}>${esc(sat.id)} / ${esc(sat.name)}</option>`).join('')}</select></div><div class="field full"><label for="request-label">Payload description</label><input id="request-label" name="label" maxlength="120" value="${esc(q.label)}" placeholder="Thermal health packet" required></div><div class="field"><label for="request-priority">Priority</label><select id="request-priority" name="priority">${['critical','high','routine'].map(p=>`<option value="${p}" ${q.priority===p?'selected':''}>${p[0].toUpperCase()+p.slice(1)}</option>`).join('')}</select></div><div class="field"><label for="request-duration">Transmission duration · minutes</label><input id="request-duration" name="duration_min" type="number" min="0.5" max="120" step="0.5" value="${minutes(q.duration_s)}" required></div><div class="field"><label for="request-earliest">Earliest start · UTC</label><input id="request-earliest" name="earliest" type="datetime-local" value="${utcInput(q.earliest)}" required></div><div class="field"><label for="request-deadline">Deadline · UTC</label><input id="request-deadline" name="deadline" type="datetime-local" value="${utcInput(q.deadline)}" required></div><div class="field full"><label class="check-label"><input name="locked" type="checkbox" ${q.locked?'checked':''}><span>Protect an existing eligible contact for this request.</span></label></div></div><div class="form-actions">${existing?`<button class="button" type="button" data-action="delete-request" data-id="${esc(q.id)}">Delete request</button>`:''}<button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">Save request ${icon('check')}</button></div></form>`,{eyebrow:'MISSION INPUT / NOT A SPACECRAFT COMMAND'});
}
function stationForm(id) {
 const st=state.scenario.stations.find(st=>st.id===id);if(!st)return;
 openDialog(`Edit ${id}`,`<p>Coordinates change the map only. Existing declared contact windows are not automatically recalculated. All stations are simulated inputs.</p><form id="station-form" data-id="${esc(id)}"><div class="form-grid"><div class="field full"><label for="station-name">Display name</label><input id="station-name" name="name" value="${esc(st.name)}" maxlength="100" required></div><div class="field"><label for="station-lat">Latitude · degrees</label><input id="station-lat" name="latitude" type="number" min="-90" max="90" step="any" value="${st.latitude}" required></div><div class="field"><label for="station-lon">Longitude · degrees</label><input id="station-lon" name="longitude" type="number" min="-180" max="180" step="any" value="${st.longitude}" required></div><div class="field"><label for="station-acquisition">Acquisition · seconds</label><input id="station-acquisition" name="acquisition_s" type="number" min="0" max="900" step="1" value="${st.acquisition_s}" required></div><div class="field"><label for="station-turnaround">Turnaround · seconds</label><input id="station-turnaround" name="turnaround_s" type="number" min="0" max="900" step="1" value="${st.turnaround_s}" required></div><div class="field"><label for="station-mask">Elevation mask · degrees</label><input id="station-mask" name="minimum_elevation_deg" type="number" min="0" max="80" step="any" value="${st.minimum_elevation_deg}" required><small>Used only when orbital windows are recalculated.</small></div><div class="field"><label for="station-altitude">Altitude · metres</label><input id="station-altitude" name="altitude_m" type="number" min="-500" max="9000" step="any" value="${st.altitude_m||0}" required></div></div><div class="form-actions"><button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">Save station ${icon('check')}</button></div></form>`,{eyebrow:'GROUND RESOURCE / SCENARIO INPUT'});
}
function planningForm() {
 const s=state.scenario;
 openDialog('Planning settings',`<p>Lead time applies to new or moved reservations. An unchanged eligible reference booking is exempt from the new-booking cutoff.</p><form id="planning-form"><div class="form-grid"><div class="field full"><label for="scenario-name">Scenario name</label><input id="scenario-name" name="name" maxlength="100" value="${esc(s.name)}" required></div><div class="field full"><label for="decision-time">Decision time · UTC</label><input id="decision-time" name="decision_time" type="datetime-local" value="${utcInput(s.decision_time)}" required><small>This prototype cannot rewrite contacts that have already started.</small></div><div class="field"><label for="slot-size">Candidate grid · seconds</label><input id="slot-size" name="slot_seconds" type="number" min="10" max="120" step="1" value="${s.slot_seconds}" required></div><div class="field"><label for="lead-time">Booking lead time · seconds</label><input id="lead-time" name="booking_lead_s" type="number" min="0" max="7200" step="1" value="${s.booking_lead_s}" required></div></div><div class="form-actions"><button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">Save settings ${icon('check')}</button></div></form>`);
}
function guide(mapOnly=false) {
 if(mapOnly){openDialog('What the map represents',`<div class="guide-step"><h3>Ground stations are geographic.</h3><p>Their pins use the latitude and longitude in your scenario. Pin labels can be selected with a mouse or keyboard.</p></div><div class="guide-step"><h3>Satellite placement is illustrative.</h3><p>Vehicle symbols do not show live or propagated positions. Dashed lines illustrate approved pairings for the selected satellite. A solid line identifies the selected request’s assigned station; it is not a live RF link.</p></div><div class="guide-step"><h3>The map is not the scheduling engine.</h3><p>Only declared contact windows, resources and mission requirements determine scheduling eligibility. Drag the globe to rotate it, or focus it and use the arrow keys.</p></div><p class="muted mt">Coastlines: Natural Earth public-domain geographic data. No political boundaries are displayed.</p>`,{drawer:true,eyebrow:'DISPLAY MODEL / NOT A LIVE TRACKER'});return;}
 openDialog('A four-step working demo.',`<div class="guide-step"><h3>01 / Build the reference schedule.</h3><p>Open Contact planner. Build schedule saves an initial allocation from the current inputs. The included fixture uses fictional satellites and hand-authored windows.</p></div><div class="guide-step"><h3>02 / Take a station out of the plan.</h3><p>Open Recovery lab and load the test outage, or add your own station and time interval. The original contacts stay available as the comparison reference.</p></div><div class="guide-step"><h3>03 / Repair, then inspect.</h3><p>Select Repair schedule. Inspect recovered contacts, unchanged bookings and unserved requests. A correct failure is shown when the selected planner cannot allocate a request.</p></div><div class="guide-step"><h3>04 / Check and export.</h3><p>Evaluation lists the declared-constraint checks and the greedy comparison. Export a scenario, CSV proposal or a full reproducible run report.</p></div><div class="notice neutral mt"><p>${state.engine==='api'?'The server solves with Google OR-Tools CP-SAT. Optimality applies only when established on the declared grid.':'Browser preview uses a priority-aware greedy heuristic. It checks constraints but does not guarantee the best schedule.'}</p></div><p class="muted">One antenna per station, one link per satellite, one whole request per contact. No link budget, weather prediction, real station booking or spacecraft control is implemented. The optional orbital adapter needs separate verification.</p>`,{drawer:true,eyebrow:'QUICK START / MODEL BOUNDARIES'});
}
function confirmAction(title,message,actionName,id='') {
 openDialog(title,`<p>${esc(message)}</p><div class="form-actions"><button class="button" data-action="close-dialog">Cancel</button><button class="button primary" data-action="${actionName}" data-id="${esc(id)}">Confirm ${icon('arrow')}</button></div>`,{eyebrow:'REVIEW THIS CHANGE'});
}
function preset() {
 const recommended=state.scenario.metadata?.recommended_outage;
 if(!recommended){toast('This imported scenario has no prepared outage. Add one using the form.');nav('recovery');return;}
 const s=clone(state.scenario);s.outages=s.outages.filter(o=>o.id!=='OUT-PREPARED');s.outages.push({id:'OUT-PREPARED',...recommended});validateScenario(s);state.scenario=s;setDirty('Prepared station outage added.');nav('recovery');
}
function exportChecked(type) {
 if(!state.result||state.dirty)throw new Error('Recalculate before exporting a checked proposal. You can export edited scenario inputs separately.');
 if(type==='report')download('passrescue-run-report.json',{exported_at:new Date().toISOString(),engine:engineLabel(),run_input:state.runInput,result:state.result});
 else {
  const fields=['request_id','satellite_id','station_id','window_id','reserved_start','start','end','reserved_end'];
  const csvValue=v=>{let text=String(v??'');if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
  const csv=[fields.join(','),...state.result.schedule.map(a=>fields.map(f=>csvValue(a[f])).join(','))].join('\r\n');download('passrescue-proposed-contacts.csv',csv,'text/csv;charset=utf-8');
 }
 log('EXPORT',type==='report'?'Exported exact run inputs, reference contacts and results.':'Exported contact proposal CSV. No reservation was performed.');toast('Export created. This remains a proposal, not a booking.');
}

// Central event delegation: no inline event handlers and no page-specific globals.
document.addEventListener('click',async e=>{
 if(e.target.closest('.skip-link')){e.preventDefault();$('#main-content').focus();return;}
 if(e.target.closest('[data-nav]')){$('#sidebar').classList.remove('open');syncNavigation();}
 const inspect=e.target.closest('[data-inspect]');if(inspect){inspectRequest(inspect.dataset.inspect);return;}
 const button=e.target.closest('[data-action]');if(!button||button.disabled)return;
 const actionName=button.dataset.action,id=button.dataset.id;
 const readOnly=['menu','close-dialog','guide','map-guide','zoom-in','zoom-out','reset-map','inspect-satellite','focus-request'];
 if(state.busy&&!readOnly.includes(actionName))return;
 try{
 switch(actionName){
  case 'menu':{$('#sidebar').classList.toggle('open');syncNavigation();break;}
  case 'close-dialog':$('#dialog').close();break;
  case 'guide':guide();break;
  case 'map-guide':guide(true);break;
  case 'build':await compute('build');break;
  case 'repair':if(!state.reference.length)throw new Error('Build a reference schedule before running recovery.');await compute('repair');break;
  case 'preset':preset();break;
  case 'zoom-in':globe?.zoom(.1);break;
  case 'zoom-out':globe?.zoom(-.1);break;
  case 'reset-map':globe?.reset();break;
  case 'show-links':state.showLinks=true;render();break;
  case 'hide-links':state.showLinks=false;render();break;
  case 'focus-timeline':state.focus=true;render();break;
  case 'full-timeline':state.focus=false;render();break;
  case 'selected-plan':state.compareBaseline=false;render();break;
  case 'baseline-plan':state.compareBaseline=true;render();break;
  case 'clear-filters':state.requestQuery='';state.requestPriority='all';state.requestStatus='all';render();break;
  case 'add-request':requestForm();break;
  case 'edit-request':requestForm(id);break;
  case 'delete-request':confirmAction(`Delete ${id}?`,'This removes the request from the working scenario. The current result will be marked stale until you recalculate.','confirm-delete',id);break;
  case 'confirm-delete':state.scenario.requests=state.scenario.requests.filter(r=>r.id!==id);state.reference=state.reference.filter(a=>a.request_id!==id);$('#dialog').close();setDirty(`${id} removed.`);break;
  case 'edit-station':stationForm(id);break;
  case 'inspect-satellite':inspectSatellite(id);break;
  case 'station-outage':$('#dialog').close();nav('recovery');setTimeout(()=>{if($('#outage-station'))$('#outage-station').value=id;},30);break;
  case 'remove-outage':state.scenario.outages=state.scenario.outages.filter(o=>o.id!==id);setDirty('Station outage removed.');break;
  case 'focus-request':state.selected=id;$('#dialog').close();state.focus=true;nav('schedule');if(state.route==='schedule')render();break;
  case 'export-inputs':download('passrescue-scenario.json',state.scenario);log('EXPORT','Exported working scenario inputs.');toast('Scenario inputs exported.');break;
  case 'export-csv':exportChecked('csv');break;
  case 'export-report':exportChecked('report');break;
  case 'export-log':download('passrescue-browser-log.json',{scope:'Local browser activity, not a tamper-proof audit.',entries:state.log});toast('Browser activity log exported.');break;
  case 'download-demo':download('passrescue-sample-scenario.json',demo);toast('Synthetic sample exported.');break;
  case 'import-scenario':if(!$('#scenario-file')){const input=document.createElement('input');input.type='file';input.id='scenario-file';input.accept='.json,application/json';input.hidden=true;document.body.append(input);}$('#scenario-file').click();break;
  case 'planning-settings':planningForm();break;
  case 'reset':confirmAction('Reset the working scenario?','Your scenario edits will be replaced by the included test fixture. Export inputs first to retain them. The local run log is kept.','confirm-reset');break;
  case 'confirm-reset':$('#dialog').close();state.scenario=clone(demo);state.reference=[];state.result=null;state.selected=demo.requests[0]?.id;state.dirty=false;state.error='';log('RESET','Restored the included synthetic fixture.');await compute('build');break;
  case 'load-orbits':{const response=await fetch('./static/data/sample-orbits.json');if(!response.ok)throw new Error('Historical sample could not be read.');$('#orbit-json').value=JSON.stringify(await response.json(),null,2);toast('Historical May 2024 sample loaded. This is not live orbit data.');break;}
 }
 }catch(error){if($('#dialog').open){$('#dialog-error').textContent=error.message;$('#dialog-error').hidden=false;}else toast(error.message);}
});

document.addEventListener('input',e=>{if(e.target.id==='request-search'){state.requestQuery=e.target.value;render();}});
document.addEventListener('change',async e=>{
 const el=e.target;
 if(state.busy&&el.id!=='timezone')return;
 try{
  if(el.id==='timezone'){state.zone=el.value;save();render();}
  if(el.id==='priority-filter'){state.requestPriority=el.value;render();}
  if(el.id==='status-filter'){state.requestStatus=el.value;render();}
  if(el.id==='station-filter'){state.stationFilter=el.value;render();}
  if(el.dataset.pairSat){
   const s=clone(state.scenario),sat=s.satellites.find(sat=>sat.id===el.dataset.pairSat),station=el.dataset.pairStation;
   sat.allowed_station_ids=el.checked?[...new Set([...sat.allowed_station_ids,station])]:sat.allowed_station_ids.filter(id=>id!==station);
   validateScenario(s);state.scenario=s;setDirty(`${sat.id} / ${station} pairing ${el.checked?'enabled':'removed'}.`);
  }
  if(el.id==='scenario-file'&&el.files?.[0]){
   const file=el.files[0];if(file.size>2000000)throw new Error('Keep scenario JSON smaller than 2 MB.');
   const scenario=JSON.parse(await file.text());validateScenario(scenario);
   // Hold imported inputs until explicit confirmation; do not discard the current scenario.
   pendingImport=clone(scenario);el.value='';
   confirmAction('Load the imported scenario?',`${scenario.name}: ${scenario.requests.length} requests and ${scenario.stations.length} stations. This replaces the current working inputs and reference. Export current inputs first to retain them.`,'confirm-import');
  }
 }catch(error){toast(error.message);if(el.id==='scenario-file')el.value='';}
});
let pendingImport=null;
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-action="confirm-import"]');if(!button||!pendingImport||state.busy)return;
 state.scenario=pendingImport;pendingImport=null;state.reference=[];state.result=null;state.selected=state.scenario.requests[0]?.id||'';state.dirty=false;state.error='';$('#dialog').close();log('IMPORT',`Loaded scenario: ${state.scenario.name}.`);await compute('build');
});

document.addEventListener('submit',async e=>{
 const form=e.target,formId=form.getAttribute('id');if(!['request-form','station-form','outage-form','planning-form','orbit-form'].includes(formId))return;
 e.preventDefault();if(state.busy)return;
 const fd=new FormData(form);
 try{
  if(formId==='request-form'){
   const s=clone(state.scenario),q={id:String(fd.get('id')).trim(),label:String(fd.get('label')).trim(),satellite_id:fd.get('satellite_id'),priority:fd.get('priority'),duration_s:Number(fd.get('duration_min'))*60,earliest:fromInput(fd.get('earliest')),deadline:fromInput(fd.get('deadline')),locked:fd.has('locked')};
   if(form.dataset.original)s.requests=s.requests.map(r=>r.id===form.dataset.original?q:r);else s.requests.push(q);
   validateScenario(s);state.scenario=s;$('#dialog').close();setDirty(`${q.id} saved.`);
  }
  if(formId==='station-form'){
   const s=clone(state.scenario),st=s.stations.find(st=>st.id===form.dataset.id);st.name=String(fd.get('name')).trim();
   for(const field of ['latitude','longitude','acquisition_s','turnaround_s','minimum_elevation_deg','altitude_m'])st[field]=Number(fd.get(field));
   validateScenario(s);state.scenario=s;$('#dialog').close();setDirty(`${st.id} settings saved.`);
  }
  if(formId==='outage-form'){
   const s=clone(state.scenario);s.outages.push({id:`OUT-${Date.now().toString(36)}`,station_id:fd.get('station_id'),start:fromInput(fd.get('start')),end:fromInput(fd.get('end')),reason:String(fd.get('reason')).trim()});
   validateScenario(s);state.scenario=s;setDirty('Station outage added.');
  }
  if(formId==='planning-form'){
   const s=clone(state.scenario);s.name=String(fd.get('name')).trim();s.decision_time=fromInput(fd.get('decision_time'));s.slot_seconds=Number(fd.get('slot_seconds'));s.booking_lead_s=Number(fd.get('booking_lead_s'));
   validateScenario(s);state.scenario=s;$('#dialog').close();setDirty('Planning settings saved.');
  }
  if(formId==='orbit-form'){
   if(state.engine!=='api'||!state.health?.skyfield_available)throw new Error('The local Python backend and Skyfield are required.');
   const raw=String(fd.get('records'));if(raw.length>2000000)throw new Error('Orbital records exceed the 2 MB input limit.');
   const records=JSON.parse(raw);if(!Array.isArray(records)||!records.length||records.length>8)throw new Error('Provide 1–8 OMM records in a JSON array.');
   state.busy=true;form.querySelector('button[type="submit"]').disabled=true;
   const scenario=await api('/api/orbits',{records,stations:state.scenario.stations.slice(0,5),simulate_all_pairings:true,horizon_hours:24});
   validateScenario(scenario);state.busy=false;state.scenario=scenario;state.reference=[];state.result=null;state.selected=scenario.requests[0]?.id||'';log('ORBIT IMPORT','Calculated historical orbit replay windows; generated workload and pairings remain simulated.');await compute('build');
  }
 }catch(error){state.busy=false;if($('#dialog').open){$('#dialog-error').textContent=error.message;$('#dialog-error').hidden=false;}else{toast(error.message);if(formId==='orbit-form')form.querySelector('button[type="submit"]').disabled=false;}}
});
window.addEventListener('hashchange',()=>{
 const view=location.hash.replace(/^#\/?/,'').split('?')[0];state.route=routes[view]?view:'overview';
 $('#sidebar')?.classList.remove('open');syncNavigation();
 if($('#dialog').open)$('#dialog').close();render();window.scrollTo({top:0,behavior:'instant'});
});
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const b=e.target.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.target.close();}});

window.matchMedia('(max-width:800px)').addEventListener('change',syncNavigation);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#sidebar')?.classList.contains('open')){$('#sidebar').classList.remove('open');syncNavigation();document.querySelector('[aria-label="Toggle navigation"]')?.focus();}});

async function boot() {
 try{
  const [scenarioResponse,landResponse]=await Promise.all([fetch('./static/data/scenario.json'),fetch('./static/data/land.json')]);
  if(!scenarioResponse.ok||!landResponse.ok)throw new Error('The frontend data files could not be loaded. Serve the project over HTTP rather than opening index.html directly.');
  demo=await scenarioResponse.json();validateScenario(demo);state.scenario=clone(demo);state.land=await landResponse.json();
  try{
   const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');
   if(saved?.scenario){validateScenario(saved.scenario);state.scenario=saved.scenario;state.reference=Array.isArray(saved.reference)?saved.reference.slice(0,100).filter(a=>['request_id','satellite_id','station_id','window_id','reserved_start','start','end','reserved_end'].every(k=>typeof a[k]==='string')):[];state.zone=['UTC','Asia/Kolkata'].includes(saved.zone)?saved.zone:'UTC';state.log=Array.isArray(saved.log)?saved.log.filter(l=>typeof l.message==='string'&&typeof l.type==='string'&&Number.isFinite(t(l.at))).slice(0,100):[];}
  }catch{/* Invalid/inaccessible local storage does not prevent the included demo. */}
  state.selected=state.scenario.requests[0]?.id||'';
  if(CONFIG.mode!=='browser'){
   try{const health=await api('/api/health',undefined,45000);if(health.live_control!==false||!health.solver)throw new Error('This is not the expected PassRescue API.');state.engine='api';state.health=health;}
   catch(e){if(CONFIG.mode==='api')throw new Error(`Configured API is unavailable: ${e.message}`);state.engine='browser';}
  }
  state.route=routes[location.hash.replace(/^#\/?/,'')]?location.hash.replace(/^#\/?/,''):'overview';
  if(!location.hash)history.replaceState(null,'','#/overview');
  shell();log('SESSION OPEN',`${engineLabel()} selected. Replay data is not a live mission feed.`);render();
  await compute(state.reference.length?'repair':'build',true);
 }catch(e){$('#app').innerHTML=`<div class="boot"><div class="eyebrow">PASSRESCUE / STARTUP</div><h1>The workspace could not open.</h1><p>${esc(e.message)}</p><p class="mt">Run start_preview.bat for the browser prototype, or start_windows.bat for the local optimiser. Keep the terminal open.</p><button class="button mt" id="reload-app">Try again</button></div>`;$('#reload-app').addEventListener('click',()=>location.reload());}
}
boot();
