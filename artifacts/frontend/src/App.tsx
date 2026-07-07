import { useState, useEffect, useRef } from "react";
import { Toaster, toast } from "sonner";

const BRAND = "#1f242e";

type Step = "upload" | "review" | "done";
type UploadStatus = "uploading" | "uploaded" | "failed" | "unknown";

interface FieldDef {
  field_name: string;
  label: string;
  field_type: "text" | "date" | "number" | "dropdown";
  default_value: string | null;
  placeholder: string;
  options?: string[];
  required: boolean;
  readonly: boolean;
  order: number;
}

interface OcrData {
  product_name: string; gtin: string; quantity: string; inner_pack: string;
  material_number: string; label_specification: string;
  storage_requirements: string | null; batch_number: string | null;
  expiration_date: string | null; active_ingredient: string | null;
  distributed_by: string; country_of_origin_active: string; special_requirements: string;
  [key: string]: string | null | undefined;
}

interface ExtractResponse { success: boolean; data: OcrData; missing_fields: { field: string; label: string }[]; }
interface GenerateResponse {
  success: boolean; message: string; document_id: string;
  file_name: string; blob_path: string; download_url: string;
}

export default function App() {
  const [view, setView] = useState<"main" | "files">("main");
  const [step, setStep] = useState<Step>("upload");

  // Template list
  const [templateList, setTemplateList] = useState<string[]>([]);
  const [templateListLoading, setTemplateListLoading] = useState(true);
  const [templateListError, setTemplateListError] = useState<string | null>(null);

  // Selected template + its field definitions
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templateFields, setTemplateFields] = useState<FieldDef[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  // Step 1 inputs
  const [materialNumber, setMaterialNumber] = useState("");
  const [formulaPdf, setFormulaPdf] = useState<File | null>(null);
  const [storagePdf, setStoragePdf] = useState<File | null>(null);

  // Step 2 values (field_name → value string)
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  // Step 3
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("unknown");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [schemaSource, setSchemaSource] = useState<"azure" | "local" | "none">("none");
  const [refreshing, setRefreshing] = useState(false);

  async function loadTemplateList(forceRefresh = false) {
    setTemplateListLoading(true);
    setTemplateListError(null);
    try {
      const url = forceRefresh ? "/api/v1/templates/list?refresh=true" : "/api/v1/templates/list";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) { setTemplateListError(json.detail || "Failed to load templates"); return; }
      const list: string[] = json.templates ?? [];
      setTemplateList(list);
      setSchemaSource(json.source ?? "none");
      if (list.length === 0) setTemplateListError("No template files found in the configured folder.");
    } catch {
      setTemplateListError("Cannot connect to the backend. Make sure the server is running.");
    } finally {
      setTemplateListLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      // One call busts list cache + DB cache + all field caches simultaneously
      await loadTemplateList(true);
      // Re-fetch fields for current template with fresh DB
      if (selectedTemplate) {
        setFieldsLoading(true);
        try {
          const res = await fetch(`/api/v1/templates/fields?template=${encodeURIComponent(selectedTemplate)}&refresh=true`);
          const json = await res.json();
          if (res.ok) setTemplateFields(json.fields ?? []);
        } finally {
          setFieldsLoading(false);
        }
      }
      toast.success("Schema refreshed from Azure");
    } catch {
      toast.error("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  // Load template list on mount
  useEffect(() => {
    loadTemplateList();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load fields when template changes
  useEffect(() => {
    if (!selectedTemplate) { setTemplateFields([]); return; }
    async function loadFields() {
      setFieldsLoading(true);
      setFieldsError(null);
      setTemplateFields([]);
      try {
        const res = await fetch(`/api/v1/templates/fields?template=${encodeURIComponent(selectedTemplate)}`);
        const json = await res.json();
        if (!res.ok) { setFieldsError(json.detail || "Failed to load template fields"); return; }
        setTemplateFields(json.fields ?? []);
      } catch {
        setFieldsError("Could not load fields for this template.");
      } finally {
        setFieldsLoading(false);
      }
    }
    loadFields();
  }, [selectedTemplate]);

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

  // Compute missing required fields
  const missingFields = templateFields.filter(f => {
    if (!f.required || f.readonly) return false;
    const val = formValues[f.field_name];
    if (f.field_type === "dropdown") return !val || val.trim() === "";
    return !val || val.trim() === "";
  });

  async function handleExtract() {
    if (!selectedTemplate) { toast.error("Please select a template"); return; }
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
      catch { toast.error(`Server error (${res.status})`); return; }
      if (!res.ok) { toast.error((json as any).detail || "Extraction failed"); return; }

      const ocrData = json.data;

      // Build initial form values: OCR > schema default_value > empty
      const initial: Record<string, string> = { material_number: materialNumber.trim() };
      for (const field of templateFields) {
        const ocrVal = ocrData[field.field_name];
        if (ocrVal && String(ocrVal).trim()) {
          initial[field.field_name] = String(ocrVal).trim();
        } else if (field.default_value !== null && field.default_value !== undefined) {
          initial[field.field_name] = field.default_value;
        }
        // else: stays empty — user will see placeholder and fill in manually
      }

      setFormValues(initial);
      setStep("review");

      const missingCount = templateFields.filter(f => {
        if (!f.required || f.readonly) return false;
        return !initial[f.field_name] || String(initial[f.field_name]).trim() === "";
      }).length;

      if (missingCount > 0) toast.warning(`${missingCount} field(s) need manual entry`);
      else toast.success("All fields extracted successfully");
    } catch { toast.error("Network error — is the backend running?"); }
    finally { setExtracting(false); }
  }

  async function handleGenerate() {
    if (missingFields.length > 0) {
      toast.error(`Please fill in: ${missingFields[0].label}`);
      return;
    }
    setGenerating(true);
    try {
      const payload = { ...formValues, template: selectedTemplate };
      const res = await fetch("/api/v1/shipper/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      let json: GenerateResponse;
      try { json = await res.json(); }
      catch { toast.error(`Server error (${res.status})`); return; }
      if (!res.ok) { toast.error((json as any).detail || "Generation failed"); return; }
      setResult(json);
      setStep("done");
      toast.success("Shipper label generated — uploading to Azure…");
    } catch { toast.error("Network error — is the backend running?"); }
    finally { setGenerating(false); }
  }

  function handleReset() {
    setStep("upload"); setMaterialNumber(""); setFormulaPdf(null); setStoragePdf(null);
    setFormValues({}); setResult(null); setUploadStatus("unknown");
    if (pollRef.current) clearInterval(pollRef.current);
  }

  function setFieldValue(fieldName: string, value: string) {
    setFormValues(prev => ({ ...prev, [fieldName]: value }));
  }

  const steps: Step[] = ["upload", "review", "done"];

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: BRAND }}>
          <span className="text-white font-bold text-xs">T</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Shipper Label Generator</h1>
          <p className="text-xs text-gray-500">TCS — Internal Tool</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* Generated Files viewer button */}
          <button
            onClick={() => setView(v => v === "files" ? "main" : "files")}
            title="View all generated shipper label PDFs"
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
              view === "files"
                ? "border-blue-400 text-blue-700 bg-blue-50"
                : "border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" />
            </svg>
            {view === "files" ? "← Back to Generator" : "Generated Files"}
          </button>

          {/* Schema source badge + instant refresh */}
          {view === "main" && schemaSource !== "none" && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Click to refresh schema and database from Azure instantly"
              className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
                schemaSource === "azure"
                  ? "border-green-300 text-green-700 bg-green-50 hover:bg-green-100"
                  : "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
              } disabled:opacity-60`}
            >
              {refreshing ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              )}
              Schema: {schemaSource === "azure" ? "Azure" : "local"}
            </button>
          )}
          {view === "main" && (
            <div className="flex gap-2">
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
          )}
        </div>
      </header>

      {view === "files" && <GeneratedFilesPage onBack={() => setView("main")} />}

      <main className={`max-w-2xl mx-auto px-4 py-8 space-y-4 ${view === "files" ? "hidden" : ""}`}>

        {/* STEP 1 — Upload */}
        {step === "upload" && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Step 1 — Upload Documents</h2>
            <p className="text-sm text-gray-500 mb-6">Select a template, enter a material number, and upload both PDF files.</p>

            {/* Template dropdown */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Template</label>
              {templateListLoading ? (
                <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 bg-gray-50">
                  <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span className="text-sm text-gray-400">Loading templates…</span>
                </div>
              ) : templateListError ? (
                <div className="border border-red-200 rounded-lg px-3 py-2 bg-red-50">
                  <p className="text-sm text-red-600">{templateListError}</p>
                </div>
              ) : (
                <select
                  value={selectedTemplate}
                  onChange={e => setSelectedTemplate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
                >
                  <option value="" disabled>Select a template…</option>
                  {templateList.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}

              {/* Field count preview */}
              {selectedTemplate && !fieldsLoading && templateFields.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">{templateFields.length} fields defined in this template</p>
              )}
              {fieldsLoading && (
                <p className="text-xs text-gray-400 mt-1">Loading field definitions…</p>
              )}
              {fieldsError && (
                <p className="text-xs text-red-500 mt-1">{fieldsError}</p>
              )}
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Material Number</label>
                <input
                  type="text" value={materialNumber}
                  onChange={e => setMaterialNumber(e.target.value)}
                  placeholder="e.g. 0304491506"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
              <FileUploader label="Master Formula PDF" description="Contains the active ingredient and formula data" file={formulaPdf} onChange={setFormulaPdf} />
              <FileUploader label="Storage & Shipping PDF" description="Contains storage requirements, batch number, and expiration date" file={storagePdf} onChange={setStoragePdf} />
              <button
                onClick={handleExtract}
                disabled={extracting || !selectedTemplate || fieldsLoading || templateFields.length === 0}
                className="w-full disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-opacity hover:opacity-90"
                style={{ backgroundColor: BRAND }}
              >
                {extracting ? "Extracting data…" : "Extract Data from PDFs"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 — Review */}
        {step === "review" && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-semibold text-gray-900">Step 2 — Review & Confirm</h2>
              <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: BRAND }}>
                {selectedTemplate}
              </span>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Review extracted data. Fields marked in orange need manual input.
            </p>

            <div className="space-y-3">
              {templateFields.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No fields defined for this template.</p>
              ) : (
                templateFields.map(field => {
                  const isMissing = missingFields.some(m => m.field_name === field.field_name);
                  const val = formValues[field.field_name] ?? "";
                  return (
                    <DynamicField
                      key={field.field_name}
                      field={field}
                      value={val}
                      isMissing={isMissing}
                      onChange={v => setFieldValue(field.field_name, v)}
                    />
                  );
                })
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep("upload")}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
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

        {/* STEP 3 — Done */}
        {step === "done" && result && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-1">Shipper Label Generated</h2>
              <p className="text-xs text-gray-400 mb-1">{selectedTemplate}</p>
              <p className="text-xs text-gray-400 mb-4 font-mono break-all px-4">{result.blob_path}</p>

              {/* Live Azure upload status */}
              <div className="flex items-center justify-center gap-2 mb-6">
                {uploadStatus === "uploading" && (
                  <><svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span className="text-sm text-gray-500">Uploading to Azure Blob…</span></>
                )}
                {uploadStatus === "uploaded" && (
                  <><svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                  <span className="text-sm text-green-600 font-medium">Uploaded to Azure Blob ✓</span></>
                )}
                {uploadStatus === "failed" && (
                  <><svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
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
                <button onClick={handleReset} className="border border-gray-300 text-gray-700 font-medium px-6 py-2.5 rounded-lg text-sm hover:bg-gray-50">
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

/* ─── Dynamic field renderer ─── */
function DynamicField({
  field, value, isMissing, onChange,
}: {
  field: FieldDef; value: string; isMissing: boolean; onChange: (v: string) => void;
}) {
  const baseInputClass = `w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
    isMissing
      ? "border-orange-300 focus:ring-orange-400 bg-orange-50"
      : "border-gray-200 bg-gray-50 focus:ring-gray-300"
  } ${field.readonly ? "opacity-60 cursor-not-allowed" : ""}`;

  const labelEl = (
    <label className={`block text-xs font-medium mb-1 ${isMissing ? "text-orange-600" : "text-gray-600"}`}>
      {field.label}
      {isMissing && <span className="text-orange-500 ml-1">*required</span>}
    </label>
  );

  if (field.field_type === "dropdown") {
    const options: string[] = field.options ?? [];
    const hasOptions = options.length > 0;
    return (
      <div>
        {labelEl}
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={field.readonly}
          className={baseInputClass}
        >
          <option value="" disabled>
            {field.placeholder || "Select an option…"}
          </option>
          {hasOptions
            ? options.map(opt => <option key={opt} value={opt}>{opt}</option>)
            : <option value="" disabled>No options available</option>
          }
        </select>
        {!hasOptions && (
          <p className="text-xs text-amber-600 mt-1">
            No options found. Add a list for "{field.field_name}" to template_values.json.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {labelEl}
      <input
        type={field.field_type === "date" ? "date" : field.field_type === "number" ? "number" : "text"}
        value={value}
        placeholder={field.placeholder || undefined}
        onChange={e => onChange(e.target.value)}
        readOnly={field.readonly}
        className={baseInputClass}
      />
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
        <button onClick={handleSearch} disabled={loading}
          className="text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50 transition-opacity hover:opacity-90 whitespace-nowrap"
          style={{ backgroundColor: BRAND }}>
          {loading ? "Searching…" : "Search Files"}
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {files !== null && (
        <div className="mt-4">
          {files.length === 0
            ? <p className="text-sm text-gray-500 text-center py-4">No files found in this date range.</p>
            : <>
                <p className="text-xs text-gray-500 mb-2">{files.length} file{files.length !== 1 ? "s" : ""} found</p>
                <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                  {files.map((name, i) => (
                    <div key={i} className="px-3 py-2.5 hover:bg-gray-50">
                      <span className="text-xs font-mono text-gray-700 break-all">{name}</span>
                    </div>
                  ))}
                </div>
              </>
          }
        </div>
      )}
    </div>
  );
}

/* ─── Generated Files Page ─── */
interface GeneratedFile {
  name: string;
  blob_name: string;
  uploaded_at: string | null;
  size_kb: number;
}

function GeneratedFilesPage({ onBack }: { onBack: () => void }) {
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function loadFiles() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/generated-files/list");
      const json = await res.json();
      if (!res.ok) { setError(json.detail || "Failed to load files"); return; }
      setFiles(json.files ?? []);
    } catch {
      setError("Cannot connect to the backend. Make sure the server is running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadFiles(); }, []);

  async function handleDownload(file: GeneratedFile) {
    setDownloading(file.blob_name);
    try {
      const res = await fetch(`/api/v1/generated-files/download?blob=${encodeURIComponent(file.blob_name)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.detail || "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed — network error");
    } finally {
      setDownloading(null);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
      }) + " IST";
    } catch { return iso; }
  }

  function formatFileName(name: string) {
    return name.replace("final_shipper_pdf_", "").replace(".pdf", "").replace(/_/g, "  ");
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Generated Shipper Labels</h2>
          <p className="text-sm text-gray-500 mt-0.5">All PDFs saved in <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">final_generated_shipped_pdf/</code></p>
        </div>
        <button
          onClick={loadFiles}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-50 transition-all"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
              <div className="w-8 h-8 rounded-lg bg-gray-100" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-48" />
                <div className="h-2.5 bg-gray-100 rounded w-32" />
              </div>
              <div className="h-7 w-20 bg-gray-100 rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && files.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 text-center">
          <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-sm font-medium text-gray-500">No generated PDFs found</p>
          <p className="text-xs text-gray-400 mt-1">Files will appear here after you generate a shipper label.</p>
        </div>
      )}

      {/* Files table */}
      {!loading && files.length > 0 && (
        <>
          <p className="text-xs text-gray-400 mb-3">{files.length} file{files.length !== 1 ? "s" : ""} — newest first</p>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-2.5 bg-gray-50 border-b border-gray-200">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">File</span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Size</span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Generated (IST)</span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Action</span>
            </div>
            {/* Rows */}
            <div className="divide-y divide-gray-100">
              {files.map((file) => (
                <div key={file.blob_name} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3.5 items-center hover:bg-gray-50 transition-colors">
                  {/* File info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#f0f4ff" }}>
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{formatFileName(file.name)}</p>
                    </div>
                  </div>
                  {/* Size */}
                  <span className="text-xs text-gray-500 text-right whitespace-nowrap">{file.size_kb} KB</span>
                  {/* Date */}
                  <span className="text-xs text-gray-500 text-right whitespace-nowrap">{formatDate(file.uploaded_at)}</span>
                  {/* Download */}
                  <button
                    onClick={() => handleDownload(file)}
                    disabled={downloading === file.blob_name}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-60 transition-opacity hover:opacity-90 whitespace-nowrap"
                    style={{ backgroundColor: downloading === file.blob_name ? "#6b7280" : BRAND }}
                  >
                    {downloading === file.blob_name ? (
                      <>
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Downloading…
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Download
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
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
          onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f); }} />
        <svg className={`w-5 h-5 flex-shrink-0 ${file ? "text-green-500" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <div className="min-w-0">
          {file
            ? <><p className="text-sm font-medium text-green-700 truncate">{file.name}</p><p className="text-xs text-green-500">{(file.size / 1024).toFixed(0)} KB — click to change</p></>
            : <><p className="text-sm text-gray-600">Click to upload PDF</p><p className="text-xs text-gray-400">PDF files only, max 50 MB</p></>
          }
        </div>
      </label>
    </div>
  );
}
