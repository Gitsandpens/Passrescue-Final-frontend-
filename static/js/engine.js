/** Portable preview engine. This is a priority/deadline-first HEURISTIC, not MILP.
 * All input timestamps are absolute and timezone-aware. All intervals are [a,b).
 * The original Python optimiser remains the authoritative local backend.
 */
export const MAX_CANDIDATES = 12000;
const time = v => Date.parse(v);
const iso = v => new Date(v).toISOString();
const rank = {critical: 0, high: 1, routine: 2};
const utility = {critical: 0, high: 3, routine: 1};
export const overlap = (a, b, c, d) => a < d && c < b;
export const sameContact = (a,b) => !!a && !!b && ['request_id','satellite_id','station_id','window_id'].every(k=>a[k]===b[k]) && ['reserved_start','start','end','reserved_end'].every(k=>time(a[k])===time(b[k]));
const object = o => o && typeof o === 'object' && !Array.isArray(o);

export function validateScenario(s) {
  if (!object(s)) throw new Error('The scenario must be a JSON object.');
  const allowed = ['name','mode','start','end','decision_time','slot_seconds','booking_lead_s','stations','satellites','windows','requests','outages','metadata'];
  if (Object.keys(s).some(k=>!allowed.includes(k))) throw new Error('Unexpected scenario field. Import a scenario, not a run report.');
  const date = (v, label) => {if(typeof v!=='string'||!/(Z|[+-]\d{2}:\d{2})$/i.test(v)||!Number.isFinite(time(v))) throw new Error(`${label}: include a valid timestamp and timezone.`);};
  const number = (v,min,max,label) => {if(!Number.isFinite(v)||v<min||v>max) throw new Error(`${label} must be between ${min} and ${max}.`);};
  const integer = (v,min,max,label) => {number(v,min,max,label);if(!Number.isInteger(v))throw new Error(`${label} must be a whole number.`);};
  const text = (v,max,label) => {if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`${label} must contain 1–${max} characters.`);};
  text(s.name,100,'Scenario name');
  if(!['synthetic','orbit_replay'].includes(s.mode)) throw new Error('Unsupported scenario mode.');
  ['start','end','decision_time'].forEach(k=>date(s[k],k));
  number(time(s.end)-time(s.start),1,172800000,'Planning horizon (milliseconds)');
  if(time(s.decision_time)>time(s.end)) throw new Error('Decision time must not follow the horizon.');
  integer(s.slot_seconds,10,120,'Slot size');integer(s.booking_lead_s,0,7200,'Booking lead time');
  const limits={stations:[1,10],satellites:[1,30],windows:[0,3000],requests:[0,100],outages:[0,40]};
  for(const [key,[min,max]] of Object.entries(limits)) {
    if(!Array.isArray(s[key])||s[key].length<min||s[key].length>max)throw new Error(`${key}: expected ${min}–${max} items.`);
    const ids=new Set();
    for(const row of s[key]) {
      if(!object(row))throw new Error(`Invalid ${key} item.`);
      text(row.id, key==='windows'?80:key==='outages'?60:40,`${key} ID`);
      if(!['windows','outages'].includes(key)&&!/^[A-Za-z0-9_-]+$/.test(row.id))throw new Error('IDs may contain letters, numbers, underscores and hyphens only.');
      if(ids.has(row.id))throw new Error(`Duplicate ${key} ID: ${row.id}.`);ids.add(row.id);
    }
  }
  const stations=new Set(s.stations.map(o=>o.id)), sats=new Set(s.satellites.map(o=>o.id));
  for(const st of s.stations) {
    text(st.name,100,'Station name'); number(st.latitude,-90,90,'Latitude');number(st.longitude,-180,180,'Longitude');
    integer(st.acquisition_s,0,900,'Acquisition buffer');integer(st.turnaround_s,0,900,'Turnaround buffer');
    number(st.minimum_elevation_deg??10,0,80,'Elevation mask');number(st.altitude_m??0,-500,9000,'Altitude');
  }
  for(const sat of s.satellites) {
    text(sat.name,100,'Satellite name');
    if(!Array.isArray(sat.allowed_station_ids)||sat.allowed_station_ids.length>10||sat.allowed_station_ids.some(id=>!stations.has(id)))throw new Error(`Invalid station pairing for ${sat.id}.`);
  }
  for(const [key,a,b] of [['windows','start','end'],['requests','earliest','deadline'],['outages','start','end']]) {
    for(const row of s[key]) {
      date(row[a],`${row.id} ${a}`);date(row[b],`${row.id} ${b}`);
      if(time(row[b])<=time(row[a]))throw new Error(`${row.id}: end must follow start.`);
      if(key!=='outages'&&(time(row[a])<time(s.start)||time(row[b])>time(s.end)))throw new Error(`${row.id} lies outside the planning horizon.`);
      if(key!=='outages'&&!sats.has(row.satellite_id))throw new Error(`${row.id}: unknown satellite.`);
      if(key!=='requests'&&!stations.has(row.station_id))throw new Error(`${row.id}: unknown station.`);
      if(key==='requests') {
        text(row.label,120,'Request label');integer(row.duration_s,30,7200,'Request duration');
        if(!(row.priority in rank)||typeof row.locked!=='boolean')throw new Error(`${row.id}: invalid priority or lock.`);
      }
    }
  }
  return s;
}

