# TCS Shipper Label Generator

A web application for generating shipper labels from PDF documents using OCR extraction.

## Project Structure

```
project-root/
├── artifacts/
│   └── frontend/          # React + Vite frontend
│       ├── src/
│       │   └── App.tsx    # Main UI (3-step flow)
│       ├── package.json
│       └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── api/routes/    # FastAPI route handlers
│   │   ├── services/      # PDF generation, Azure, OCR extraction
│   │   ├── models/        # Pydantic schemas
│   │   └── core/          # Configuration
│   ├── data/
│   │   ├── excel/         # Local fallback Excel templates
│   │   └── template_values.json  # Dropdown options & default values
│   ├── database/          # SQLite material master
│   ├── requirements.txt
│   └── start.sh
└── README.md
```

## Local Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- npm or pnpm

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/api/v1/docs`

### Frontend

```bash
cd artifacts/frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173` (or the port Vite assigns).

> The frontend proxies `/api/v1` to `http://localhost:8000` in development.
> See `artifacts/frontend/vite.config.ts` for proxy configuration.

---

## Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# Azure Blob Storage (required for uploads and remote Excel templates)
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_BLOB_CONTAINER_NAME=uploaded-files
AZURE_BLOB_TARGET_FOLDER=input

# Excel template folder inside the container (default: excel)
AZURE_EXCEL_FOLDER=excel

# Schema cache TTL in seconds (default: 300 = 5 minutes)
SCHEMA_CACHE_TTL_SECONDS=300
```

Without Azure credentials, the app falls back to local Excel files in `backend/data/excel/`.

---

## Dynamic Templates

Template field definitions are driven by Excel files:

**Azure path:** `{AZURE_BLOB_CONTAINER_NAME}/{AZURE_EXCEL_FOLDER}/{template_name}.xlsx`

**Local fallback:** `backend/data/excel/{template_name}.xlsx`

### Excel Format

| Column | Description |
|--------|-------------|
| `field_key` | Internal field identifier (e.g. `product_name`) |
| `label` | Display label shown in the UI |
| `field_type` | `text`, `date`, `number`, or `dropdown` |
| `placeholder` | Hint text / example value |
| `required` | `yes` / `no` |
| `readonly` | `yes` / `no` |
| `order` | Display order (integer) |

### Dropdown Options

Dropdown options come from `backend/data/template_values.json`.
Add a key matching the `field_key` with a list of options:

```json
{
  "storage_requirements": [
    "Store below 25°C",
    "Store between 2°C and 8°C"
  ]
}
```

Normal fields can also have a default value (non-list):

```json
{
  "distributed_by": "Distributed by:\nKenvue Brands LLC"
}
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/templates/list` | List available template names |
| GET | `/api/v1/templates/fields?template=xxx` | Get field definitions for a template |
| POST | `/api/v1/shipper/extract` | Extract data from PDFs (OCR) |
| POST | `/api/v1/shipper/generate` | Generate shipper label PDF |
| GET | `/api/v1/shipper/status/{id}` | Poll Azure upload status |
| GET | `/api/v1/shipper/download/{id}` | Download generated PDF |
| GET | `/api/v1/shipper/files` | List Azure blobs by date range |

---

## Git Ignore

See `.gitignore` at project root — excludes `node_modules/`, `venv/`, `__pycache__/`,
`.env`, `dist/`, generated PDFs, and temporary files.
