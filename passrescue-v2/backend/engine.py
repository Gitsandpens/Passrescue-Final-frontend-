import json, os, random, time, urllib.request
from datetime import datetime, timedelta, timezone
from skyfield.api import EarthSatellite, load, wgs84
from ortools.sat.python import cp_model

TS = load.timescale()
SATS = {25994: ("Terra", "X"), 27424: ("Aqua", "X"), 33591: ("NOAA-19", "S"), 37849: ("Suomi NPP", "X"),
        39084: ("Landsat 8", "X"), 49260: ("Landsat 9", "X"), 40697: ("Sentinel-2A", "X"), 42063: ("Sentinel-2B", "X")}
STATIONS = {"North Hub": dict(lat=78.2306, lon=15.3894, alt=458, ant=2, bands="XS"),
            "West Hub": dict(lat=64.8378, lon=-147.7164, alt=200, ant=1, bands="X"),
            "South Hub": dict(lat=-25.8903, lon=27.6866, alt=1400, ant=2, bands="XS")}
BUF, LEAD, MINEL, STEP = 120, 600, 5, 60   # prep buffer s, booking lead s, min elevation deg, greedy step s
WEIGHT = {1: 1000, 2: 300, 3: 100}          # priority 1 = critical
MOVE_COST = 40


def tles():
    f = os.path.join(os.path.dirname(__file__), "tles.json")
    if os.path.exists(f) and time.time() - os.path.getmtime(f) < 43200:
        return json.load(open(f))
    try:
        out = {}
        for n in SATS:
            u = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={n}&FORMAT=tle"
            out[str(n)] = urllib.request.urlopen(u, timeout=20).read().decode().strip().splitlines()[:3]
        json.dump(out, open(f, "w"))
        return out
    except Exception:
        if os.path.exists(f):
            return json.load(open(f))
        raise RuntimeError("Could not download orbital elements from CelesTrak and no cached copy exists.")


def passes(t0, hours, tl):
    ts0, ts1, H, P = TS.from_datetime(t0), TS.from_datetime(t0 + timedelta(hours=hours)), hours * 3600, []
    for n, (nm, band) in SATS.items():
        sat = EarthSatellite(tl[str(n)][1], tl[str(n)][2], nm, TS)
        for sn, s in STATIONS.items():
            if band not in s["bands"]:
                continue
            t, ev = sat.find_events(wgs84.latlon(s["lat"], s["lon"], s["alt"]), ts0, ts1, altitude_degrees=MINEL)
            st = 0 if len(ev) and ev[0] != 0 else None
            for ti, e in zip(t, ev):
                x = (ti.utc_datetime() - t0).total_seconds()
                if e == 0:
                    st = x
                elif e == 2 and st is not None:
                    if x - st >= 120:
                        P.append(dict(sat=n, st=sn, s=int(st), e=int(x)))
                    st = None
            if st is not None and H - st >= 120:
                P.append(dict(sat=n, st=sn, s=int(st), e=H))
    return P


def requests():
    r, R = random.Random(7), []
    for n in SATS:
        for _ in range(2):
            R.append(dict(id=f"REQ-{len(R)+1:03d}", sat=n, pri=r.choice([1, 1, 2, 3]), dur=r.choice([240, 360, 480, 600]),
                          earliest=r.randint(0, 4) * 1800, deadline=r.randint(8, 24) * 3600))
    return R


def clip(P, blocked):
    W = []
    for p in P:
        segs = [(p["s"], p["e"])]
        for st, bs, be in blocked:
            if st == p["st"]:
                segs = [(a, b) for s0, e0 in segs for a, b in ((s0, min(e0, bs)), (max(s0, be), e0)) if b - a > 0]
        W += [dict(p, s=a, e=b) for a, b in segs]
    return W


def solve(R, P, blocked=(), now=0, prior=None):
    prior, W, m = prior or {}, clip(P, blocked), cp_model.CpModel()
    O, cap, sat, obj = [], {k: [] for k in STATIONS}, {n: [] for n in SATS}, []
    for q in R:
        pc, d, lits = prior.get(q["id"]), q["dur"], []
        frozen = bool(pc) and pc["s"] < now + LEAD
        for w in W:
            if w["sat"] != q["sat"]:
                continue
            c = []
            if pc and pc["st"] == w["st"] and w["s"] + BUF <= pc["s"] and pc["s"] + d <= w["e"] - BUF and pc["s"] + d <= q["deadline"]:
                c.append((pc["s"], pc["s"], True))
            lo, hi = max(w["s"] + BUF, q["earliest"], now + LEAD), min(w["e"] - BUF - d, q["deadline"] - d)
            if not frozen and lo <= hi:
                c.append((lo, hi, False))
            for a, b, keep in c:
                x, s = m.NewBoolVar(""), m.NewIntVar(a, b, "")
                v = m.NewOptionalIntervalVar(s - BUF, d + 2 * BUF, s + d + BUF, x, "")
                cap[w["st"]].append(v); sat[q["sat"]].append(v); lits.append(x)
                obj.append(WEIGHT[q["pri"]] * x - (MOVE_COST * x if pc and not keep else 0))
                O.append((q, w, x, s, keep))
        m.AddAtMostOne(lits)
    for k, v in cap.items():
        m.AddCumulative(v, [1] * len(v), STATIONS[k]["ant"])
    for v in sat.values():
        m.AddNoOverlap(v)
    m.Maximize(sum(obj))
    sv = cp_model.CpSolver()
    sv.parameters.max_time_in_seconds, sv.parameters.num_workers = 8, min(4, os.cpu_count() or 1)
    stt = sv.Solve(m)
    C = {q["id"]: dict(id=q["id"], sat=q["sat"], st=w["st"], s=sv.Value(s), d=q["dur"], pri=q["pri"], kept=keep)
         for q, w, x, s, keep in O if sv.Value(x)}
    return C, dict(status=sv.StatusName(stt), ms=int(sv.WallTime() * 1000))


