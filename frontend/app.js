"use strict";
const $ = (s, r = document) => r.querySelector(s);
const app = $("#app"), drawer = $("#drawer"), scrim = $("#scrim");
const TYPES = { essay: "Essay / report", short_answer: "Short answers", code: "Code", other: "Other" };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { id: null, data: null, filter: "all", started: false, timer: null, openSub: null };

async function api(url, opt) {
  let r;
  try { r = await fetch(url, opt); } catch { throw new Error("Cannot reach the server. Is it running?"); }
  if (!r.ok) {
    let m = r.statusText;
    try { const j = await r.json(); m = typeof j.detail === "string" ? j.detail : "Invalid input"; } catch {}
    throw new Error(m);
  }
  return r.json().catch(() => ({}));
}

function toast(text, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind; t.textContent = text;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), kind === "err" ? 8000 : 4500);
}

async function busy(btn, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Working…';
  try { return await fn(); } catch (e) { toast(e.message, "err"); } finally { btn.disabled = false; btn.innerHTML = old; }
}

/* ---------- routing ---------- */
window.addEventListener("hashchange", route);
function route() {
  clearInterval(state.timer); closeDrawer();
  const m = location.hash.match(/^#\/a\/(\d+)/);
  if (m) openAssignment(+m[1]); else home();
}

/* ---------- home ---------- */
async function home() {
  state.id = null;
  app.innerHTML = '<div class="empty"><span class="spin d"></span></div>';
  let list = [];
  try { list = await api("/api/assignments"); } catch (e) { app.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return; }
  app.innerHTML = `
  <h1>Mark a whole class in minutes</h1>
  <p class="sub">Upload submissions, let AI propose marks against your guideline, then review and finalize. You always make the final call.</p>
  <div class="grid">
    <form class="card" id="newForm">
      <h2>New assignment</h2>
      <label for="title">Title</label><input id="title" name="title" required maxlength="120" placeholder="e.g. Week 5 – Sorting algorithms">
      <label for="type">Type</label>
      <select id="type" name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <label for="tm">Total marks</label><input id="tm" name="total_marks" type="number" value="100" min="1" step="any" required>
      <label for="ins">Notes for the marker <span class="hint">(optional)</span></label>
      <textarea id="ins" name="instructions" rows="3" placeholder="e.g. Be strict on citations. Award partial marks for working."></textarea>
      <label>Marking guideline / answer sheet / sample answer <span class="hint">(optional)</span></label>
      <div class="drop sm" data-drop="refs"><b>Drop files or click</b>PDF, DOCX, TXT</div>
      <input id="refs" name="references" type="file" multiple hidden>
      <div class="files" id="refsList"></div>
      <div style="margin-top:18px"><button class="btn" id="createBtn">Create assignment</button></div>
    </form>
    <section class="card">
      <h2>Your assignments</h2>
      ${list.length ? list.map(a => `
        <a class="acard" href="#/a/${a.id}">
          <div class="row"><span class="t">${esc(a.title)}</span><span class="spacer"></span><span class="chip">${TYPES[a.type] || a.type}</span></div>
          <div class="chips"><span class="chip">${a.total_marks} marks</span><span class="chip">${a.n_submissions} submissions</span>
          <span class="chip ${a.n_final && a.n_final === a.n_submissions ? "on" : ""}">${a.n_final}/${a.n_submissions} finalized</span></div>
        </a>`).join("") : '<div class="empty">No assignments yet.<br>Create your first one on the left.</div>'}
    </section>
  </div>`;
}

/* ---------- assignment ---------- */
async function openAssignment(id) {
  state.id = id; state.filter = "all"; state.started = false; state.data = null;
  app.innerHTML = '<div class="empty"><span class="spin d"></span></div>';
  if (!(await load())) return;
  renderPage();
  state.timer = setInterval(poll, 2500);
}

async function load() {
  try { state.data = await api("/api/assignments/" + state.id); return true; }
  catch (e) { app.innerHTML = `<div class="notice err">${esc(e.message)} <a href="#/">Back</a></div>`; clearInterval(state.timer); return false; }
}

async function poll() {
  const ae = document.activeElement;
  if (ae && ae.closest("#rows")) return;         // don't clobber edits
  if (state.id == null || document.hidden) return;
  const prev = JSON.stringify(state.data);
  try { state.data = await api("/api/assignments/" + state.id); } catch { return; }
  if (JSON.stringify(state.data) !== prev) { renderDynamic(); if (state.openSub) refreshDrawerMeta(); }
}

function counts() {
  const S = state.data.submissions;
  const c = { total: S.length, marked: 0, pending: 0, marking: 0, error: 0, final: 0, attention: 0 };
  for (const s of S) {
    if (s.final) c.final++;
    if (s.status === "marked") { c.marked++; if (!s.final && s.confidence === "low") c.attention++; }
    else if (s.status === "error") { c.error++; c.attention++; }
    else if (s.status === "pending") c.pending++;
    else if (s.status === "marking") c.marking++;
  }
  return c;
}

function renderPage() {
  const { assignment: a } = state.data;
  app.innerHTML = `
  <a class="crumb" href="#/">← All assignments</a>
  <div class="row"><h1>${esc(a.title)}</h1></div>
  <div class="chips"><span class="chip">${TYPES[a.type] || a.type}</span><span class="chip">${a.total_marks} marks</span>
    <span class="chip ${a.has_reference ? "on" : ""}">${a.has_reference ? "Guideline attached" : "No guideline (AI infers criteria)"}</span></div>
  <div id="dyn"></div>`;
  renderDynamic();
}

function renderDynamic() {
  const { assignment: a, submissions: S } = state.data, c = counts();
  const inflight = c.marking > 0 || (state.started && c.pending > 0);
  if (!inflight) state.started = false;
  const step = !c.total ? 2 : (c.pending || c.marking) ? 3 : c.final === c.total ? 5 : 4;
  const st = (n, t, d) => `<div class="step ${step > n ? "done" : step === n ? "now" : ""}"><b>${n}. ${t}</b>${d}</div>`;
  const done = c.marked + c.error, pct = c.total ? Math.round(done / c.total * 100) : 0;
  const view = S.filter(s => state.filter === "all" ? true
    : state.filter === "attention" ? (s.status === "error" || (s.status === "marked" && !s.final && s.confidence === "low"))
    : state.filter === "final" ? s.final : (s.status === "marked" && !s.final));
  const keepFile = $("#up") ? $("#up").files : null;

  $("#dyn").innerHTML = `
  <div class="steps">${st(1, "Set up", "Assignment &amp; guideline")}${st(2, "Upload", "Student work")}${st(3, "AI marks", "Draft scores")}${st(4, "You review", "Edit &amp; approve")}</div>
  <div class="stats">
    <div class="stat"><div class="n">${c.total}</div><div class="l">Submissions</div></div>
    <div class="stat"><div class="n">${c.marked}</div><div class="l">AI-marked</div></div>
    <div class="stat ${c.attention ? "alert" : ""}"><div class="n">${c.attention}</div><div class="l">Need your attention</div></div>
    <div class="stat"><div class="n">${c.final}</div><div class="l">Finalized</div></div>
  </div>
  <div class="card">
    <div class="drop" data-drop="up"><b>Drop student files here, or click to browse</b>PDF, DOCX, code or text files — or one ZIP with everything</div>
    <input id="up" type="file" multiple hidden>
    <div class="files" id="upList"></div>
    <div class="row" style="margin-top:14px">
      <button class="btn ghost" data-act="upload" id="upBtn" disabled>Upload files</button>
      <button class="btn" data-act="mark" ${(c.pending + c.error) && !inflight ? "" : "disabled"}>
        ${inflight ? '<span class="spin"></span> Marking…' : `Mark ${c.pending + c.error ? c.pending + c.error + " submission" + (c.pending + c.error > 1 ? "s" : "") : "all"} with AI`}</button>
      <span class="spacer"></span>
      <button class="btn ok" data-act="finalizeAll" ${c.marked - c.final > 0 ? "" : "disabled"}>Approve all marked</button>
      <a class="btn ghost" href="/api/assignments/${a.id}/export.csv" ${c.total ? "" : 'aria-disabled="true"'}>Export CSV</a>
    </div>
    ${inflight ? `<div class="bar"><i style="width:${pct}%"></i></div><div class="files">${done} of ${c.total} done</div>` : ""}
  </div>
  <div class="card">
    <div class="row"><h2>Review</h2><span class="spacer"></span></div>
    <div class="tabs">${[["all", "All", c.total], ["attention", "Needs attention", c.attention], ["marked", "To approve", c.marked - c.final], ["final", "Finalized", c.final]]
      .map(([k, l, n]) => `<button class="tab ${state.filter === k ? "on" : ""}" data-filter="${k}">${l} (${n})</button>`).join("")}</div>
    ${view.length ? `<div class="tablewrap"><table><thead><tr><th>Student</th><th>Status</th><th>AI score</th><th>Confidence</th><th>Final score / ${a.total_marks}</th><th></th></tr></thead>
    <tbody id="rows">${view.map(s => rowHtml(s, a)).join("")}</tbody></table></div>`
      : `<div class="empty">${c.total ? "Nothing in this view." : "Upload student submissions to get started."}</div>`}
  </div>`;
  if (keepFile && keepFile.length) { $("#up").files = keepFile; showPicked("up"); }
}

function rowHtml(s, a) {
  const locked = s.status !== "marked" || s.final;
  const label = s.final ? "finalized" : s.status;
  return `<tr>
    <td><b>${esc(s.student)}</b><br><small>${esc(s.filename)}</small></td>
    <td><span class="badge ${s.final ? "b-final" : "b-" + s.status}">${label}</span>${s.error ? `<br><small>${esc(s.error)}</small>` : ""}</td>
    <td>${s.ai_score ?? "–"}</td>
    <td class="${s.confidence ? "c-" + s.confidence : ""}">${s.confidence || "–"}</td>
    <td><input class="score" type="number" min="0" max="${a.total_marks}" step="any" value="${s.score ?? ""}" ${locked ? "disabled" : ""} data-score="${s.id}" aria-label="Final score for ${esc(s.student)}"></td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn ghost sm" data-open="${s.id}">${s.status === "marked" ? "Review" : "View"}</button>
      ${s.status === "marked" ? `<button class="btn sm ${s.final ? "ghost" : "ok"}" data-approve="${s.id}" data-to="${!s.final}">${s.final ? "Reopen" : "Approve"}</button>` : ""}
    </td></tr>`;
}

/* ---------- drawer ---------- */
async function openDrawer(id) {
  state.openSub = id;
  drawer.hidden = scrim.hidden = false;
  drawer.innerHTML = '<div class="empty"><span class="spin d"></span></div>';
  try {
    const c = await api(`/api/submissions/${id}/content`);
    drawer.dataset.content = c.content;
    drawer.innerHTML = drawerHtml(c);
    drawer.focus?.();
  } catch (e) { toast(e.message, "err"); closeDrawer(); }
}
function closeDrawer() { state.openSub = null; drawer.hidden = scrim.hidden = true; drawer.innerHTML = ""; }

function drawerHtml(c) {
  const s = state.data.submissions.find(x => x.id === state.openSub), a = state.data.assignment;
  let cr = []; try { cr = JSON.parse(s.criteria_json || "[]"); } catch {}
  const locked = s.status !== "marked" || s.final;
  return `<div class="row"><h2>${esc(s.student)}</h2><span class="spacer"></span><button class="btn ghost sm" data-act="close">Close ✕</button></div>
  <div id="dmeta"></div>
  ${s.confidence === "low" ? '<div class="notice">AI confidence is low. Check this one carefully.</div>' : ""}
  ${s.status === "error" ? `<div class="notice err">${esc(s.error)}</div>` : ""}
  ${s.status === "marked" ? `
  <h3>AI breakdown</h3>
  ${cr.map(x => `<div class="crit"><b>${esc(x.name)}</b><span>${esc(x.score)} / ${esc(x.max)}</span><span class="cm">${esc(x.comment)}</span></div>`).join("") || '<div class="files">No breakdown.</div>'}
  <h3>Your decision</h3>
  <label for="dscore">Final score (AI suggested ${s.ai_score} / ${a.total_marks})</label>
  <input id="dscore" class="score" style="width:110px" type="number" min="0" max="${a.total_marks}" step="any" value="${s.score ?? ""}" ${locked ? "disabled" : ""} data-score="${s.id}">
  <label for="dfb">Feedback to student</label>
  <textarea id="dfb" rows="5" ${locked ? "disabled" : ""} data-fb="${s.id}">${esc(s.feedback)}</textarea>
  <div class="row" style="margin-top:12px"><button class="btn ${s.final ? "ghost" : "ok"}" data-approve="${s.id}" data-to="${!s.final}">${s.final ? "Reopen for editing" : "Approve mark"}</button></div>` : ""}
  <h3>Submission</h3><pre>${esc(c.content) || "(empty)"}</pre>`;
}
function refreshDrawerMeta() { /* drawer content is static while open; edits save on change */ }

/* ---------- actions ---------- */
function showPicked(id) {
  const f = $("#" + id).files;
  const target = id === "refs" ? $("#refsList") : $("#upList");
  if (target) target.textContent = f.length ? [...f].map(x => x.name).join(", ") : "";
  if (id === "up") $("#upBtn").disabled = !f.length;
}

async function save(id, body) {
  try { await api("/api/submissions/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch (e) { toast(e.message, "err"); }
  await load(); renderDynamic();
}

document.addEventListener("click", async e => {
  const t = e.target.closest("[data-drop],[data-act],[data-filter],[data-open],[data-approve]");
  if (e.target === scrim) return closeDrawer();
  if (!t) return;
  if (t.dataset.drop) return $("#" + t.dataset.drop).click();
  if (t.dataset.filter) { state.filter = t.dataset.filter; return renderDynamic(); }
  if (t.dataset.open) return openDrawer(+t.dataset.open);
  if (t.dataset.approve) {
    await save(+t.dataset.approve, { final: t.dataset.to === "true" });
    if (state.openSub) openDrawer(state.openSub);
    return;
  }
  const act = t.dataset.act;
  if (act === "close") return closeDrawer();
  if (act === "upload") return busy(t, async () => {
    const fd = new FormData(); [...$("#up").files].forEach(f => fd.append("files", f));
    const r = await api(`/api/assignments/${state.id}/submissions`, { method: "POST", body: fd });
    toast(`Added ${r.added} submission${r.added === 1 ? "" : "s"}.` + (r.problems.length ? ` ${r.problems.length} problem(s): ${r.problems.slice(0, 2).join("; ")}` : ""), r.problems.length ? "err" : "ok");
    $("#up").value = ""; await load(); renderDynamic();
  });
  if (act === "mark") return busy(t, async () => {
    await api(`/api/assignments/${state.id}/mark`, { method: "POST" });
    state.started = true; await load(); renderDynamic();
  });
  if (act === "finalizeAll") {
    const n = counts().marked - counts().final;
    if (!confirm(`Approve ${n} mark${n === 1 ? "" : "s"} with the scores currently shown? Low-confidence ones included.`)) return;
    return busy(t, async () => { await api(`/api/assignments/${state.id}/finalize`, { method: "POST" }); await load(); renderDynamic(); toast("Marks approved.", "ok"); });
  }
});

document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "refs" || t.id === "up") return showPicked(t.id);
  if (t.dataset.score) {
    const v = parseFloat(t.value);
    if (Number.isNaN(v)) return toast("Enter a number.", "err");
    save(+t.dataset.score, { score: v });
  }
  if (t.dataset.fb) save(+t.dataset.fb, { feedback: t.value });
});

document.addEventListener("dragover", e => { const d = e.target.closest("[data-drop]"); if (d) { e.preventDefault(); d.classList.add("over"); } });
document.addEventListener("dragleave", e => { const d = e.target.closest("[data-drop]"); if (d) d.classList.remove("over"); });
document.addEventListener("drop", e => {
  const d = e.target.closest("[data-drop]"); if (!d) return;
  e.preventDefault(); d.classList.remove("over");
  const inp = $("#" + d.dataset.drop); inp.files = e.dataTransfer.files; showPicked(inp.id);
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

document.addEventListener("submit", async e => {
  if (e.target.id !== "newForm") return;
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!$("#refs").files.length) fd.delete("references");
  await busy($("#createBtn"), async () => {
    const r = await api("/api/assignments", { method: "POST", body: fd });
    location.hash = "#/a/" + r.id;
  });
});

(async function init() {
  try {
    const h = await api("/api/health"), el = $("#llm");
    el.textContent = h.mock_llm ? "Demo mode: mock marker (no API key)" : "Model: " + h.model;
    el.classList.toggle("warn", h.mock_llm);
  } catch { $("#llm").textContent = "Server offline"; $("#llm").classList.add("warn"); }
  route();
})();
