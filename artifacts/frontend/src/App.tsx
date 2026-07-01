import { useState, useEffect, useRef } from "react";
import { Toaster, toast } from "sonner";

const BRAND = "#1f242e";

type Step = "upload" | "review" | "done";
type TemplateId = "1" | "2";
type UploadStatus = "uploading" | "uploaded" | "failed" | "unknown";

interface MissingField { field: string; label: string; }

interface ShipperData {
  product_name: string; gtin: string; quantity: string; inner_pack: string;
  material_number: string; label_specification: string;
  storage_requirements: string | null; batch_number: string | null;
  expiration_date: string | null; active_ingredient: string | null;
  distributed_by: string;
  country_of_origin_active: string;
  special_requirements: string;
}

interface ExtractResponse { success: boolean; data: ShipperData; missing_fields: MissingField[]; }
interface GenerateResponse {
  success: boolean; message: string; document_id: string;
  file_name: string; blob_path: string; download_url: string;
}

// Template field definitions
const T1_FIELDS: { key: keyof ShipperData; label: string; readonly?: boolean }[] = [
  { key: "product_name",         label: "Product Name" },
  { key: "gtin",                 label: "GTIN" },
  { key: "material_number",      label: "Material Number", readonly: true },
  { key: "quantity",             label: "Quantity per Case" },
  { key: "inner_pack",           label: "Inner Pack" },
  { key: "label_specification",  label: "Label Specification" },
  { key: "active_ingredient",    label: "Active Ingredient" },
  { key: "storage_requirements", label: "Storage Requirements" },
  { key: "batch_number",         label: "Batch Number" },
  { key: "expiration_date",      label: "Expiration Date" },
  { key: "distributed_by",       label: "Distributed By", readonly: true },
];

const T2_FIELDS: { key: keyof ShipperData; label: string; readonly?: boolean }[] = [
  { key: "product_name",              label: "Product Name, Description, and Size" },
  { key: "quantity",                  label: "Quantity per Case" },
  { key: "inner_pack",                label: "Inner Pack" },
  { key: "material_number",           label: "Product Code", readonly: true },
  { key: "gtin",                      label: "Shipper GTIN Barcode and Human Readable" },
  { key: "batch_number",              label: "Batch/Lot Code" },
  { key: "expiration_date",           label: "Expiration Date" },
  { key: "storage_requirements",      label: "Storage Requirements" },
  { key: "distributed_by",            label: "Distributed By", readonly: true },
  { key: "country_of_origin_active",  label: "Country of Origin of Active" },
  { key: "special_requirements",      label: "Special Requirements" },
];

// Fields NOT relevant for template 2 missing-field checks
const T2_EXCLUDED_MISSING = new Set(["label_specification", "active_ingredient"]);

