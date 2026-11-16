import csv
import io
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from . import db, llm, marking  # noqa: E402
from .extract import expand_upload, extract_text  # noqa: E402

app = FastAPI(title="EduMark")
db.init()

ALLOWED_TYPES = {"essay", "short_answer", "code", "other"}


def rows(sql, args=()):
    with db.conn() as c:
        return [dict(r) for r in c.execute(sql, args)]


def get_assignment(aid: int):
    r = rows("SELECT * FROM assignments WHERE id=?", (aid,))
    if not r:
        raise HTTPException(404, "Assignment not found")
    return r[0]


@app.get("/api/health")
def health():
    return {"ok": True, "mock_llm": llm.is_mock(), "model": llm.MODEL() or None}


@app.get("/api/assignments")
def list_assignments():
    return rows("""SELECT a.id, a.title, a.type, a.total_marks, a.created_at,
                   (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id=a.id) AS n_submissions,
                   (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id=a.id AND s.status='marked') AS n_marked,
                   (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id=a.id AND s.final=1) AS n_final
                   FROM assignments a ORDER BY a.id DESC""")


@app.post("/api/assignments")
async def create_assignment(
    title: str = Form(...), type: str = Form("essay"), total_marks: float = Form(100),
    instructions: str = Form(""), references: List[UploadFile] = File(default=[]),
):
    if not title.strip():
        raise HTTPException(400, "Title is required")
    if type not in ALLOWED_TYPES:
        raise HTTPException(400, f"type must be one of {sorted(ALLOWED_TYPES)}")
    if total_marks <= 0:
        raise HTTPException(400, "total_marks must be > 0")
    ref_parts = []
    for f in references:
        if not f.filename:
            continue
        try:
            ref_parts.append(f"--- {f.filename} ---\n{extract_text(f.filename, await f.read())}")
        except ValueError as e:
            raise HTTPException(400, f"Reference file {f.filename}: {e}")
    with db.conn() as c:
        cur = c.execute(
            "INSERT INTO assignments(title,type,total_marks,instructions,reference_text) VALUES (?,?,?,?,?)",
            (title.strip(), type, total_marks, instructions, "\n\n".join(ref_parts)))
        return {"id": cur.lastrowid}


@app.get("/api/assignments/{aid}")
def assignment_detail(aid: int):
    a = get_assignment(aid)
    a["has_reference"] = bool(a.pop("reference_text"))
    subs = rows("SELECT id,student,filename,status,error,ai_score,ai_feedback,criteria_json,confidence,score,feedback,final "
                "FROM submissions WHERE assignment_id=? ORDER BY student", (aid,))
    return {"assignment": a, "submissions": subs}


@app.get("/api/submissions/{sid}/content")
def submission_content(sid: int):
    r = rows("SELECT student, content FROM submissions WHERE id=?", (sid,))
    if not r:
        raise HTTPException(404, "Submission not found")
    return r[0]


@app.post("/api/assignments/{aid}/submissions")
async def upload_submissions(aid: int, files: List[UploadFile] = File(...)):
    get_assignment(aid)
    added, problems = 0, []
    for f in files:
        data = await f.read()
        try:
            items = list(expand_upload(f.filename or "file", data))
        except ValueError as e:
            problems.append(str(e))
            continue
        for name, blob in items:
            student = Path(name).stem
            try:
                text = extract_text(name, blob)
                status, err = "pending", None
            except ValueError as e:
                text, status, err = "", "error", str(e)
                problems.append(f"{name}: {e}")
            with db.conn() as c:
                c.execute("INSERT INTO submissions(assignment_id,student,filename,content,status,error) VALUES (?,?,?,?,?,?)",
                          (aid, student, name, text, status, err))
            added += 1
    return {"added": added, "problems": problems}


@app.post("/api/assignments/{aid}/mark")
def start_marking(aid: int, bg: BackgroundTasks):
    get_assignment(aid)
    bg.add_task(marking.mark_assignment, aid)
    return {"started": True}


class SubmissionUpdate(BaseModel):
    score: Optional[float] = None
    feedback: Optional[str] = None
    final: Optional[bool] = None


@app.patch("/api/submissions/{sid}")
def update_submission(sid: int, u: SubmissionUpdate):
    r = rows("SELECT s.id, a.total_marks FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=?", (sid,))
    if not r:
        raise HTTPException(404, "Submission not found")
    if u.score is not None and not (0 <= u.score <= r[0]["total_marks"]):
        raise HTTPException(400, f"Score must be between 0 and {r[0]['total_marks']}")
    with db.conn() as c:
        if u.score is not None:
            c.execute("UPDATE submissions SET score=? WHERE id=?", (u.score, sid))
        if u.feedback is not None:
            c.execute("UPDATE submissions SET feedback=? WHERE id=?", (u.feedback, sid))
        if u.final is not None:
            c.execute("UPDATE submissions SET final=? WHERE id=?", (int(u.final), sid))
    return {"ok": True}


@app.post("/api/assignments/{aid}/finalize")
def finalize_all(aid: int):
    """Finalize every marked submission (lecturer's explicit 'approve all')."""
    with db.conn() as c:
        cur = c.execute("UPDATE submissions SET final=1 WHERE assignment_id=? AND status='marked'", (aid,))
    return {"finalized": cur.rowcount}


@app.get("/api/assignments/{aid}/export.csv")
def export_csv(aid: int):
    a = get_assignment(aid)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["student", "filename", "ai_score", "final_score", "total_marks", "finalized", "feedback"])
    for s in rows("SELECT * FROM submissions WHERE assignment_id=? ORDER BY student", (aid,)):
        w.writerow([s["student"], s["filename"], s["ai_score"], s["score"], a["total_marks"], bool(s["final"]), s["feedback"]])
    return Response(out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="edumark_{aid}.csv"'})


@app.get("/")
def index():
    return FileResponse(ROOT / "frontend" / "index.html")


app.mount("/static", StaticFiles(directory=ROOT / "frontend"), name="static")