/** Checks one candidate independently of enumeration. */
export function contactErrors(s,a,previous=[]) {
  const errors=[];
  const r=s.requests.find(r=>r.id===a.request_id), st=s.stations.find(st=>st.id===a.station_id);
  const sat=s.satellites.find(sat=>sat.id===a.satellite_id), w=s.windows.find(w=>w.id===a.window_id);
  if(!r||!st||!sat||!w)return ['Unknown request, satellite, station or window.'];
  const rs=time(a.reserved_start), start=time(a.start), end=time(a.end), re=time(a.reserved_end);
  if(![rs,start,end,re].every(Number.isFinite))return ['Invalid contact timestamp.'];
  if(r.satellite_id!==sat.id||w.satellite_id!==sat.id||w.station_id!==st.id)errors.push('Mismatched references.');
  if(!sat.allowed_station_ids.includes(st.id))errors.push('Satellite–station pairing is not approved.');
  if(rs<time(w.start)||re>time(w.end))errors.push('Reservation does not fit its visibility window.');
  if(end-start!==r.duration_s*1000)errors.push('Payload duration is incorrect.');
  if(start-rs!==st.acquisition_s*1000||re-end!==st.turnaround_s*1000)errors.push('Preparation buffers are incorrect.');
  if(start<time(r.earliest)||end>time(r.deadline))errors.push('Earliest start or deadline is violated.');
  if(s.outages.some(o=>o.station_id===st.id&&overlap(rs,re,time(o.start),time(o.end))))errors.push('Reservation overlaps a station outage.');
  if(rs<time(s.decision_time))errors.push('Contact already began before decision time.');
  if(!previous.some(p=>sameContact(p,a))&&rs<time(s.decision_time)+s.booking_lead_s*1000)errors.push('New-booking lead time is not met.');
  return errors;
}
const conflict = (a,b) => (a.station_id===b.station_id||a.satellite_id===b.satellite_id)&&overlap(time(a.reserved_start),time(a.reserved_end),time(b.reserved_start),time(b.reserved_end));
const checks=['request uniqueness','explicit compatibility','window containment','payload duration','preparation buffers','earliest start and deadline','station outages','antenna exclusivity','satellite exclusivity','booking lead time','eligible protected contacts'];
export function validateSchedule(s,schedule,previous=[]) {
  const errors=[], seen=new Set();
  for(const a of schedule) {
    if(seen.has(a.request_id))errors.push(`${a.request_id}: duplicate assignment.`);seen.add(a.request_id);
    contactErrors(s,a,previous).forEach(e=>errors.push(`${a.request_id}: ${e}`));
  }
  for(let i=0;i<schedule.length;i++)for(let j=i+1;j<schedule.length;j++)if(conflict(schedule[i],schedule[j]))errors.push(`${schedule[i].request_id} conflicts with ${schedule[j].request_id}.`);
  for(const a of previous) {
    const r=s.requests.find(r=>r.id===a.request_id);
    if(r&&(r.locked||time(a.reserved_start)<time(s.decision_time)+s.booking_lead_s*1000)&&!contactErrors(s,a,previous).length&&!schedule.some(b=>sameContact(a,b)))errors.push(`${a.request_id}: eligible protected contact changed.`);
  }
  return {valid:!errors.length,violation_count:errors.length,errors,checks,scope:'Checks declared scenario constraints only. Not a radio-link or flight-safety certification.'};
}
function metrics(s, schedule) {
  const rs=schedule.map(a=>s.requests.find(r=>r.id===a.request_id)).filter(Boolean);
  return {scheduled:rs.length, requested:s.requests.length, unserved:s.requests.length-rs.length,
    critical_scheduled:rs.filter(r=>r.priority==='critical').length,critical_requested:s.requests.filter(r=>r.priority==='critical').length,
    other_utility:rs.reduce((n,r)=>n+utility[r.priority],0),planned_payload_minutes:rs.reduce((n,r)=>n+r.duration_s,0)/60};
}

