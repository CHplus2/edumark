# EduMark

AI-assisted marking for lecturers. Create an assignment, optionally upload a marking guideline / answer sheet / sample answer, bulk-upload student submissions (including code), let an LLM propose marks and feedback, then review, edit and finalize. Export to CSV.

## Run
```bash
cp .env.example .env          # add LLM_API_KEY; without it a mock marker is used (good for offline demo)
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
# open http://localhost:8000
```
Run from the repository root. Data is stored in `data/edumark.db`.

## Design notes
- OpenAI-compatible LLM client: switch provider via `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`.
- Human-in-the-loop: AI scores are suggestions; lecturers edit and approve each one.
- Per-submission failures (unreadable PDF, rate limit, bad JSON) are isolated and retryable.
- Submissions are wrapped in tags and the prompt tells the model to ignore instructions inside them (prompt-injection mitigation).
- See `docs/decisions.md` and `docs/user-research.md`.
