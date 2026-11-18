import { useEffect, useState } from "react";

const H = 86400, COL = { 1: "#d4f25a", 2: "#e3b341", 3: "#8fb8ff" }, PRI = { 1: "Critical", 2: "High", 3: "Routine" };
const B = import.meta.env.VITE_API_URL || "";
const api = (p, body) => fetch(B + "/api/" + p, body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());

export default function App() {
  const [S, setS] = useState(null), [tab, setTab] = useState("Mission Control"), [err, setErr] = useState("");
  const load = () => api("state").then(setS).catch(() => setErr("Cannot reach the backend. Start it with: uvicorn main:app --port 8000"));
  useEffect(() => { load(); }, []);
  if (err) return <main><div className="card bad">{err}</div></main>;
  if (!S) return <main><div className="card mut">Computing satellite passes…</div></main>;
  const t = s => new Date(Date.parse(S.t0) + s * 1000).toISOString().slice(11, 16) + "Z";
  const C = Object.values(S.C), crit = S.R.filter(q => q.pri === 1), critOk = crit.filter(q => S.C[q.id]).length;
  const P = { S, C, t, load };
  return (<>
    <header><b>PASSRESCUE</b><nav>{["Mission Control", "Contact Planner", "Ground Network", "Recovery Lab"].map(n =>
      <button key={n} className={tab === n ? "on" : ""} onClick={() => setTab(n)}>{n}</button>)}</nav></header>
    <main>
      {tab === "Mission Control" && <>
        <h1>MISSION CONTROL</h1>
        <div className="row">
          <div className="card"><h2>SCHEDULED CONTACTS</h2><div className="big">{C.length}</div><span className="mut">of {S.R.length} requests</span></div>
          <div className="card"><h2>CRITICAL SERVED</h2><div className="big">{critOk}/{crit.length}</div></div>
          <div className="card"><h2>UNSERVED</h2><div className="big">{S.un.length}</div></div>
          <div className="card"><h2>PLAN VS GREEDY BASELINE</h2><div className="big">{C.length} / {S.base}</div><span className="mut">CP-SAT · {S.info.status} · {S.info.ms} ms</span></div>
        </div>
        <div className="card"><h2>ANTENNA TIMELINE · 24 H FROM {t(0)}</h2><Timeline {...P} /></div>
        <div className="card"><h2>UNSERVED REQUESTS</h2>
          {S.un.length ? <table><tbody>{S.un.map(u => <tr key={u.id}><td>{u.id}</td><td>{S.sats[u.sat]}</td><td>{PRI[u.pri]}</td><td className="mut">{u.why}</td></tr>)}</tbody></table> : <span className="ok">All requests are scheduled.</span>}</div>
        <div className="card"><h2>ENGINE</h2><table><tbody>
          <tr><td>Scheduler</td><td>{S.engine.solver}</td></tr>
          <tr><td>Orbit propagation</td><td>{S.engine.orbit} · elements as of {S.engine.elements}</td></tr>
          <tr><td>Database</td><td>{S.engine.db}</td></tr></tbody></table></div>
      </>}
      {tab === "Contact Planner" && <>
        <h1>CONTACT PLANNER</h1>
        <div className="card"><Timeline {...P} /></div>
        <div className="card"><table><thead><tr><th>Request</th><th>Satellite</th><th>Station</th><th>Start</th><th>Duration</th><th>Priority</th></tr></thead>
          <tbody>{[...C].sort((a, b) => a.s - b.s).map(c => <tr key={c.id}><td>{c.id}</td><td>{S.sats[c.sat]}</td><td>{c.st}</td><td>{t(c.s)}</td><td>{c.d / 60} min</td><td style={{ color: COL[c.pri] }}>{PRI[c.pri]}</td></tr>)}</tbody></table></div>
        <div className="card"><h2>CONSTRAINT CHECKS</h2><Checks val={S.val} /></div>
      </>}
      {tab === "Ground Network" && <>
        <h1>GROUND NETWORK</h1>
        <div className="row">{Object.entries(S.stations).map(([n, s]) => {
          const mine = C.filter(c => c.st === n), use = Math.round(mine.reduce((a, c) => a + c.d, 0) / (H * s.ant) * 1000) / 10;
          return <div className="card" key={n}><h2>{n.toUpperCase()}</h2>
            <div className="mut">{s.lat.toFixed(2)}°, {s.lon.toFixed(2)}° · {s.ant} antenna{s.ant > 1 ? "s" : ""} · {s.bands.split("").join("/")}-band</div>
            <div className="big">{mine.length}</div><span className="mut">contacts · {use}% antenna utilisation</span>
            {S.out.filter(o => o.station === n).map((o, i) => <div key={i} className="bad">Outage {t(o.start)}–{t(o.end)} {o.reason}</div>)}</div>;
        })}</div>
      </>}
      {tab === "Recovery Lab" && <Recovery {...P} />}
    </main></>);
}

