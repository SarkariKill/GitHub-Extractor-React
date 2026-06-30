import { useState } from "react";
import { Toaster } from "sonner";
import { toast } from "sonner";

type Step = "upload" | "review" | "done";

interface MissingField {
  field: string;
  label: string;
}

interface ShipperData {
  product_name: string;
  gtin: string;
  quantity: string;
  inner_pack: string;
  material_number: string;
  label_specification: string;
  storage_requirements: string | null;
  batch_number: string | null;
  expiration_date: string | null;
  active_ingredient: string | null;
  distributed_by: string;
}

interface ExtractResponse {
  success: boolean;
  data: ShipperData;
  missing_fields: MissingField[];
}

interface GenerateResponse {
  success: boolean;
  message: string;
  document_id: string;
  file_name: string;
  blob_path: string;
  download_url: string;
}

export default function App() {
  const [step, setStep] = useState<Step>("upload");
  const [materialNumber, setMaterialNumber] = useState("");
  const [formulaPdf, setFormulaPdf] = useState<File | null>(null);
  const [storagePdf, setStoragePdf] = useState<File | null>(null);
  const [extractedData, setExtractedData] = useState<ShipperData | null>(null);
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [editedData, setEditedData] = useState<Partial<ShipperData>>({});
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  async function handleExtract() {
    if (!materialNumber.trim()) {
      toast.error("Please enter a material number");
      return;
    }
    if (!formulaPdf) {
      toast.error("Please upload the Master Formula PDF");
      return;
    }
    if (!storagePdf) {
      toast.error("Please upload the Storage & Shipping PDF");
      return;
    }

    setExtracting(true);
    try {
      const form = new FormData();
      form.append("material_number", materialNumber.trim());
      form.append("formula_pdf", formulaPdf);
      form.append("storage_pdf", storagePdf);

      const res = await fetch("/api/v1/shipper/extract", {
        method: "POST",
        body: form,
      });

      const json: ExtractResponse = await res.json();

      if (!res.ok) {
        toast.error((json as any).detail || "Extraction failed");
        return;
      }

      setExtractedData(json.data);
      setMissingFields(json.missing_fields);
      setEditedData({});
      setStep("review");

      if (json.missing_fields.length > 0) {
        toast.warning(`${json.missing_fields.length} field(s) need manual entry`);
      } else {
        toast.success("All fields extracted successfully");
      }
    } catch (e) {
      toast.error("Network error — is the backend running?");
    } finally {
      setExtracting(false);
    }
  }

  async function handleGenerate() {
    if (!extractedData) return;
    const merged = { ...extractedData, ...editedData };

    for (const mf of missingFields) {
      const val = (merged as any)[mf.field];
      if (!val || String(val).trim() === "") {
        toast.error(`Please fill in: ${mf.label}`);
        return;
      }
    }

    setGenerating(true);
    try {
      const res = await fetch("/api/v1/shipper/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });

      const json: GenerateResponse = await res.json();

      if (!res.ok) {
        toast.error((json as any).detail || "Generation failed");
        return;
      }

      setResult(json);
      setStep("done");
      toast.success("Shipper label generated & uploading to Azure");
    } catch (e) {
      toast.error("Network error — is the backend running?");
    } finally {
      setGenerating(false);
    }
  }

  function handleDownload() {
    if (!result) return;
    window.open(result.download_url, "_blank");
  }

  function handleReset() {
    setStep("upload");
    setMaterialNumber("");
    setFormulaPdf(null);
    setStoragePdf(null);
    setExtractedData(null);
    setMissingFields([]);
    setEditedData({});
    setResult(null);
  }

  const mergedData = extractedData ? { ...extractedData, ...editedData } : null;

  const displayFields: { key: keyof ShipperData; label: string }[] = [
    { key: "product_name", label: "Product Name" },
    { key: "gtin", label: "GTIN" },
    { key: "material_number", label: "Material Number" },
    { key: "quantity", label: "Quantity per Case" },
    { key: "inner_pack", label: "Inner Pack" },
    { key: "label_specification", label: "Label Specification" },
    { key: "active_ingredient", label: "Active Ingredient" },
    { key: "storage_requirements", label: "Storage Requirements" },
    { key: "batch_number", label: "Batch Number" },
    { key: "expiration_date", label: "Expiration Date" },
    { key: "distributed_by", label: "Distributed By" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center">
          <span className="text-white font-bold text-xs">J&J</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Shipper Label Generator</h1>
          <p className="text-xs text-gray-500">Johnson & Johnson — Internal Tool</p>
        </div>
        <div className="ml-auto flex gap-2">
          {(["upload", "review", "done"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  step === s
                    ? "bg-red-600 text-white"
                    : i < ["upload", "review", "done"].indexOf(step)
                    ? "bg-green-500 text-white"
                    : "bg-gray-200 text-gray-500"
                }`}
              >
                {i < ["upload", "review", "done"].indexOf(step) ? "✓" : i + 1}
              </div>
              {i < 2 && <div className="w-8 h-px bg-gray-200" />}
            </div>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* STEP 1: Upload */}
        {step === "upload" && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Step 1 — Upload Documents</h2>
            <p className="text-sm text-gray-500 mb-6">
              Enter the material number and upload both PDF files to extract shipper data.
            </p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Material Number</label>
                <input
                  type="text"
                  value={materialNumber}
                  onChange={(e) => setMaterialNumber(e.target.value)}
                  placeholder="e.g. 12345678"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              <FileUploader
                label="Master Formula PDF"
                description="Contains the active ingredient and formula data"
                file={formulaPdf}
                onChange={setFormulaPdf}
              />

              <FileUploader
                label="Storage & Shipping PDF"
                description="Contains storage requirements, batch number, and expiration date"
                file={storagePdf}
                onChange={setStoragePdf}
              />

              <button
                onClick={handleExtract}
                disabled={extracting}
                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {extracting ? "Extracting data…" : "Extract Data from PDFs"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Review */}
        {step === "review" && mergedData && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Step 2 — Review & Confirm</h2>
            <p className="text-sm text-gray-500 mb-6">
              Review extracted data. Fields marked in orange require manual input.
            </p>

            <div className="space-y-3">
              {displayFields.map(({ key, label }) => {
                const isMissing = missingFields.some((m) => m.field === key);
                const value = (mergedData as any)[key];
                return (
                  <div key={key}>
                    <label className={`block text-xs font-medium mb-1 ${isMissing ? "text-orange-600" : "text-gray-600"}`}>
                      {label} {isMissing && <span className="text-orange-500">*required</span>}
                    </label>
                    <input
                      type="text"
                      value={(editedData as any)[key] ?? value ?? ""}
                      onChange={(e) =>
                        setEditedData((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      readOnly={key === "material_number" || key === "distributed_by"}
                      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                        isMissing
                          ? "border-orange-300 focus:ring-orange-400 bg-orange-50"
                          : "border-gray-200 focus:ring-red-500 bg-gray-50"
                      } ${key === "material_number" || key === "distributed_by" ? "opacity-60 cursor-not-allowed" : ""}`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep("upload")}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {generating ? "Generating PDF…" : "Generate Shipper Label"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Done */}
        {step === "done" && result && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm text-center">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Shipper Label Generated</h2>
            <p className="text-sm text-gray-500 mb-1">
              Your PDF has been created and is uploading to Azure Blob Storage.
            </p>
            <p className="text-xs text-gray-400 mb-6 font-mono break-all px-4">{result.blob_path}</p>

            <div className="flex gap-3 justify-center">
              <button
                onClick={handleDownload}
                className="bg-red-600 hover:bg-red-700 text-white font-medium px-6 py-2.5 rounded-lg text-sm transition-colors"
              >
                Download PDF
              </button>
              <button
                onClick={handleReset}
                className="border border-gray-300 text-gray-700 font-medium px-6 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Generate Another
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function FileUploader({
  label,
  description,
  file,
  onChange,
}: {
  label: string;
  description: string;
  file: File | null;
  onChange: (f: File) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <p className="text-xs text-gray-400 mb-2">{description}</p>
      <label className={`flex items-center gap-3 border-2 border-dashed rounded-lg px-4 py-3 cursor-pointer transition-colors ${
        file ? "border-green-400 bg-green-50" : "border-gray-300 hover:border-red-400 hover:bg-red-50"
      }`}>
        <input
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onChange(f);
          }}
        />
        <svg className={`w-5 h-5 flex-shrink-0 ${file ? "text-green-500" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <div className="min-w-0">
          {file ? (
            <>
              <p className="text-sm font-medium text-green-700 truncate">{file.name}</p>
              <p className="text-xs text-green-500">{(file.size / 1024).toFixed(0)} KB — click to change</p>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">Click to upload PDF</p>
              <p className="text-xs text-gray-400">PDF files only, max 50 MB</p>
            </>
          )}
        </div>
      </label>
    </div>
  );
}
