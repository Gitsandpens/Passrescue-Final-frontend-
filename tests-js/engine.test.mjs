import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makePlan,validateScenario,validateSchedule,contactErrors,overlap,sameContact} from '../static/js/engine.js';
const seed=JSON.parse(readFileSync(new URL('../static/data/scenario.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(seed);
const initial=makePlan(fixture());
const outage=()=>{const s=fixture();s.outages=[{id:'OUT-TEST',...s.metadata.recommended_outage}];return s;};
const shift=(value,sec)=>new Date(Date.parse(value)+sec*1000).toISOString();

test('fixture validates without mutation',()=>{const s=fixture();assert.equal(validateScenario(s),s);assert.deepEqual(s,seed);});
test('browser build schedules 18/20 and all three critical requests',()=>{assert.equal(initial.metrics.scheduled,18);assert.equal(initial.metrics.critical_scheduled,3);assert.equal(initial.validation.violation_count,0);});
test('browser engine never calls the heuristic optimal',()=>{assert.equal(initial.solver.status,'HEURISTIC');assert.equal(initial.solver.grid_optimal,false);assert.match(initial.solver.message,/no optimality guarantee/);});
test('baseline is honestly identical in browser mode',()=>assert.deepEqual(initial.schedule,initial.baseline_schedule));
test('outage recovery returns checked 17/20 plan, two recoveries, 13 preserved',()=>{const r=makePlan(outage(),initial.schedule);assert.equal(r.metrics.scheduled,17);assert.equal(r.metrics.critical_scheduled,2);assert.equal(r.recovery.affected,3);assert.equal(r.recovery.recovered,2);assert.equal(r.metrics.unchanged,13);assert.equal(r.validation.violation_count,0);});
test('unserved critical request is not hidden',()=>{const r=makePlan(outage(),initial.schedule);assert(r.unserved.some(c=>c.request_id==='R-06'));assert.equal(r.changes.find(c=>c.request_id==='R-06').after,null);});
test('inputs and reference remain unchanged',()=>{const s=outage(),before=structuredClone(s),ref=structuredClone(initial.schedule),copy=structuredClone(ref);makePlan(s,ref);assert.deepEqual(s,before);assert.deepEqual(ref,copy);});
test('same input produces identical contact choices',()=>assert.deepEqual(makePlan(fixture()).schedule,initial.schedule));
test('half-open intervals may touch',()=>assert.equal(overlap(1,2,2,3),false));
test('positive overlap is detected',()=>assert.equal(overlap(1,3,2,4),true));
test('same contact comparison normalises timestamp offsets',()=>{const a=initial.schedule[0],b=structuredClone(a);b.start=new Date(b.start).toISOString();assert(sameContact(a,b));assert(!sameContact(a,null));});
test('empty request list produces valid empty schedule',()=>{const s=fixture();s.requests=[];const r=makePlan(s);assert.equal(r.metrics.scheduled,0);assert(r.validation.valid);});
test('no windows leaves all requests unserved',()=>{const s=fixture();s.windows=[];const r=makePlan(s);assert.equal(r.schedule.length,0);assert.equal(r.unserved.length,20);});
test('unapproved station pairing remains unserved',()=>{const r=initial.unserved.find(c=>c.request_id==='R-09');assert(r);assert.match(r.reason,/No station pairing/);});
test('all stations unavailable produces empty valid proposal',()=>{const s=fixture();s.outages=s.stations.map(st=>({id:'OFF-'+st.id,station_id:st.id,start:s.start,end:s.end,reason:'Test'}));const r=makePlan(s);assert.equal(r.schedule.length,0);assert(r.validation.valid);});
test('a duration exceeding every window is not assigned',()=>{const s=fixture();s.requests[0].duration_s=7200;const r=makePlan(s);assert(!r.schedule.some(a=>a.request_id===s.requests[0].id));});
test('eligible locked booking stays unchanged in recovery',()=>{const r=makePlan(outage(),initial.schedule),a=initial.schedule.find(a=>a.request_id==='R-03');assert(a);assert(sameContact(a,r.schedule.find(a=>a.request_id==='R-03')));});
test('an invalid locked booking is released with explicit warning',()=>{const s=outage();s.requests.find(r=>r.id==='R-01').locked=true;const r=makePlan(s,initial.schedule);assert(r.warnings.some(w=>w.includes('R-01')&&w.includes('operator review')));});
test('already started reference contacts cannot be rewritten',()=>{const s=fixture();s.decision_time='2026-09-29T10:00:00Z';assert.throws(()=>makePlan(s,initial.schedule),/already begun/);});
test('independent validator catches duplicate assignments',()=>{const schedule=[...initial.schedule,structuredClone(initial.schedule[0])];assert(!validateSchedule(seed,schedule).valid);});
test('independent validator catches wrong payload duration',()=>{const a=structuredClone(initial.schedule[0]);a.end=shift(a.end,60);assert(contactErrors(seed,a).some(x=>x.includes('duration')));});
test('independent validator catches missing preparation buffer',()=>{const a=structuredClone(initial.schedule[0]);a.reserved_start=a.start;assert(contactErrors(seed,a).some(x=>x.includes('buffers')));});
test('independent validator catches unknown references',()=>{const a=structuredClone(initial.schedule[0]);a.window_id='UNKNOWN';assert(contactErrors(seed,a).some(x=>x.includes('Unknown')));});
test('independent validator detects outage intersection',()=>{const a=initial.schedule.find(a=>a.station_id==='GS-A');assert(contactErrors(outage(),a,initial.schedule).some(x=>x.includes('outage')));});
test('new bookings respect the lead time',()=>{const a=initial.schedule[0],s=fixture();s.decision_time=shift(a.reserved_start,-30);s.booking_lead_s=60;assert(contactErrors(s,a).some(x=>x.includes('lead time')));assert(!contactErrors(s,a,[a]).some(x=>x.includes('lead time')));});
test('validator catches removal of an eligible protected reference',()=>{const old=initial.schedule.find(a=>a.request_id==='R-03');assert(!validateSchedule(seed,initial.schedule.filter(a=>a!==old),initial.schedule).valid);});
for(const [name,edit,pattern] of [
 ['duplicate request ID',s=>s.requests[1].id=s.requests[0].id,/Duplicate/],
 ['naive timestamp',s=>s.start='2026-09-29T00:00:00',/timezone/],
 ['bad station reference',s=>s.windows[0].station_id='UNKNOWN',/unknown station/],
 ['bad satellite reference',s=>s.requests[0].satellite_id='UNKNOWN',/unknown satellite/],
 ['unapproved station ID in pairing',s=>s.satellites[0].allowed_station_ids=['UNKNOWN'],/pairing/],
 ['negative buffer',s=>s.stations[0].acquisition_s=-1,/Acquisition/],
 ['invalid latitude',s=>s.stations[0].latitude=100,/Latitude/],
 ['fractional grid',s=>s.slot_seconds=10.5,/whole number/],
 ['unknown priority',s=>s.requests[0].priority='urgent',/priority/],
 ['reversed deadline',s=>s.requests[0].deadline=s.requests[0].earliest,/end must follow/],
 ['unexpected top-level field',s=>s.admin=true,/Unexpected/],
 ['missing station list',s=>delete s.stations,/stations/],
 ['invalid lock',s=>s.requests[0].locked='yes',/lock/],
 ['too many requests',s=>s.requests=Array.from({length:101},(_,i)=>({...s.requests[0],id:'R'+i})),/requests/],
 ['horizon beyond two days',s=>s.end='2026-10-03T00:00:00Z',/horizon/]
])test(`rejects ${name}`,()=>{const s=fixture();edit(s);assert.throws(()=>validateScenario(s),pattern);});
test('candidate explosion is bounded and fails visibly',()=>{const s=fixture();s.stations=[s.stations[0]];s.satellites=[{...s.satellites[0],allowed_station_ids:['GS-A']}];s.windows=[{id:'LONG',satellite_id:'SAT-01',station_id:'GS-A',start:s.start,end:s.end}];s.slot_seconds=10;s.requests=Array.from({length:10},(_,i)=>({...s.requests[0],id:'LONG-'+i,earliest:s.start,deadline:s.end}));assert.throws(()=>makePlan(s),/12,000/);});
