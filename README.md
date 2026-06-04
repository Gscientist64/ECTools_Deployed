# ECEWS ToolsApp — Full Stack Package

This bundle contains:
- **Backend**: Flask + SQLAlchemy (in `ECEWS ToolsApp/`) with new JSON APIs under `/api/*`, CSV import/export, and CORS enabled.
- **Frontend**: React + Vite + Tailwind (in `frontend/`) with role-based screens, global toasts, form validation, and CSV import/export wired to the backend.

## Backend (Flask)
1. Create virtualenv and install requirements:
   ```bash
   cd "ECEWS ToolsApp"
   python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
2. Run the app:
   ```bash
   export FLASK_APP=app.py
   python app.py
   # App runs on http://localhost:5000
   ```

JSON endpoints added (examples):
- GET `/api/tools` — list tools (optional `?q=` search)
- POST `/api/tools` — create tool
- PUT `/api/tools/<id>` — update tool
- DELETE `/api/tools/<id>` — delete tool
- POST `/api/tools/<id>/checkout` — set status=in_use and assignee
- POST `/api/tools/<id>/checkin` — set status=available and assignee=""
- GET `/api/tools/export` — CSV export
- POST `/api/tools/import` — CSV import (form field name: `file`)
- GET `/api/categories`, GET `/api/users`

> Note: Auth is relaxed on API routes for local testing. Re-enable `@login_required` in `api.py` if desired.

## Frontend (React + Vite)
1. Install and run:
   ```bash
   cd frontend
   npm install
   cp .env.example .env   # adjust VITE_API_URL if backend isn't on http://localhost:5000
   npm run dev
   ```
2. Open http://localhost:5173

### Features
- Modern UI (sidebar + topbar + table) with Tailwind.
- **Role-based screens** (placeholders for Staff/Admin; wire to `/api/users` as needed).
- **Bulk CSV import/export** wired to backend `/api/tools/import` and `/api/tools/export`.
- **Global toasts** and **form validation** for required fields.
- **Check-in/out** actions hitting `/api/tools/<id>/checkin|checkout`.

## Notes
- If your existing DB schema lacks fields like `tag`, `serial`, `status`, `assignee`, `location`, the API safely ignores them.
- You can adapt the category mapping by ensuring `ToolCategory.name` matches one of: hand_tools, power_tools, safety, measuring, electrical (or expand the list in `frontend/src/tools.jsx`).
