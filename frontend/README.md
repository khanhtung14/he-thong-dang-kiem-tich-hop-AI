# Frontend

React + TypeScript + Vite interface for the current FastAPI backend.

## Start

```powershell
cd frontend
npm install
npm run dev
```

Start the API from `backend` with `uvicorn app.main:app --reload`. The UI defaults to `http://localhost:8000`; set `VITE_API_URL` in a frontend `.env` file to use a different API origin. The backend CORS default allows `http://localhost:5173`; configure `CORS_ORIGINS` in the backend environment for the deployed frontend origin.

An internal account must first be provisioned through the backend `create_account.py` command. Owner login is unavailable until the backend's OTP provider and verification flow are implemented. This UI only presents current API capabilities: dashboard counts are derived from list endpoints, not an official end-of-day report; no AI, billing, SMS, external registry or equipment screens are shown because those integrations are not available in the backend.

The current certificate form requires the authorized user to attest payment completion and legal eligibility. The backend does not verify those values with external systems; do not treat them as a substitute for verified integrations.
