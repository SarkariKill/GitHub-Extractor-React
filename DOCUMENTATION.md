# TCS Shipper Label Generator — Complete Documentation

> **For new joiners:** Read this top to bottom. By the end you will know exactly what every file does, how each piece connects, and how to make changes confidently.

---

## Table of Contents

1. [What This App Does](#1-what-this-app-does)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Local Development Setup (VS Code)](#4-local-development-setup-vs-code)
5. [Architecture — How Everything Connects](#5-architecture--how-everything-connects)
6. [Backend Deep Dive](#6-backend-deep-dive)
7. [Frontend Deep Dive](#7-frontend-deep-dive)
8. [Data Flow — Step by Step](#8-data-flow--step-by-step)
9. [Azure Blob Storage Layout](#9-azure-blob-storage-layout)
10. [Configuration Reference](#10-configuration-reference)
11. [API Reference](#11-api-reference)
12. [How to Make Common Changes](#12-how-to-make-common-changes)

---

## 1. What This App Does

The TCS Shipper Label Generator is an internal web tool that automates the creation of shipper label PDFs for pharmaceutical/consumer products.

**The 3-step user journey:**

```
Step 1 — Upload PDFs          Step 2 — Review & Fill         Step 3 — Generate
──────────────────────        ──────────────────────         ──────────────────
User picks a template    →    App auto-fills a form      →   App generates a PDF
and uploads two PDFs          from the PDFs + database       and saves it to Azure
(Master Formula PDF +         User fixes any gaps            User can download it
Storage & Shipping PDF)
```

**Before this tool existed**, someone had to manually read two PDFs, cross-reference a material database, and hand-type all values into a shipper label document. This app automates all of that.

---

## 2. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Backend framework** | FastAPI (Python) | REST API server |
| **Backend server** | Uvicorn | ASGI server that runs FastAPI |
| **Data validation** | Pydantic v2 | Validates all request/response data |
| **PDF reading** | pdfplumber | Extracts text and tables from uploaded PDFs |
| **PDF creation** | ReportLab | Draws and renders the output shipper label PDF |
| **Excel reading** | openpyxl | Reads `.xlsx` template definition files |
| **Local database** | SQLite | Stores material master data (GTIN, product name, etc.) |
| **Cloud storage** | Azure Blob Storage | Stores Excel templates, config, and generated PDFs |
| **Frontend framework** | React 19 + TypeScript | The browser UI |
| **Frontend build tool** | Vite 7 | Dev server + production bundler |
| **Styling** | Tailwind CSS v4 | Utility-first CSS styling |
| **Monorepo manager** | pnpm workspaces | Manages all packages in one repo |
| **Toast notifications** | Sonner | User-facing success/error popups |
| **Icons** | Lucide React | All icons in the UI |

---

## 3. Project Structure

```
GitHub-Extractor/                  ← project root (monorepo)
│
├── backend/                       ← Python FastAPI application
│   ├── start.sh                   ← script that starts the backend server
│   ├── requirements.txt           ← all Python dependencies
│   ├── app/
│   │   ├── main.py                ← FastAPI app entry point, mounts all routes
│   │   ├── core/
│   │   │   └── config.py          ← all configuration (reads .env file)
│   │   ├── models/
│   │   │   └── schemas.py         ← Pydantic models for request/response data
│   │   ├── api/
│   │   │   └── routes/
│   │   │       ├── health.py      ← GET /api/v1/health (liveness check)
│   │   │       ├── shipper.py     ← main endpoints: extract, generate, download
│   │   │       └── template_schema.py ← endpoints: list templates, get fields
│   │   └── services/
│   │       ├── extractor.py       ← reads text/tables from uploaded PDFs
│   │       ├── pdf_generator_dynamic.py ← creates the shipper label PDF
│   │       ├── excel_schema.py    ← reads Excel files to build the UI form
│   │       ├── database.py        ← looks up materials in SQLite
│   │       ├── azure_storage.py   ← uploads/lists PDFs in Azure Blob Storage
│   │       └── validation.py      ← checks which required fields are missing
│   ├── data/
│   │   ├── excel/                 ← local fallback Excel template files
│   │   └── template_values.json  ← dropdown options + default values
│   └── database/
│       └── material_master.db    ← SQLite database with material master data
│
├── artifacts/
│   ├── frontend/                  ← React + Vite frontend app
│   │   ├── vite.config.ts         ← Vite config (dev server, proxy, plugins)
│   │   ├── index.html             ← HTML entry point
│   │   └── src/
│   │       ├── main.tsx           ← React app bootstrap
│   │       ├── App.tsx            ← entire UI logic (all 3 steps)
│   │       ├── index.css          ← global CSS + Tailwind imports
│   │       └── components/        ← shared UI component library (shadcn/ui)
│   │
│   └── api-server/                ← Express.js proxy (used on Replit only)
│       └── src/
│           ├── app.ts             ← Express app + proxy middleware
│           └── index.ts           ← server bootstrap
│
├── lib/                           ← shared libraries (auto-generated code)
├── pnpm-workspace.yaml            ← monorepo package config
├── README.md                      ← quick project overview
└── DOCUMENTATION.md               ← this file
```

---

## 4. Local Development Setup (VS Code)

### Prerequisites

Install these before anything else:

| Tool | Version | How to get it |
|------|---------|--------------|
| Node.js | 20 or higher | https://nodejs.org |
| pnpm | latest | After Node: `npm install -g pnpm` |
| Python | 3.11 | https://python.org/downloads |

Verify everything installed correctly:
```bash
node --version      # should print v20.x.x or higher
pnpm --version      # should print 11.x.x or similar
python --version    # should print Python 3.11.x
```

---

### Step 1 — Get the code

Download the zip from Replit (three-dot menu → Download as zip), extract it, and open the folder in VS Code.

---

### Step 2 — Create the backend secrets file

Inside the `backend/` folder, create a file called **`.env`** (note the leading dot):

```
AZURE_STORAGE_CONNECTION_STRING=your_actual_azure_connection_string_here
AZURE_BLOB_CONTAINER_NAME=uploaded-files
AZURE_BLOB_TARGET_FOLDER=input
```

- `AZURE_STORAGE_CONNECTION_STRING` — get this from your Azure portal → Storage Account → Access Keys
- `AZURE_BLOB_CONTAINER_NAME` — the container where all files live (default: `uploaded-files`)
- `AZURE_BLOB_TARGET_FOLDER` — internal config, leave as `input`

> **Note:** Without the Azure connection string the app still runs. Templates will fall back to local Excel files in `backend/data/excel/` and generated PDFs won't be uploaded to the cloud.

---

### Step 3 — Install Python dependencies

Open a terminal in VS Code and run:

```bash
cd backend
pip install -r requirements.txt
```

This installs FastAPI, pdfplumber, ReportLab, openpyxl, Azure SDK, and all other Python libraries.

---

### Step 4 — Install Node.js dependencies

Open a **second terminal**, go to the project root, and run:

```bash
pnpm install
```

If you see this error:
```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.27.3
```
Run this to approve esbuild's native build:
```bash
pnpm approve-builds
```
Select `esbuild` in the checklist and confirm. Then re-run `pnpm install`.

---

### Step 5 — Start the backend

In the first terminal (inside `backend/`):

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

The `--reload` flag automatically restarts the server when you change a Python file.

---

### Step 6 — Start the frontend

In the second terminal (from the project root):

```bash
cd artifacts/frontend
pnpm dev
```

You should see:
```
  VITE ready in 300ms
  ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** in your browser. The app is running.

---

### How the proxy works locally

The frontend makes API calls like `/api/v1/templates/list`. Since the frontend and backend run on different ports, Vite's built-in proxy (configured in `vite.config.ts`) intercepts any request starting with `/api/v1` and forwards it to `http://localhost:8000` automatically.

```
Browser (port 5173)
   └─ fetch("/api/v1/templates/list")
         ↓  Vite proxy intercepts
   └─ http://localhost:8000/api/v1/templates/list
         ↓  FastAPI responds
   └─ JSON response back to browser
```

**You do NOT need to run `artifacts/api-server` locally.** That Express proxy is only used on the Replit hosting platform.

---

### Quick reference — 2 terminals

| Terminal | Directory | Command | URL |
|----------|-----------|---------|-----|
| 1 | `backend/` | `uvicorn app.main:app --port 8000 --reload` | http://localhost:8000 |
| 2 | `artifacts/frontend/` | `pnpm dev` | http://localhost:5173 |

---

## 5. Architecture — How Everything Connects

```
┌──────────────────────────────────────────────────────────────────────┐
│                        BROWSER (User's screen)                        │
│                      React app — artifacts/frontend/                  │
│  Step 1: Upload files    Step 2: Review form    Step 3: Download PDF  │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │  HTTP fetch calls to /api/v1/*
                                  │  (proxied by Vite locally,
                                  │   proxied by Express on Replit)
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     FastAPI Backend — backend/                        │
│                      Running on port 8000                             │
│                                                                       │
│  ┌─────────────┐  ┌─────────────────┐  ┌────────────────────────┐   │
│  │ /templates  │  │ /shipper/extract │  │  /shipper/generate     │   │
│  │ /list       │  │                 │  │                        │   │
│  │ /fields     │  │  reads PDFs     │  │  generates label PDF   │   │
│  └──────┬──────┘  └───────┬─────────┘  └───────────┬────────────┘   │
│         │                 │                         │                │
│         ▼                 ▼                         ▼                │
│  ┌─────────────┐  ┌─────────────────┐  ┌────────────────────────┐   │
│  │excel_schema │  │   extractor.py  │  │pdf_generator_dynamic   │   │
│  │.py          │  │  (pdfplumber)   │  │  (ReportLab)           │   │
│  └──────┬──────┘  └───────┬─────────┘  └───────────┬────────────┘   │
│         │                 │                         │                │
│         ▼                 ▼                         ▼                │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                  External data sources                       │    │
│  │  Azure Blob Storage        │      SQLite (material_master)  │    │
│  │  - Excel template files    │      - GTIN                    │    │
│  │  - template_values.json    │      - Product Name            │    │
│  │  - Generated PDFs (output) │      - Quantity, Inner Pack    │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. Backend Deep Dive

### `backend/app/main.py` — The Entry Point

This is the first file FastAPI reads when it starts. It:
- Creates the FastAPI app object
- Adds CORS middleware (so the browser frontend can call the API)
- Registers all three route groups (health, shipper, template_schema)
- Serves the built React frontend as a Single-Page App (SPA) in production

**Key functions:**
| Function | What it does |
|----------|-------------|
| `generic_exception_handler` | Catches any unhandled error and returns a clean JSON error instead of a Python traceback |
| `serve_spa` | Serves `index.html` for any URL that isn't an API route, enabling React's client-side routing |

---

### `backend/app/core/config.py` — Configuration

Uses Pydantic's `BaseSettings` to read environment variables (from the `.env` file or the system environment). Every configurable value in the app comes from here.

| Setting | Default | Description |
|---------|---------|-------------|
| `azure_storage_connection_string` | `""` | Azure connection string — if empty, app runs in local-only mode |
| `azure_blob_container_name` | `uploaded-files` | Azure container name |
| `azure_blob_target_folder` | `input` | Internal folder config |
| `azure_excel_folder` | `excel` | Subfolder inside the container where Excel templates are stored |
| `azure_config_folder` | `config` | Subfolder where `template_values.json` is stored |
| `schema_cache_ttl_seconds` | `300` | How long (5 min) to cache template lists and field definitions |
| `cors_origins` | `*` | Which browser origins are allowed to call the API |

---

### `backend/app/models/schemas.py` — Data Shapes

Defines all Pydantic models — these are like typed blueprints that validate every request and response.

| Model | Used for |
|-------|---------|
| `DynamicShipperInput` | The JSON body sent when generating a PDF — accepts `template`, `material_number`, `batch_number`, and any extra fields from the form |
| `ShipperData` | The extracted data returned after Step 1 PDF parsing |
| `ExtractResponse` | Full response from `/shipper/extract` — includes data + list of missing fields |
| `GenerateResponse` | Response from `/shipper/generate` — includes `document_id` for polling |
| `FileListResponse` | Response from `/shipper/files` — list of Azure blob names |
| `ErrorResponse` | Standard error shape used everywhere |
| `DISTRIBUTED_BY` | Constant string — the "Distributed by TCS" text printed on every PDF |

**Important:** `DynamicShipperInput` uses `model_config = ConfigDict(extra="allow")` — this means it accepts any additional fields beyond the declared ones. This is what makes the dynamic template system work: whatever fields the Excel defines, they all get passed through without the backend needing to know about them in advance.

---

### `backend/app/api/routes/shipper.py` — Main API Endpoints

The most important file in the backend. Contains all the business logic endpoints.

**Module-level variables (in-memory state):**
```python
_generated_files: dict[str, str]   # document_id → local temp file path
_upload_status:   dict[str, str]   # document_id → "uploading" | "uploaded" | "failed"
```
These are simple Python dicts that live in memory. They're cleared when the server restarts.

**Functions:**

| Function | Route | What it does |
|----------|-------|-------------|
| `_validate_pdf` | (internal) | Checks that uploaded file is actually a PDF by content type + magic bytes (`%PDF`) |
| `_sanitize_path_segment` | (internal) | Strips special characters from material/batch numbers so they're safe in file paths |
| `_upload_to_azure_background` | (internal) | Runs in background after generate — uploads PDF to Azure asynchronously |
| `extract_shipper_data` | `POST /shipper/extract` | Receives material number + 2 PDFs. Queries SQLite, runs both PDF extractors, returns combined JSON |
| `generate_shipper_label` | `POST /shipper/generate` | Receives form values JSON. Loads template field definitions. Calls PDF generator. Starts Azure upload in background. Returns `document_id` |
| `get_upload_status` | `GET /shipper/status/{id}` | Frontend polls this to know when Azure upload finishes |
| `download_shipper_label` | `GET /shipper/download/{id}` | Serves the generated PDF file for browser download |
| `list_files_by_date_range` | `GET /shipper/files` | Lists previously generated PDFs from Azure by date range |

**How `generate_shipper_label` names the Azure blob:**
```python
timestamp = datetime.now(IST_timezone).strftime("%Y%m%d_%H%M%S")
blob_name = f"final_generated_shipped_pdf/final_shipper_pdf_{timestamp}.pdf"
# Example: final_generated_shipped_pdf/final_shipper_pdf_20260705_143025.pdf
```

---

### `backend/app/api/routes/template_schema.py` — Template Endpoints

| Function | Route | What it does |
|----------|-------|-------------|
| `list_templates_endpoint` | `GET /templates/list` | Returns all available template names + which source (azure/local) they came from |
| `get_template_fields_endpoint` | `GET /templates/fields?template=xxx&refresh=true` | Returns the full field definition for a given template |

The `refresh=true` query parameter busts all three caches simultaneously (template list cache, fields cache, template_values.json cache).

---

### `backend/app/services/extractor.py` — PDF Data Extraction

Uses `pdfplumber` to read text and tables from the two uploaded PDFs.

**`extract_formula_data(formula_pdf_bytes)`**
- Opens the Master Formula PDF
- Extracts all text from every page
- Looks for the word "india" or "usa" (case-insensitive) anywhere in the text
- Returns `{"active_ingredient": "Active ingredient made in India"}` (or USA, or None)

**`extract_storage_data(storage_pdf_bytes)`**
- Opens the Storage & Shipping PDF
- Reads every table on every page looking for a column whose header contains both "storage" and "description" — takes the value from that cell as `storage_requirements`
- Uses regex patterns on the full text to find `batch_number` (looks for "Batch Number:", "Lot:", etc.)
- Uses regex patterns to find `expiration_date` (looks for "Expiration Date:", "Exp Date:", etc.)
- Returns `{storage_requirements, batch_number, expiration_date}`

---

### `backend/app/services/excel_schema.py` — Template Schema Engine

This is the brain of the dynamic template system. It reads Excel files to define what fields appear in Step 2 of the UI.

**Caches (module-level):**
```python
_list_cache   # caches the list of template names for 5 minutes
_fields_cache # caches field definitions per template for 5 minutes
_db_cache     # caches template_values.json for 5 minutes
```

**Functions:**

| Function | What it does |
|----------|-------------|
| `list_templates(force_refresh)` | Lists all `.xlsx` files from Azure `excel/` folder (or local fallback). When `force_refresh=True`, clears all three caches before fetching |
| `get_template_fields(name, force_refresh)` | Fetches the Excel for that template, parses it, merges with `template_values.json`, returns field definitions |
| `_fetch_excel_bytes(name)` | Downloads the `.xlsx` from Azure. Falls back to `backend/data/excel/{name}.xlsx` if Azure fails |
| `_parse_excel_bytes(raw, name)` | Opens the `.xlsx` with openpyxl. Row 1 = headers. Each subsequent row = one form field. Accepts columns: `field_key`, `label`, `field_type`, `placeholder`, `required`, `readonly`, `order` |
| `_read_json_db(force_refresh)` | Downloads `template_values.json` from Azure `config/` folder (or local fallback). Contains default values and dropdown option lists |
| `_enrich_with_db(fields, db)` | Merges raw Excel field list with JSON DB: for `dropdown` fields, attaches the options list; for other fields, attaches the default value |
| `get_schema_source()` | Returns `"azure"`, `"local"`, or `"none"` — shown as the badge in the header |
| `invalidate_cache(name)` | Clears cached data for a specific template (or everything if `None`) |

**Excel file format** — each row in the Excel defines one form field:
```
| field_key        | label           | field_type | placeholder | required | readonly | order |
|------------------|-----------------|------------|-------------|----------|----------|-------|
| product_name     | Product Name    | text       | Enter name  | yes      | no       | 1     |
| storage_req      | Storage Req.    | dropdown   |             | yes      | no       | 2     |
| expiration_date  | Expiration Date | date       |             | yes      | no       | 3     |
```

---

### `backend/app/services/pdf_generator_dynamic.py` — PDF Creation

Uses ReportLab to build a clean A4 PDF from any set of field definitions and values.

**`generate_dynamic_pdf(template_name, fields, values, output_path)`**
1. Creates a ReportLab `SimpleDocTemplate` on A4 paper with 2cm margins
2. Draws a centered bold title (template name, uppercased)
3. Builds a two-column table:
   - Column 1 header: **"Print Elements"** (the field labels)
   - Column 2 header: **"Print Requirements"** (the field values)
4. Iterates through `fields`, for each one looks up its value from the `values` dict
5. Applies a table style: grey header row, black borders, 9pt Helvetica
6. Saves the PDF to `output_path`

The PDF is saved to a temporary directory. A background task then picks it up and uploads it to Azure.

---

### `backend/app/services/database.py` — Material Lookup

A simple SQLite reader. Only does one thing:

**`get_material_details(material_number)`**
- Opens `backend/database/material_master.db`
- Runs a SELECT query on the `material_master` table
- Returns `{product_name, gtin, quantity_per_case, inner_pack, label_specification_number}`
- Raises `MaterialNotFoundError` if the material number isn't found
- Raises `DatabaseUnavailableError` if the `.db` file doesn't exist

**SQLite table schema:**
```sql
CREATE TABLE material_master (
    material_number          TEXT PRIMARY KEY,
    product_name             TEXT,
    gtin                     TEXT,
    quantity_per_case        TEXT,
    inner_pack               TEXT,
    label_specification_number TEXT
);
```

---

### `backend/app/services/azure_storage.py` — Azure Blob Storage

**`upload_pdf_to_blob(output_path, blob_name)`**
- Reads the local PDF file
- Connects to Azure using the connection string from config
- Uploads the file to the configured container with `overwrite=True`
- If no connection string is set, logs a warning and returns without uploading (safe local mode)

**`list_blobs_by_date_range(start_date, end_date)`**
- Lists all blobs in the container
- Filters by `last_modified` date falling within the given range
- Returns a list of blob names

---

### `backend/app/services/validation.py` — Missing Field Checker

**`get_missing_fields(data_dict)`**
- Takes the extracted data dictionary
- Checks which required fields are empty or None
- Returns a list of `(field_key, display_label)` tuples
- Used in Step 1 to tell the user which fields they need to fill in manually

---

## 7. Frontend Deep Dive

### `artifacts/frontend/vite.config.ts` — Vite Configuration

Sets up the Vite dev server. Key settings:
- `port`: reads from `PORT` env var, defaults to `5173` locally
- `base`: reads from `BASE_PATH` env var, defaults to `/` locally
- `server.proxy`: forwards all `/api/v1` requests to `http://localhost:8000` — this is the critical local proxy setting
- Replit-specific plugins (`cartographer`, `devBanner`, `runtimeErrorOverlay`) are only loaded when the `REPL_ID` environment variable is set (i.e., only on Replit, not locally)

---

### `artifacts/frontend/src/main.tsx` — React Bootstrap

The standard React 19 entry point. Mounts the `<App />` component into the `<div id="root">` in `index.html`.

---

### `artifacts/frontend/src/App.tsx` — The Entire UI

This single file contains all the UI logic. It is a large file (~640 lines) but well-organized into sections.

**State variables (what the UI tracks):**

| Variable | Type | Purpose |
|----------|------|---------|
| `step` | `1 | 2 | 3` | Which step the user is on |
| `templates` | `string[]` | List of available template names from the API |
| `selectedTemplate` | `string` | Currently chosen template |
| `templateFields` | `array` | Field definitions for the selected template |
| `schemaSource` | `"azure" | "local" | "none"` | Where template data came from (shown as badge) |
| `formValues` | `Record<string, string>` | All current form field values (Step 2) |
| `materialNumber` | `string` | User-entered material number |
| `formulaPdf` | `File | null` | Uploaded formula PDF file |
| `storagePdf` | `File | null` | Uploaded storage PDF file |
| `extractedData` | `object | null` | Data returned from the extract API |
| `generatedDocId` | `string | null` | `document_id` returned after PDF generation |
| `uploadStatus` | `string` | Current Azure upload state |
| `generating` | `boolean` | Whether PDF generation is in progress |
| `extracting` | `boolean` | Whether PDF extraction is in progress |

**Key functions:**

| Function | Triggered by | What it does |
|----------|-------------|-------------|
| `fetchTemplates` | App load + refresh button | Calls `GET /api/v1/templates/list`, updates `templates` and `schemaSource` |
| `handleTemplateChange` | User selects a template | Calls `GET /api/v1/templates/fields?template=...`, populates `templateFields` and sets defaults in `formValues` |
| `handleRefresh` | ↻ button in header | Calls `GET /api/v1/templates/list?refresh=true` which busts all server caches, then re-fetches fields |
| `handleExtract` | "Extract Data" button in Step 1 | Builds a `FormData` with the two PDFs + material number, POSTs to `/api/v1/shipper/extract`, populates `formValues` with results, moves to Step 2 |
| `handleGenerate` | "Generate PDF" button in Step 2 | POSTs all `formValues` + template name to `/api/v1/shipper/generate`, saves the returned `document_id`, starts polling, moves to Step 3 |
| `pollUploadStatus` | After `handleGenerate` | Polls `GET /api/v1/shipper/status/{id}` every 2 seconds until status is `"uploaded"` or `"failed"` |
| `handleDownload` | "Download PDF" button in Step 3 | Opens `GET /api/v1/shipper/download/{id}` in a new browser tab |
| `handleReset` | "Generate Another" button | Resets all state back to Step 1 |

**`DynamicField` component (inside App.tsx):**
Renders a single form field based on its `field_type`:
- `"text"` → `<input type="text">`
- `"number"` → `<input type="number">`
- `"date"` → `<input type="date">`
- `"dropdown"` → `<select>` with `<option>` for each value from `options[]`

---

### `artifacts/frontend/src/components/` — UI Component Library

This folder contains shadcn/ui components — pre-built, accessible React components styled with Tailwind. These are standard building blocks (Button, Input, Select, Toast, etc.) and are imported by `App.tsx`. You generally don't need to modify these files.

---

### `artifacts/api-server/` — Replit-Only Proxy (Not needed locally)

This is an Express.js server that only runs on the Replit hosting platform. It acts as an intermediary between the platform's routing layer and the FastAPI backend:
- Receives all traffic on its assigned port
- Forwards any request starting with `/api/v1` to `http://localhost:8000` (FastAPI)

On your local machine, Vite's built-in proxy does exactly the same job, so this server is not needed locally.

---

## 8. Data Flow — Step by Step

### App startup

```
Browser opens
  → App.tsx mounts
  → fetchTemplates() called
  → GET /api/v1/templates/list
  → excel_schema.list_templates()
  → Tries Azure: lists blobs in uploaded-files/excel/*.xlsx
  → Returns ["template_a", "template_b", ...]
  → schemaSource set to "azure" (green badge) or "local" (amber badge)
  → Template dropdown populated
```

### User selects a template

```
User picks "template_a" from dropdown
  → handleTemplateChange("template_a")
  → GET /api/v1/templates/fields?template=template_a
  → excel_schema.get_template_fields("template_a")
  → _fetch_excel_bytes("template_a")  ← downloads from Azure or local
  → _parse_excel_bytes(raw)           ← reads rows into field defs
  → _read_json_db()                   ← loads template_values.json
  → _enrich_with_db(fields, db)       ← merges defaults + dropdown options
  → Returns field list to frontend
  → App renders form fields for Step 1 (material number, file uploads)
```

### Step 1 — Extract

```
User fills: material_number="12345", uploads formula.pdf + storage.pdf
User clicks "Extract Data"
  → handleExtract()
  → POST /api/v1/shipper/extract  (multipart/form-data)
    ├─ database.get_material_details("12345")
    │    └─ SQLite query → {product_name, gtin, quantity_per_case, ...}
    ├─ extractor.extract_formula_data(formula_bytes)
    │    └─ pdfplumber reads text → finds "india" → "Active ingredient made in India"
    └─ extractor.extract_storage_data(storage_bytes)
         └─ pdfplumber reads tables → finds storage_description col
         └─ regex search for batch_number, expiration_date
  → Combined ShipperData returned
  → validation.get_missing_fields() → list of empty required fields
  → ExtractResponse sent to frontend
  → formValues populated with extracted data
  → missingFields shown as warning badges
  → UI moves to Step 2
```

### Step 2 — Review & fill

```
User sees pre-filled form based on templateFields
  → Each field rendered by DynamicField component
  → Extracted values pre-filled
  → Missing fields shown highlighted
User fills any missing gaps, edits values if needed
User clicks "Generate Label"
```

### Step 3 — Generate

```
User clicks "Generate Label"
  → handleGenerate()
  → POST /api/v1/shipper/generate  (JSON body with all formValues)
    ├─ get_template_fields(template_name) → field definitions for PDF layout
    ├─ generate_dynamic_pdf(template, fields, values, temp_path)
    │    └─ ReportLab builds A4 PDF with 2-column table
    │    └─ PDF saved to /tmp/{uuid}.pdf
    ├─ timestamp = now(IST).strftime("%Y%m%d_%H%M%S")
    ├─ blob_name = "final_generated_shipped_pdf/final_shipper_pdf_{timestamp}.pdf"
    └─ BackgroundTask: _upload_to_azure_background(temp_path, blob_name, doc_id)
         └─ azure_storage.upload_pdf_to_blob() ← runs in background
  → Returns {document_id, download_url}

Frontend polling loop (every 2 seconds):
  → GET /api/v1/shipper/status/{document_id}
  → Returns {"status": "uploading"} ... {"status": "uploaded"}
  → When "uploaded": show success + download button
  → When "failed": show error message
```

---

## 9. Azure Blob Storage Layout

```
uploaded-files/                        ← container (AZURE_BLOB_CONTAINER_NAME)
│
├── excel/                             ← template Excel files
│   ├── template_a.xlsx
│   ├── template_b.xlsx
│   └── ...  (any .xlsx here becomes a selectable template)
│
├── config/
│   └── template_values.json           ← dropdown options + default values
│
└── final_generated_shipped_pdf/       ← all generated shipper label PDFs
    ├── final_shipper_pdf_20260705_143025.pdf
    ├── final_shipper_pdf_20260705_151210.pdf
    └── ...  (named by IST timestamp — YYYYMMDD_HHMMSS)
```

**To add a new template:** Upload a new `.xlsx` file to `uploaded-files/excel/`. It will appear in the dropdown within 5 minutes (or immediately after clicking the ↻ refresh button).

**To update dropdown options:** Edit `uploaded-files/config/template_values.json` in Azure. Changes take effect within 5 minutes or on refresh.

---

## 10. Configuration Reference

### `backend/data/template_values.json`

This file (also kept in Azure at `config/template_values.json`) maps field keys to their default values or dropdown options.

```json
{
  "distributed_by": "Distributed by:\nTCS\n\n© TCS 2026",
  "storage_requirements": [
    "Store below 25°C",
    "Store between 15°C and 30°C",
    "Refrigerate 2°C to 8°C"
  ],
  "country_of_origin_active": "N/A"
}
```

- If the value is a **string** → it becomes the default value for a text/date/number field
- If the value is a **list** → it becomes the options for a dropdown field

**Azure takes priority over local.** If the same key exists in both places, Azure's version is used.

---

## 11. API Reference

All endpoints are at **`http://localhost:8000/api/v1/...`**

Interactive API docs (Swagger UI) available at: `http://localhost:8000/api/v1/docs`

---

### `GET /api/v1/health`
Returns `{"status": "healthy"}` — used to check if the server is up.

---

### `GET /api/v1/templates/list`

Returns all available templates.

| Query param | Type | Description |
|-------------|------|-------------|
| `refresh` | bool | Pass `true` to bust all caches immediately |

**Response:**
```json
{
  "templates": ["template_a", "template_b"],
  "source": "azure"
}
```

---

### `GET /api/v1/templates/fields`

Returns field definitions for one template.

| Query param | Type | Required | Description |
|-------------|------|----------|-------------|
| `template` | string | Yes | Template name (without `.xlsx`) |
| `refresh` | bool | No | `true` to bypass cache |

**Response:**
```json
{
  "template_name": "template_a",
  "source": "azure",
  "fields": [
    {
      "field_name": "product_name",
      "label": "Product Name",
      "field_type": "text",
      "placeholder": "Enter product name",
      "required": true,
      "readonly": false,
      "order": 1,
      "default_value": null
    },
    {
      "field_name": "storage_requirements",
      "label": "Storage Requirements",
      "field_type": "dropdown",
      "required": true,
      "readonly": false,
      "order": 2,
      "options": ["Store below 25°C", "Refrigerate 2°C to 8°C"]
    }
  ]
}
```

---

### `POST /api/v1/shipper/extract`

Accepts two PDFs + material number. Returns extracted data.

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| `material_number` | string | Material number to look up in SQLite |
| `formula_pdf` | file | Master Formula PDF |
| `storage_pdf` | file | Storage and Shipping PDF |

**Response:**
```json
{
  "success": true,
  "data": {
    "product_name": "TYLENOL 500MG",
    "gtin": "00312547612309",
    "material_number": "12345",
    "active_ingredient": "Active ingredient made in India",
    "storage_requirements": "Store below 25°C",
    "batch_number": "BN2024001",
    "expiration_date": "2026-12-31"
  },
  "missing_fields": [
    {"field": "quantity", "label": "Quantity per Case"}
  ]
}
```

---

### `POST /api/v1/shipper/generate`

Generates the shipper label PDF.

**Request:** `application/json`
```json
{
  "template": "template_a",
  "material_number": "12345",
  "batch_number": "BN2024001",
  "product_name": "TYLENOL 500MG",
  "...": "any other fields from the template"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Shipper label generated successfully",
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "file_name": "template_a_shipper.pdf",
  "blob_path": "final_generated_shipped_pdf/final_shipper_pdf_20260705_143025.pdf",
  "download_url": "/api/v1/shipper/download/550e8400-e29b-41d4-a716-446655440000"
}
```

---

### `GET /api/v1/shipper/status/{document_id}`

Poll this after generate to check Azure upload status.

**Response:** `{"document_id": "...", "status": "uploading" | "uploaded" | "failed"}`

---

### `GET /api/v1/shipper/download/{document_id}`

Downloads the generated PDF. Returns the file as `application/pdf`.

---

### `GET /api/v1/shipper/files`

Lists previously generated PDFs stored in Azure.

| Query param | Type | Description |
|-------------|------|-------------|
| `start_date` | string | `YYYY-MM-DD` format |
| `end_date` | string | `YYYY-MM-DD` format (inclusive) |

**Response:** `{"success": true, "files": ["final_generated_shipped_pdf/..."], "total": 5, ...}`

---

## 12. How to Make Common Changes

### Add a new form field to a template

1. Open the template's `.xlsx` file
2. Add a new row: fill in `field_key`, `label`, `field_type`, `order`
3. If it's a `dropdown`, add the options as a JSON list in `template_values.json` under the same `field_key`
4. Upload the updated `.xlsx` to Azure at `uploaded-files/excel/`
5. Click the ↻ refresh button in the app header — the new field appears immediately

### Add a brand-new template

1. Create a new `.xlsx` file with the required columns (see Excel format above)
2. Upload it to `uploaded-files/excel/your_template_name.xlsx` in Azure
3. Click the ↻ refresh button — the template appears in the dropdown

### Change the PDF layout or styling

Edit `backend/app/services/pdf_generator_dynamic.py` — specifically the `TableStyle` list and the column width ratios (`page_width * 0.38` / `page_width * 0.62`).

### Change where generated PDFs are saved in Azure

Edit `backend/app/api/routes/shipper.py` around line 188–190:
```python
timestamp = datetime.now(ist).strftime("%Y%m%d_%H%M%S")
blob_name = f"final_generated_shipped_pdf/final_shipper_pdf_{timestamp}.pdf"
```

### Change the PDF extraction logic

Edit `backend/app/services/extractor.py`:
- `extract_formula_data` — modify the keyword checks for country of origin
- `extract_storage_data` — modify the regex patterns for batch/expiry, or the table column matching logic

### Add a new material to the SQLite database

Use any SQLite client (e.g. DB Browser for SQLite — free download):
1. Open `backend/database/material_master.db`
2. Insert a row into `material_master` table with all required columns
3. Save and restart the backend

### Change the brand name / color

- **Header text:** `artifacts/frontend/src/App.tsx` — line with `TCS — Internal Tool`
- **Brand color:** `artifacts/frontend/src/App.tsx` — the `BRAND` constant at the top of the file (currently `#1f242e`)
- **PDF footer text:** `backend/app/models/schemas.py` — the `DISTRIBUTED_BY` constant
- **Local template values:** `backend/data/template_values.json` — the `distributed_by` key

### Adjust the schema cache TTL

In `backend/.env`, add:
```
SCHEMA_CACHE_TTL_SECONDS=60
```
This changes the cache from 5 minutes to 1 minute. Set to `0` to effectively disable caching (not recommended in production).

---

*Last updated: July 2026*
