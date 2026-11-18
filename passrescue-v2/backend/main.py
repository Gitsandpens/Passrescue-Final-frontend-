import json, os
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ortools
from sqlalchemy import create_engine, text
import engine as E

url = os.getenv("DATABASE_URL", "sqlite:///passrescue.db")
if url.startswith("postgres://"):
    url = url.replace("postgres://", "postgresql://", 1)
db = create_engine(url)
with db.begin() as c:
    c.execute(text("create table if not exists store (k varchar(20) primary key, v text)"))

app = FastAPI(title="PassRescue")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("ALLOWED_ORIGIN", "*").split(","), allow_methods=["*"], allow_headers=["*"])


def get():
    with db.begin() as c:
        r = c.execute(text("select v from store where k='scn'")).first()
    return json.loads(r[0]) if r else None


def put(s):
    with db.begin() as c:
        c.execute(text("delete from store where k='scn'"))
        c.execute(text("insert into store (k, v) values ('scn', :v)"), dict(v=json.dumps(s)))


def scenario():
    s = get()
    if not s or now_s(s) > 12 * 3600:
        s = E.build()
        put(s)
    return s


def now_s(s):
    return int((datetime.now(timezone.utc) - datetime.fromisoformat(s["t0"])).total_seconds())


def blocked(s):
    return [(o["station"], o["start"], o["end"]) for o in s["out"]]


@app.on_event("startup")
def warm():
    scenario()


class Recover(BaseModel):
    station: str
    start: int
    end: int
    reason: str = ""
    commit: bool = False


def engine_info():
    f = os.path.join(os.path.dirname(E.__file__), "tles.json")
    d = datetime.fromtimestamp(os.path.getmtime(f), timezone.utc).strftime("%Y-%m-%d %H:%MZ") if os.path.exists(f) else "n/a"
    return dict(solver=f"Google OR-Tools CP-SAT {ortools.__version__}", orbit="Skyfield · SGP4", elements=d,
                db={"postgresql": "PostgreSQL", "sqlite": "SQLite"}.get(db.dialect.name, db.dialect.name))


@app.get("/api/state")
def state():
    s = scenario()
    b, n = blocked(s), now_s(s)
    Q = {q["id"]: q for q in s["R"]}
    un = [dict(id=q["id"], sat=q["sat"], pri=q["pri"], why=E.reason(q, s["P"], b)) for q in s["R"] if q["id"] not in s["C"]]
    return dict(s, now=n, un=un, base=len(E.greedy(s["R"], s["P"])), val=E.validate(s["R"], s["P"], s["C"], b, n),
                sats={k: v[0] for k, v in E.SATS.items()}, stations=E.STATIONS, engine=engine_info())


@app.post("/api/recover")
def recover(r: Recover):
    s = scenario()
    n, prior = now_s(s), s["C"]
    b = blocked(s) + [(r.station, r.start, r.end)]
    C, info = E.solve(s["R"], s["P"], b, n, prior)
    hit = [i for i, p in prior.items() if p["st"] == r.station and p["s"] < r.end and r.start < p["s"] + p["d"]]
    moved = [i for i in C if i in prior and (C[i]["st"], C[i]["s"]) != (prior[i]["st"], prior[i]["s"])]
    out = dict(
        affected=hit, moved=moved,
        unchanged=[i for i in C if i in prior and i not in moved],
        lost=[dict(id=i, why=E.reason(next(q for q in s["R"] if q["id"] == i), s["P"], b)) for i in prior if i not in C],
        gained=[i for i in C if i not in prior], C=C, info=info,
        val=E.validate(s["R"], s["P"], C, b, n, prior),
    )
    if r.commit:
        s["C"] = C
        s["out"].append(dict(station=r.station, start=r.start, end=r.end, reason=r.reason))
        put(s)
    return out


@app.post("/api/reset")
def reset():
    s = scenario()
    s["out"] = []
    s["C"], s["info"] = E.solve(s["R"], s["P"])
    put(s)
    return {"ok": True}