function Timeline({ S, C, t }) {
  const pc = s => (s / H * 100) + "%";
  return <div>{Object.keys(S.stations).map(n => <div key={n}>
    {Array.from({ length: S.stations[n].ant }, (_, a) => a).map(a => {
      const mine = C.filter(c => c.st === n).sort((x, y) => x.s - y.s), lanes = [];
      mine.forEach(c => { const i = lanes.findIndex(e => e <= c.s); i < 0 ? lanes.push(c.s + c.d) && (c.l = lanes.length - 1) : (lanes[i] = c.s + c.d, c.l = i); });
      return <div className="lane" key={a}><span className="mut">{n} A{a + 1}</span>
        <div className="track">{S.out.filter(o => o.station === n).map((o, i) => <div key={i} className="out" style={{ left: pc(o.start), width: pc(o.end - o.start) }} />)}
          {mine.filter(c => (c.l || 0) % S.stations[n].ant === a).map(c => <div key={c.id} className="bar" title={`${c.id} ${S.sats[c.sat]} ${t(c.s)}`}
            style={{ left: pc(c.s), width: pc(c.d), background: COL[c.pri] }}>{S.sats[c.sat]}</div>)}</div></div>;
    })}</div>)}
    <div className="axis">{[0, 6, 12, 18, 24].map(h => <span key={h}>+{h}h</span>)}</div></div>;
}

const Checks = ({ val }) => <table><tbody>{val.map(v => <tr key={v.name}><td>{v.name}</td><td className={v.ok ? "ok" : "bad"}>{v.ok ? "Pass" : "Fail"}</td></tr>)}</tbody></table>;

function Recovery({ S, t, load }) {
  const [f, setF] = useState({ station: Object.keys(S.stations)[0], off: 0.5, hrs: 3, reason: "Antenna fault" }), [r, setR] = useState(null), [busy, setBusy] = useState(false);
  const body = commit => ({ station: f.station, start: S.now + Math.round(f.off * 3600), end: S.now + Math.round((+f.off + +f.hrs) * 3600), reason: f.reason, commit });
  const run = async commit => { setBusy(true); const x = await api("recover", body(commit)); setR(commit ? null : x); setBusy(false); if (commit) load(); };
  const reset = async () => { await api("reset", {}); setR(null); load(); };
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return <>
    <h1>RECOVERY LAB</h1>
    <div className="card"><h2>DECLARE OUTAGE</h2>
      <div className="form">
        <label>Station<select value={f.station} onChange={set("station")}>{Object.keys(S.stations).map(n => <option key={n}>{n}</option>)}</select></label>
        <label>Starts in (h)<input type="number" step="0.5" min="0" value={f.off} onChange={set("off")} /></label>
        <label>Duration (h)<input type="number" step="0.5" min="0.5" value={f.hrs} onChange={set("hrs")} /></label>
        <label>Reason<input value={f.reason} onChange={set("reason")} /></label></div>
      <button className="btn" disabled={busy} onClick={() => run(false)}>{busy ? "Working…" : "Find recovery plan"}</button>
      <button className="btn alt" onClick={reset}>Clear all outages</button></div>
    {r && <>
      <div className="row">
        <div className="card"><h2>AFFECTED</h2><div className="big">{r.affected.length}</div></div>
        <div className="card"><h2>MOVED</h2><div className="big">{r.moved.length}</div></div>
        <div className="card"><h2>UNCHANGED</h2><div className="big">{r.unchanged.length}</div></div>
        <div className="card"><h2>NO ALTERNATIVE</h2><div className="big bad">{r.lost.length}</div></div></div>
      <div className="card"><h2>PROPOSED CHANGES · {r.info.status} · {r.info.ms} ms</h2>
        <table><tbody>
          {r.moved.map(i => <tr key={i}><td>{i}</td><td className="ok">Rescheduled</td><td>{r.C[i].st} at {t(r.C[i].s)}</td></tr>)}
          {r.gained.map(i => <tr key={i}><td>{i}</td><td className="ok">Newly scheduled</td><td>{r.C[i].st} at {t(r.C[i].s)}</td></tr>)}
          {r.lost.map(l => <tr key={l.id}><td>{l.id}</td><td className="bad">No alternative</td><td className="mut">{l.why}</td></tr>)}
        </tbody></table></div>
      <div className="card"><h2>CONSTRAINT CHECKS ON PROPOSAL</h2><Checks val={r.val} />
        <p><button className="btn" disabled={r.val.some(v => !v.ok)} onClick={() => run(true)}>Approve and apply</button></p></div></>}
  </>;
}
