import React, { useMemo, useState } from "react";
import { api } from "./api";
import { useToast } from "./toasts";
import { BarChart3, Calendar, Upload, Building2, Clock, AlertCircle } from "lucide-react";
import { Button, Select, Input } from "./ui";

const PERIODS = [
  { value: "30", label: "1 Month" },
  { value: "90", label: "3 Months" },
  { value: "180", label: "6 Months" },
  { value: "365", label: "1 Year" },
];

const FORMS = [
  { value: "pharmacy", label: "Pharmacy Order Form" },
  { value: "viral_load", label: "Viral Load Order & Request Form (Coming soon)" },
  { value: "hts", label: "HTS Client Intake Form (Coming soon)" },
];

export default function ToolsForecastScreen() {
  const { push } = useToast();

  const [formType, setFormType] = useState("pharmacy");
  const [periodDays, setPeriodDays] = useState("30");
  const [refillsPerBooklet, setRefillsPerBooklet] = useState("50");

  const [file, setFile] = useState(null);
  const [facility, setFacility] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorDetails, setErrorDetails] = useState(null);

  const [result, setResult] = useState(null);

  const facilities = useMemo(() => {
    const list = result?.facilities || [];
    return list.map((f) => ({ value: f, label: f }));
  }, [result]);

  const runForecast = async () => {
    if (formType !== "pharmacy") {
      push("Coming soon. For now, only Pharmacy Order Form is implemented.", "error");
      return;
    }
    if (!file) {
      push("Please upload a RADET Excel file first.", "error");
      return;
    }

    // Validate file
    const validTypes = [".xlsx", ".xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
    const fileExt = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    const fileType = file.type;
    
    if (!validTypes.includes(fileExt) && !validTypes.includes(fileType)) {
      push("Invalid file type. Please upload an Excel file (.xlsx, .xls)", "error");
      return;
    }

    // Validate file size (20MB max)
    if (file.size > 20 * 1024 * 1024) {
      push("File too large. Maximum size is 20MB.", "error");
      return;
    }

    setLoading(true);
    setErrorDetails(null);
    
    try {
      // FIXED: The API expects snake_case parameter names
      const data = await api.forecastPharmacy({
        file,
        periodDays: periodDays,  // Frontend camelCase, backend accepts both
        facility,
        refillsPerBooklet: refillsPerBooklet,  // Frontend camelCase, backend accepts both
      });
      
      setResult(data);
      push("Forecast generated successfully!", "success");
    } catch (e) {
      console.error("Forecast error:", e);
      setErrorDetails(e.message || "Unknown error");
      
      // Try to parse JSON error if available
      let errorMessage = "Failed to generate forecast";
      try {
        const errorObj = JSON.parse(e.message);
        if (errorObj.error) {
          errorMessage = errorObj.error;
          if (errorObj.details) {
            setErrorDetails(JSON.stringify(errorObj.details, null, 2));
          }
        }
      } catch {
        errorMessage = e.message || "Failed to generate forecast";
      }
      
      push(errorMessage, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);
    setResult(null);
    setErrorDetails(null);
    if (selectedFile) {
      setFacility(""); // Reset facility filter on new file
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            Tools Forecast
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-1">
            Predict upcoming pharmacy needs per facility based on RADET refill timing.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4">
            <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1 block">
              Forecast Type
            </label>
            <Select
              value={formType}
              onChange={setFormType}
              options={FORMS}
              placeholder="Select forecast type"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1 block">
              Forecast Period
            </label>
            <Select
              value={periodDays}
              onChange={setPeriodDays}
              options={PERIODS}
              placeholder="Select period"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1 block">
              Refills per Booklet
            </label>
            <Input
              type="number"
              min="1"
              max="1000"
              value={refillsPerBooklet}
              onChange={(e) => {
                const val = e.target.value.replace(/[^\d]/g, "");
                setRefillsPerBooklet(val || "50");
              }}
              placeholder="50"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1 block">
              Upload RADET File (.xlsx)
            </label>
            <div className="relative">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-300"
                disabled={loading}
              />
              {file && (
                <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                  ✓ Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </div>
              )}
            </div>
          </div>

          <div className="md:col-span-6">
            <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1 block">
              Filter by Facility (optional)
            </label>
            <Select
              value={facility}
              onChange={setFacility}
              options={[{ value: "", label: "All facilities" }, ...(facilities || [])]}
              placeholder="All facilities"
              isDisabled={!result || loading}
            />
            {result && !facility && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                {result.facilities?.length || 0} facilities available
              </div>
            )}
          </div>

          <div className="md:col-span-6 flex justify-end gap-2">
            <Button 
              onClick={runForecast} 
              disabled={loading || !file}
              className="min-w-[200px]"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Generate Forecast
                </>
              )}
            </Button>
          </div>
        </div>

        {formType !== "pharmacy" && (
          <div className="mt-4 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
            <span className="font-semibold">Note:</span> Only <b>Pharmacy Order Form</b> is active for now. Other forms are coming soon.
          </div>
        )}

        {errorDetails && (
          <div className="mt-4 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">Error Details:</div>
                <pre className="mt-1 text-xs whitespace-pre-wrap overflow-auto max-h-40">
                  {errorDetails}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5">
        {!result ? (
          <div className="text-center py-10 text-neutral-600 dark:text-neutral-400">
            <BarChart3 className="h-12 w-12 mx-auto opacity-30 mb-3" />
            <p>Upload a RADET Excel file and generate a forecast to see results here.</p>
            <p className="text-sm mt-2">Supported formats: .xlsx, .xls (max 20MB)</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-800 flex items-center justify-center">
                    <Calendar className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">Forecast Period</div>
                    <div className="text-lg font-semibold">{result.period_days} days</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-500">
                      {result.from} to {result.to}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 border border-green-100 dark:border-green-800">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-800 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">Refills per Booklet</div>
                    <div className="text-lg font-semibold">{result.refills_per_booklet}</div>
                  </div>
                </div>
              </div>

              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 border border-purple-100 dark:border-purple-800">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-800 flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">Total Expected Refills</div>
                    <div className="text-lg font-semibold">{result.total_expected_refills}</div>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-100 dark:border-amber-800">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-800 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">Total Booklets Needed</div>
                    <div className="text-lg font-semibold">{result.total_recommended_booklets}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Results Table */}
            {(result.rows || []).length === 0 ? (
              <div className="text-center py-10 text-neutral-600 dark:text-neutral-400">
                <p>No refills predicted in this period for the selected filters.</p>
                {result.summary && (
                  <div className="text-sm mt-3 space-y-1">
                    <p>Total records processed: {result.summary.total_records}</p>
                    <p>Records within forecast period: {result.summary.filtered_records}</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Forecast by Facility</h3>
                  <div className="text-sm text-neutral-500">
                    {result.rows.length} facility{result.rows.length !== 1 ? 's' : ''}
                    {result.facility_filter && ` (filtered: ${result.facility_filter})`}
                  </div>
                </div>
                
                <div className="overflow-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 dark:bg-neutral-900/30">
                      <tr className="border-b border-neutral-200 dark:border-neutral-700">
                        <th className="text-left py-3 px-4 font-semibold">Facility Name</th>
                        <th className="text-right py-3 px-4 font-semibold">Expected Refills</th>
                        <th className="text-right py-3 px-4 font-semibold">Recommended Booklets</th>
                        <th className="text-right py-3 px-4 font-semibold">Refills/Booklet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, i) => (
                        <tr
                          key={`${r.facility}-${i}`}
                          className="border-b border-neutral-100 dark:border-neutral-700 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-700/30"
                        >
                          <td className="py-3 px-4 font-medium">{r.facility}</td>
                          <td className="py-3 px-4 text-right">
                            <span className="font-semibold">{r.expected_refills}</span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className={`font-semibold ${
                              r.recommended_booklets > 20 
                                ? 'text-red-600 dark:text-red-400' 
                                : r.recommended_booklets > 10 
                                ? 'text-amber-600 dark:text-amber-400' 
                                : 'text-green-600 dark:text-green-400'
                            }`}>
                              {r.recommended_booklets}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-neutral-500">
                            {r.refills_per_booklet}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {result.rows.length > 5 && (
                      <tfoot className="bg-neutral-50 dark:bg-neutral-900/30">
                        <tr className="border-t border-neutral-200 dark:border-neutral-700">
                          <td className="py-3 px-4 font-semibold">Total</td>
                          <td className="py-3 px-4 text-right font-semibold">
                            {result.total_expected_refills}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold">
                            {result.total_recommended_booklets}
                          </td>
                          <td className="py-3 px-4 text-right text-neutral-500">—</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                
                {result.summary && (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 pt-2 space-y-1">
                    <p>• Total records processed: {result.summary.total_records}</p>
                    <p>• Records within forecast period: {result.summary.filtered_records}</p>
                    <p>• Unique facilities: {result.summary.facilities_count}</p>
                    <p>• Forecast includes {result.summary.forecast_facilities} facilities with expected refills</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}