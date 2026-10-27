# Inspection system backend

FastAPI backend starter based on `../user_story.md` and `../skill.md`.

## Run

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

Interactive API docs are available at `/docs` while the server is running.
The default CORS origin is `http://localhost:5173`; set `CORS_ORIGINS` to a comma-separated list of trusted frontend origins for deployment.

Provision an account after configuration with `python create_account.py <username> <role>`. Run this from the `backend` folder. To create an owner account, pass `--owner-id <id>` for an existing owner. Owners authenticate with their provisioned username and password; OTP is not used.

The admin-only AI requirements analysis page and the role-aware support chatbot use Gemini through its OpenAI-compatible API. The chatbot is available to all four authenticated roles. Set `GEMINI_API_KEY` and `GEMINI_MODEL` in `backend/.env`; the key stays on the backend and is never sent to the browser. AI responses are advisory and should be reviewed by the project team.

For local UI data, run `python seed_sample_data.py` from the `backend` folder. It is safe to rerun and creates two synthetic owners, two vehicles, one appointment, two inspection files, one item result, and three demo staff accounts if they do not exist. Demo credentials are `demo_admin`, `demo_intake`, or `demo_inspector` with password `DemoOnly123!` (or the value of `DEMO_PASSWORD` set before seeding). Change/remove these demo accounts before using a non-local environment. The sample appointment is dated two days from the date the seed script runs.

## Implemented foundation

- SQLite persistence and SQLAlchemy models for accounts/roles, owners, vehicles, appointments, inspection files, item results and certificates.
- Bearer access tokens and role checks.
- Owner, vehicle and appointment endpoints; inspection result recording; certificate creation guards and correction audit trail.
- Business checks grounded in the stories: appointment windows and one active appointment per vehicle; result aggregation; certificate issuance prerequisites.

## Contract and policy decisions

The source stories do not specify endpoint paths, payload schemas, database physical schema, password lifecycle, appointment capacity/calendar rules, status dictionary for Mi/Ma/DD, legal status source, fee collection integration, document storage, or SMS and external-service providers. This backend uses a conventional REST contract and explicit provisional data model to make the requested implementation usable. These choices must be reconciled with approved product/API decisions before production. Payment verification, legal status verification, AI/RAG, SMS delivery, external registry sync, equipment interfaces and reporting are not represented as successful integrations; they need their contracts and providers first. The inspection finalization endpoint relies on an inspector attesting checklist completeness because an authoritative, versioned item catalog was not included; production must connect that check to the approved checklist.

New accounts are provisioned administratively with an Argon2 password hash; no public signup endpoint is provided. Configure `JWT_SECRET` outside source control. SQLite tables are created on application startup for this initial implementation; use approved migrations before production.