export function makePlan(s,previous=[]) {
  const began=performance.now();validateScenario(s);
  if(previous.some(a=>time(a.reserved_start)<time(s.decision_time)))throw new Error('A previous contact has already begun. Reset the reference plan or keep the original decision time.');
  const old=new Map(previous.map(a=>[a.request_id,a])), candidates=new Map(), diagnostics=new Map();
  const protectedContacts=[], warnings=[];let candidateCount=0;
  for(const a of previous) {
    const r=s.requests.find(r=>r.id===a.request_id);if(!r)continue;
    if(r.locked||time(a.reserved_start)<time(s.decision_time)+s.booking_lead_s*1000) {
      if(!contactErrors(s,a,previous).length)protectedContacts.push(a);
      else warnings.push(`${a.request_id}: protected contact is no longer eligible. Its lock is released only in this proposal; operator review is required.`);
    }
  }
  for(const r of s.requests) {
    const sat=s.satellites.find(sat=>sat.id===r.satellite_id);
    const options=[], diag={compatible_windows:0,fitting_windows:0,lead_time_rejections:0,outage_rejections:0,candidate_count:0,reason:''};
    const prior=old.get(r.id);
    if(prior&&!contactErrors(s,prior,previous).length)options.push(prior);
    for(const w of s.windows) {
      if(w.satellite_id!==r.satellite_id||!sat.allowed_station_ids.includes(w.station_id))continue;
      diag.compatible_windows++;
      const st=s.stations.find(st=>st.id===w.station_id), prep=st.acquisition_s*1000, after=st.turnaround_s*1000,duration=r.duration_s*1000, grid=s.slot_seconds*1000;
      const first=Math.max(time(w.start),time(r.earliest)-prep,time(s.start));
      const last=Math.min(time(w.end)-prep-duration-after,time(r.deadline)-prep-duration);
      if(last<first)continue;diag.fitting_windows++;
      for(let rs=Math.ceil((first-time(s.start))/grid)*grid+time(s.start);rs<=last;rs+=grid) {
        const a={request_id:r.id,satellite_id:r.satellite_id,station_id:w.station_id,window_id:w.id,reserved_start:iso(rs),start:iso(rs+prep),end:iso(rs+prep+duration),reserved_end:iso(rs+prep+duration+after)};
        if(options.some(p=>sameContact(p,a)))continue;
        const es=contactErrors(s,a,previous);
        if(es.some(e=>e.includes('lead time')||e.includes('already began')))diag.lead_time_rejections++;
        else if(es.some(e=>e.includes('outage')))diag.outage_rejections++;
        if(es.length)continue;
        options.push(a);if(++candidateCount>MAX_CANDIDATES)throw new Error('This scenario creates over 12,000 candidate slots. Shorten the horizon or increase the slot size.');
      }
    }
    options.sort((a,b)=>Number(sameContact(b,prior))-Number(sameContact(a,prior))||time(a.start)-time(b.start)||a.station_id.localeCompare(b.station_id));
    diag.candidate_count=options.length;
    diag.reason=!sat.allowed_station_ids.length?'No station pairing is approved for this satellite.':!diag.compatible_windows?'No compatible contact window is present.':!diag.fitting_windows?'No window fits the duration, buffers and deadline.':!options.length?'All remaining candidate slots are blocked by outages or booking lead time.':'Eligible options exist but compete with other requests under this heuristic. A different solver may find another arrangement.';
    candidates.set(r.id,options);diagnostics.set(r.id,diag);
  }
  const schedule=[...protectedContacts];
  // Protected contacts can predate the new-booking cutoff; validate them with reference.
  if(schedule.some((a,i)=>schedule.slice(i+1).some(b=>conflict(a,b))))throw new Error('The reference contains conflicting protected contacts. Reset the reference before planning.');
  const queue=[...s.requests].sort((a,b)=>rank[a.priority]-rank[b.priority]||time(a.deadline)-time(b.deadline)||a.id.localeCompare(b.id));
  for(const r of queue) {
    if(schedule.some(a=>a.request_id===r.id))continue;
    const chosen=candidates.get(r.id).find(a=>!schedule.some(b=>conflict(a,b)));
    if(chosen)schedule.push(chosen);
  }
  schedule.sort((a,b)=>time(a.start)-time(b.start)||a.station_id.localeCompare(b.station_id));
  const validation=validateSchedule(s,schedule,previous);
  if(!validation.valid)throw new Error(`Schedule failed validation: ${validation.errors[0]}`);
  const affected=new Set(previous.filter(a=>contactErrors(s,a,previous).length).map(a=>a.request_id));
  const changes=s.requests.map(r=>{
    const before=old.get(r.id)||null,after=schedule.find(a=>a.request_id===r.id)||null;
    const status=after?(before?(sameContact(before,after)?'unchanged':affected.has(r.id)?'recovered':'moved'):'scheduled'):'unserved';
    const reasons={unchanged:'The original contact is eligible and has been kept unchanged.',recovered:'The original contact is no longer eligible. This replacement meets the declared pairing, window, deadline and reservation rules.',moved:'Moved to another eligible slot in the selected plan. All declared constraints are checked.',scheduled:'Fits an approved window, both preparation buffers and the deadline without a resource conflict.',unserved:diagnostics.get(r.id).reason};
    return {request_id:r.id,status,reason:reasons[status],before,after,protected:protectedContacts.some(a=>a.request_id===r.id),diagnostics:diagnostics.get(r.id)};
  });
  const m={...metrics(s,schedule),unchanged:changes.filter(c=>c.status==='unchanged').length};
  return {schedule,baseline_schedule:structuredClone(schedule),metrics:m,baseline_metrics:{...m},baseline_validation:validation,validation,
    solver:{status:'HEURISTIC',grid_optimal:false,stages:[],runtime_s:(performance.now()-began)/1000,message:'Priority-aware earliest-deadline-first browser heuristic. Feasible under declared constraints; no optimality guarantee.'},
    changes,unserved:changes.filter(c=>!c.after),warnings,candidate_count:[...candidates.values()].reduce((n,a)=>n+a.length,0),
    recovery:{is_recovery:previous.length>0,affected:affected.size,recovered:changes.filter(c=>c.status==='recovered').length,moved_unaffected:changes.filter(c=>c.status==='moved').length,unrepaired_metrics:metrics(s,previous.filter(a=>!contactErrors(s,a,previous).length))},
    objectives:['Critical requests first','Then priority and earliest deadline','Prefer an unchanged eligible contact within that order'],runtime_s:(performance.now()-began)/1000,
    notice:'Proposed schedule only. No antenna booking, spacecraft command or data transfer. Browser mode uses the baseline itself; equality is expected.'};
}