export default function App() {
  const [step, setStep] = useState<Step>("upload");
  const [template, setTemplate] = useState<TemplateId>("1");
  const [materialNumber, setMaterialNumber] = useState("");
  const [formulaPdf, setFormulaPdf] = useState<File | null>(null);
  const [storagePdf, setStoragePdf] = useState<File | null>(null);
  const [extractedData, setExtractedData] = useState<ShipperData | null>(null);
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [editedData, setEditedData] = useState<Partial<ShipperData>>({});
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("unknown");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll upload status after generation
  useEffect(() => {
    if (!result) return;
    setUploadStatus("uploading");
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/v1/shipper/status/${result.document_id}`);
        const json = await res.json();
        if (json.status === "uploaded" || json.status === "failed") {
          setUploadStatus(json.status);
          clearInterval(pollRef.current!);
        } else if (attempts > 60) clearInterval(pollRef.current!);
      } catch { /* ignore */ }
    }, 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [result]);

  // Effective missing fields depend on template
  const effectiveMissing = template === "2"
    ? missingFields.filter(m => !T2_EXCLUDED_MISSING.has(m.field))
    : missingFields;

  async function handleExtract() {
    if (!materialNumber.trim()) { toast.error("Please enter a material number"); return; }
    if (!formulaPdf) { toast.error("Please upload the Master Formula PDF"); return; }
    if (!storagePdf) { toast.error("Please upload the Storage & Shipping PDF"); return; }
    setExtracting(true);
    try {
      const form = new FormData();
      form.append("material_number", materialNumber.trim());
      form.append("formula_pdf", formulaPdf);
      form.append("storage_pdf", storagePdf);
      const res = await fetch("/api/v1/shipper/extract", { method: "POST", body: form });
      let json: ExtractResponse;
      try { json = await res.json(); }
      catch { toast.error(`Server error (${res.status}) — check that the backend is running`); return; }
      if (!res.ok) { toast.error((json as any).detail || "Extraction failed"); return; }

      // Seed Template 2 defaults if not already set
      const seededData: ShipperData = {
        ...json.data,
        country_of_origin_active: json.data.country_of_origin_active || "N/A",
        special_requirements: json.data.special_requirements || "N/A",
      };

      setExtractedData(seededData);
      setMissingFields(json.missing_fields);
      setEditedData({});
      setStep("review");

      const effective = template === "2"
        ? json.missing_fields.filter(m => !T2_EXCLUDED_MISSING.has(m.field))
        : json.missing_fields;
      if (effective.length > 0) toast.warning(`${effective.length} field(s) need manual entry`);
      else toast.success("All fields extracted successfully");
    } catch { toast.error("Network error — is the backend running?"); }
    finally { setExtracting(false); }
  }

  async function handleGenerate() {
    if (!extractedData) return;
    const merged = { ...extractedData, ...editedData };
    for (const mf of effectiveMissing) {
      const val = (merged as any)[mf.field];
      if (!val || String(val).trim() === "") { toast.error(`Please fill in: ${mf.label}`); return; }
    }
    setGenerating(true);
    try {
      const payload = { ...merged, template };
      const res = await fetch("/api/v1/shipper/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      let json: GenerateResponse;
      try { json = await res.json(); }
      catch { toast.error(`Server error (${res.status}) — check that the backend is running`); return; }
      if (!res.ok) { toast.error((json as any).detail || "Generation failed"); return; }
      setResult(json);
      setStep("done");
      toast.success("Shipper label generated — uploading to Azure…");
    } catch { toast.error("Network error — is the backend running?"); }
    finally { setGenerating(false); }
  }

  function handleReset() {
    setStep("upload"); setMaterialNumber(""); setFormulaPdf(null); setStoragePdf(null);
    setExtractedData(null); setMissingFields([]); setEditedData({});
    setResult(null); setUploadStatus("unknown");
    if (pollRef.current) clearInterval(pollRef.current);
  }

  const mergedData = extractedData ? { ...extractedData, ...editedData } : null;
  const activeFields = template === "2" ? T2_FIELDS : T1_FIELDS;
  const steps: Step[] = ["upload", "review", "done"];

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: BRAND }}>
          <span className="text-white font-bold text-xs">K</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Shipper Label Generator</h1>
          <p className="text-xs text-gray-500">Kenvue — Internal Tool</p>
        </div>
        <div className="ml-auto flex gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  i < steps.indexOf(step) ? "bg-green-500 text-white" : step !== s ? "bg-gray-200 text-gray-500" : "text-white"
                }`}
                style={step === s ? { backgroundColor: BRAND } : {}}
              >
                {i < steps.indexOf(step) ? "✓" : i + 1}
              </div>
              {i < 2 && <div className="w-8 h-px bg-gray-200" />}
            </div>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">

        {/* STEP 1 */}
        {step === "upload" && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Step 1 — Upload Documents</h2>
            <p className="text-sm text-gray-500 mb-6">Select a template, enter a material number, and upload both PDF files.</p>

            {/* Template selector */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">Label Template</label>
              <div className="grid grid-cols-2 gap-3">
                {(["1", "2"] as TemplateId[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTemplate(t)}
                    className={`text-left border-2 rounded-lg p-4 transition-all ${
                      template === t ? "border-2 shadow-sm" : "border-gray-200 hover:border-gray-300"
                    }`}
                    style={template === t ? { borderColor: BRAND, backgroundColor: `${BRAND}08` } : {}}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                        style={template === t ? { borderColor: BRAND } : { borderColor: "#d1d5db" }}
                      >
                        {template === t && (
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND }} />
                        )}
                      </div>
                      <span className="text-sm font-semibold text-gray-800">Template {t}</span>
                    </div>
                    <p className="text-xs text-gray-500 ml-6">
                      {t === "1"
                        ? "Direct Print Label — Technical Information table"
                        : "Required Print Information — standard compliance table"}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Material Number</label>
                <input
                  type="text" value={materialNumber}
                  onChange={(e) => setMaterialNumber(e.target.value)}
                  placeholder="e.g. 0304491506"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
              <FileUploader label="Master Formula PDF" description="Contains the active ingredient and formula data" file={formulaPdf} onChange={setFormulaPdf} />
              <FileUploader label="Storage & Shipping PDF" description="Contains storage requirements, batch number, and expiration date" file={storagePdf} onChange={setStoragePdf} />
              <button
                onClick={handleExtract} disabled={extracting}
                className="w-full disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-opacity hover:opacity-90"
                style={{ backgroundColor: BRAND }}
              >
                {extracting ? "Extracting data…" : "Extract Data from PDFs"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === "review" && mergedData && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-semibold text-gray-900">Step 2 — Review & Confirm</h2>
              <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: BRAND }}>
                Template {template}
              </span>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Review extracted data. Fields marked in orange require manual input. Any blank field can be edited before generating.
            </p>

            <div className="space-y-3">
              {activeFields.map(({ key, label, readonly }) => {
                const isMissing = effectiveMissing.some((m) => m.field === key);
                const value = (mergedData as any)[key];
                return (
                  <div key={key}>
                    <label className={`block text-xs font-medium mb-1 ${isMissing ? "text-orange-600" : "text-gray-600"}`}>
                      {label} {isMissing && <span className="text-orange-500">*required</span>}
                    </label>
                    <input
                      type="text"
                      value={(editedData as any)[key] ?? value ?? ""}
                      onChange={(e) => setEditedData((prev) => ({ ...prev, [key]: e.target.value }))}
                      readOnly={readonly}
                      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                        isMissing
                          ? "border-orange-300 focus:ring-orange-400 bg-orange-50"
                          : "border-gray-200 bg-gray-50"
                      } ${readonly ? "opacity-60 cursor-not-allowed" : ""}`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep("upload")} className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors">
                Back
              </button>
              <button
                onClick={handleGenerate} disabled={generating}
                className="flex-1 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-opacity hover:opacity-90"
                style={{ backgroundColor: BRAND }}
              >
                {generating ? "Generating PDF…" : "Generate Shipper Label"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === "done" && result && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-1">Shipper Label Generated</h2>
              <p className="text-xs text-gray-400 mb-1">Template {template}</p>
              <p className="text-xs text-gray-400 mb-4 font-mono break-all px-4">{result.blob_path}</p>

              {/* Live Azure upload status */}
              <div className="flex items-center justify-center gap-2 mb-6">
                {uploadStatus === "uploading" && (
                  <><svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  <span className="text-sm text-gray-500">Uploading to Azure Blob…</span></>
                )}
                {uploadStatus === "uploaded" && (
                  <><svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                  <span className="text-sm text-green-600 font-medium">Uploaded to Azure Blob ✓</span></>
                )}
                {uploadStatus === "failed" && (
                  <><svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  <span className="text-sm text-red-600">Azure upload failed</span></>
                )}
              </div>

              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => window.open(result.download_url, "_blank")}
                  className="text-white font-medium px-6 py-2.5 rounded-lg text-sm transition-opacity hover:opacity-90"
                  style={{ backgroundColor: BRAND }}
                >
                  Download PDF
                </button>
                <button onClick={handleReset} className="border border-gray-300 text-gray-700 font-medium px-6 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors">
                  Generate Another
                </button>
              </div>
            </div>

            <FindFilesByDateRange />
          </>
        )}
      </main>
    </div>
  );
}

/* ─── Find Files by Date Range ─── */
function FindFilesByDateRange() {
  const today = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    setLoading(true); setError(null); setFiles(null);
    try {
      const res = await fetch(`/api/v1/shipper/files?start_date=${startDate}&end_date=${endDate}`);
      const json = await res.json();
      if (!res.ok) { setError(json.detail || "Failed to fetch files"); return; }
      setFiles(json.files ?? []);
    } catch { setError("Network error — could not reach backend"); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900 mb-1">Find Files by Date Range</h3>
      <p className="text-sm text-gray-500 mb-4">List all files in Azure Blob Storage updated between two dates.</p>

      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-32">
          <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
        </div>
        <div className="flex-1 min-w-32">
          <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
        </div>
        <button
          onClick={handleSearch} disabled={loading}
          className="text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50 transition-opacity hover:opacity-90 whitespace-nowrap"
          style={{ backgroundColor: BRAND }}
        >
          {loading ? "Searching…" : "Search Files"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {files !== null && (
        <div className="mt-4">
          {files.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No files found in this date range.</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">{files.length} file{files.length !== 1 ? "s" : ""} found</p>
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                {files.map((name, i) => (
                  <div key={i} className="px-3 py-2.5 hover:bg-gray-50">
                    <span className="text-xs font-mono text-gray-700 break-all">{name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── File Uploader ─── */
function FileUploader({ label, description, file, onChange }: {
  label: string; description: string; file: File | null; onChange: (f: File) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <p className="text-xs text-gray-400 mb-2">{description}</p>
      <label
        className={`flex items-center gap-3 border-2 border-dashed rounded-lg px-4 py-3 cursor-pointer transition-colors ${file ? "border-green-400 bg-green-50" : "border-gray-300 hover:bg-gray-50"}`}
        onMouseEnter={e => { if (!file) (e.currentTarget as HTMLElement).style.borderColor = BRAND; }}
        onMouseLeave={e => { if (!file) (e.currentTarget as HTMLElement).style.borderColor = ""; }}
      >
        <input type="file" accept=".pdf,application/pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f); }} />
        <svg className={`w-5 h-5 flex-shrink-0 ${file ? "text-green-500" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <div className="min-w-0">
          {file ? (
            <><p className="text-sm font-medium text-green-700 truncate">{file.name}</p><p className="text-xs text-green-500">{(file.size / 1024).toFixed(0)} KB — click to change</p></>
          ) : (
            <><p className="text-sm text-gray-600">Click to upload PDF</p><p className="text-xs text-gray-400">PDF files only, max 50 MB</p></>
          )}
        </div>
      </label>
    </div>
  );
}