def greedy(R, P):
    busy, C = [], {}
    for q in sorted(R, key=lambda q: (q["deadline"], q["pri"])):
        d, done = q["dur"], False
        for w in sorted((w for w in P if w["sat"] == q["sat"]), key=lambda w: w["s"]):
            s = max(w["s"] + BUF, q["earliest"])
            while not done and s + d <= q["deadline"] and s + d + BUF <= w["e"]:
                a, b = s - BUF, s + d + BUF
                ov = [x for x in busy if x[2] < b and a < x[3]]
                if not any(x[0] == q["sat"] for x in ov) and sum(x[1] == w["st"] for x in ov) < STATIONS[w["st"]]["ant"]:
                    busy.append((q["sat"], w["st"], a, b))
                    C[q["id"]] = dict(id=q["id"], sat=q["sat"], st=w["st"], s=s, d=d, pri=q["pri"], kept=False)
                    done = True
                s += STEP
            if done:
                break
    return C


def reason(q, P, blocked=()):
    ok = [w for w in clip(P, blocked) if w["sat"] == q["sat"] and
          min(w["e"] - BUF - q["dur"], q["deadline"] - q["dur"]) >= max(w["s"] + BUF, q["earliest"])]
    return "Competing with higher-priority contacts" if ok else "No visibility window before the deadline"


def validate(R, P, C, blocked=(), now=0, prior=None):
    prior, Q, cs = prior or {}, {q["id"]: q for q in R}, list(C.values())
    ov = lambda a, b: a["s"] - BUF < b["s"] + b["d"] + BUF and b["s"] - BUF < a["s"] + a["d"] + BUF
    chk = [
        ("Request uniqueness", all(c["id"] in Q for c in cs)),
        ("Satellite–station compatibility", all(SATS[c["sat"]][1] in STATIONS[c["st"]]["bands"] for c in cs)),
        ("Visibility-window containment", all(any(w["sat"] == c["sat"] and w["st"] == c["st"] and w["s"] <= c["s"] and c["s"] + c["d"] <= w["e"] for w in P) for c in cs)),
        ("Required contact duration", all(c["d"] == Q[c["id"]]["dur"] for c in cs)),
        ("Preparation buffers", all(any(w["sat"] == c["sat"] and w["st"] == c["st"] and w["s"] + BUF <= c["s"] and c["s"] + c["d"] + BUF <= w["e"] for w in P) for c in cs)),
        ("Earliest start and deadline", all(Q[c["id"]]["earliest"] <= c["s"] and c["s"] + c["d"] <= Q[c["id"]]["deadline"] for c in cs)),
        ("Ground-station outages", all(not (c["st"] == st and c["s"] < be and bs < c["s"] + c["d"]) for c in cs for st, bs, be in blocked)),
        ("Antenna exclusivity", all(sum(o["st"] == c["st"] and ov(c, o) for o in cs) <= STATIONS[c["st"]]["ant"] for c in cs)),
        ("Satellite exclusivity", all(not (a["sat"] == b["sat"] and a["id"] != b["id"] and ov(a, b)) for a in cs for b in cs)),
        ("Booking lead time", all(c["kept"] or c["s"] >= now + LEAD for c in cs)),
        ("Protected existing contacts", all(C.get(i, {}).get("s") == p["s"] and C[i]["st"] == p["st"] for i, p in prior.items()
                                            if p["s"] < now + LEAD and not any(p["st"] == st and p["s"] < be and bs < p["s"] + p["d"] for st, bs, be in blocked))),
    ]
    return [dict(name=n, ok=bool(o)) for n, o in chk]


def build():
    t0 = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    P, R = passes(t0, 24, tles()), requests()
    C, info = solve(R, P)
    return dict(t0=t0.isoformat(), P=P, R=R, C=C, info=info, out=[])
