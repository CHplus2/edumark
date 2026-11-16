# Decision log (for the "Ideation and decision-making" criterion)

Record every meaningful choice: options considered, what we picked, why, and any user feedback that changed it.

| Date | Decision | Options considered | Chosen & why | Trigger (research / feedback) |
|------|----------|--------------------|--------------|-------------------------------|
| 16 Nov | Human-in-the-loop marking | Auto-finalize vs lecturer review | Lecturer reviews every mark; AI only proposes | Trust/accountability |
| 16 Nov | Code marking | LLM read-only vs run tests in sandbox | LLM-only for MVP; sandbox = future work | Security risk, 3-person team time |
| 16 Nov | LLM provider | Gemini free / Groq free / cheap paid | OpenAI-compatible wrapper; compare models | TODO: fill in benchmark results |

## Model benchmark (TODO)
Mark 10-20 real submissions by hand, then compare each model's score. Record mean absolute error and % within 10% of total marks.
