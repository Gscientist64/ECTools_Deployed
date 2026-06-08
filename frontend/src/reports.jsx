// frontend/src/reports.jsx
import React, { useState } from 'react';
import { useToast } from './toasts';
import { useAuth } from './auth';
import { api } from './api';
import { Button, Input, Select, Chip } from './ui';
import { Download, FileText, BarChart3, Calendar, Building, ChevronDown, Check } from 'lucide-react';

// Exact same facilities list from login.jsx
const FACILITIES = [
  "Akamkpa General Hospital",
  "Akani Esuk Health Centre",
  "Akpabuyo St Joseph Hospital",
  "Akpet Central",
  "Anantigha Primary Health Centre",
  "Anderson Primary Health Centre",
  "Aningeje Primary Health Centre",
  "Aya Medical Center",
  "Bakor Medical centre",
  "Calabar General Hospital",
  "Calabar South Family Health Centre",
  "Calabar Women and Children Hospital",
  "County Specialist",
  "Cross River University of Science and Technology (CRUTECH) Medical Centre",
  "Diamond Hill Health Centre",
  "Dr Lawrence Henshaw Memorial Hospital",
  "Eja Memorial",
  "Ekana Medical Center",
  "Ekorinim Health Centre",
  "Ekpo Abasi Primary Health Centre",
  "Ekpri Obutong Health Centre",
  "Emmanuel Infirmiry",
  "Essierebom Primary Health Centre",
  "Faith Foundation Clinic",
  "Goldie Clinic",
  "Henshaw Town Health Post",
  "Hiltop Healthcare Foundation",
  "Holy Family Catholic Hospital",
  "Igbo-Imabana Model PHC",
  "Ikang Primary Health Centre",
  "Ikot Edem Odo Health Centre",
  "Ikot Effiong Otop Comprehensive Health Centre (UCTH Annex)",
  "Ikot Ekpo Health Centre (Ward 10)",
  "Ikot Enebong Health Post",
  "Ishie Health Post",
  "Kasuk Health Centre",
  "Katchuan Iruan Model PHC",
  "Mambo Clinic",
  "Melrose Hospital",
  "Mfamosing Primary Health Center",
  "Mma Efa Health Centre",
  "Mount Zion Medical Centre",
  "Nyahasang Health Centre",
  "Oba Comprehensive Health Centre",
  "Oban Health Centre",
  "Obanliku General Hospital",
  "Obubra General Hospital",
  "Obubra Maternal & Child Health Clinic",
  "Obudu CLinic",
  "Obudu Urban1 PHC",
  "Ogoja Catholic Maternity",
  "Ogoja General Hospital",
  "Ogoja Santa Maria Clinic",
  "Okpoma General Hospital",
  "Okundi Comprehensive Health Centre",
  "Peace medical centre",
  "Police Hospital",
  "Sacred Heart Catholic Hospital",
  "Ugep General Hospital",
  "Ukpem General Hospital",
  "University of Calabar Medical Centre",
  "University of Calabar Teaching Hospital",
  "Wanihem Comprehensive Health Centre",
  "Yala Lutheran Hospital",
  "State Office Team"
];

export function ReportsScreen() {
  const { me } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(false);
  const [report1Data, setReport1Data] = useState({
    startDate: '',
    endDate: '',
    facilities: []
  });

  const [showFacilityDropdown, setShowFacilityDropdown] = useState(false);

  const handleGenerateReport1 = async () => {
    if (!report1Data.startDate || !report1Data.endDate) {
      push('Please select both start and end dates', 'error');
      return;
    }

    setLoading(true);
    try {
      const blob = await api.generateRequestSummaryReport({
        start_date: report1Data.startDate + 'T00:00:00',
        end_date: report1Data.endDate + 'T23:59:59',
        facilities: report1Data.facilities
      });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `request_summary_${report1Data.startDate}_to_${report1Data.endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      
      push('Request summary report generated successfully!', 'success');
    } catch (error) {
      push(`Failed to generate report: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReport2 = async () => {
    setLoading(true);
    try {
      const blob = await api.generateInventoryConsumptionReport();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `inventory_consumption_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      
      push('Inventory consumption report generated successfully!', 'success');
    } catch (error) {
      push(`Failed to generate report: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleFacility = (facility) => {
    setReport1Data(prev => ({
      ...prev,
      facilities: prev.facilities.includes(facility)
        ? prev.facilities.filter(f => f !== facility)
        : [...prev.facilities, facility]
    }));
  };

  const selectAllFacilities = () => {
    setReport1Data(prev => ({
      ...prev,
      facilities: [...FACILITIES]
    }));
  };

  const clearAllFacilities = () => {
    setReport1Data(prev => ({
      ...prev,
      facilities: []
    }));
  };

  const toggleFacilityDropdown = () => {
    setShowFacilityDropdown(!showFacilityDropdown);
  };

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.facility-dropdown')) {
        setShowFacilityDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Reports</h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-1">
            Generate comprehensive reports and export to Excel
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Report 1: Request Summary */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900 rounded-xl">
              <FileText className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                Request Summary Report
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Export tool requests by date range and facilities
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Start Date
                </label>
                <Input
                  type="date"
                  value={report1Data.startDate}
                  onChange={(e) => setReport1Data({ ...report1Data, startDate: e.target.value })}
                  className="text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-700 border-neutral-300 dark:border-neutral-600
                    [&::-webkit-calendar-picker-indicator]:opacity-100 
                    [&::-webkit-calendar-picker-indicator]:invert-0
                    [&::-webkit-calendar-picker-indicator]:dark:invert-100
                    [&::-webkit-calendar-picker-indicator]:hover:opacity-80"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  End Date
                </label>
                <Input
                  type="date"
                  value={report1Data.endDate}
                  onChange={(e) => setReport1Data({ ...report1Data, endDate: e.target.value })}
                  className="text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-700 border-neutral-300 dark:border-neutral-600
                    [&::-webkit-calendar-picker-indicator]:opacity-100 
                    [&::-webkit-calendar-picker-indicator]:invert-0
                    [&::-webkit-calendar-picker-indicator]:dark:invert-100
                    [&::-webkit-calendar-picker-indicator]:hover:opacity-80"
                />
              </div>
            </div>

            <div className="relative facility-dropdown">
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                Facility
              </label>
              
              {/* Facility Dropdown Trigger */}
              <button
                type="button"
                onClick={toggleFacilityDropdown}
                className="w-full flex items-center justify-between px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <span className="truncate">
                  {report1Data.facilities.length === 0 
                    ? 'Select facilities...' 
                    : `${report1Data.facilities.length} facility${report1Data.facilities.length !== 1 ? 's' : ''} selected`
                  }
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showFacilityDropdown ? 'rotate-180' : ''}`} />
              </button>

              {/* Facility Dropdown Menu */}
              {showFacilityDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                  {/* Select All / Clear All Buttons */}
                  <div className="flex border-b border-neutral-200 dark:border-neutral-700">
                    <button
                      type="button"
                      onClick={selectAllFacilities}
                      className="flex-1 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={clearAllFacilities}
                      className="flex-1 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition"
                    >
                      Clear All
                    </button>
                  </div>

                  {/* Facility List */}
                  {FACILITIES.map((facility) => (
                    <label
                      key={facility}
                      className="flex items-center px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-700 cursor-pointer transition"
                    >
                      <input
                        type="checkbox"
                        checked={report1Data.facilities.includes(facility)}
                        onChange={() => toggleFacility(facility)}
                        className="hidden"
                      />
                      <div className={`w-4 h-4 border rounded mr-3 flex items-center justify-center ${
                        report1Data.facilities.includes(facility)
                          ? 'bg-emerald-500 border-emerald-500'
                          : 'border-neutral-300 dark:border-neutral-600'
                      }`}>
                        {report1Data.facilities.includes(facility) && (
                          <Check className="h-3 w-3 text-white" />
                        )}
                      </div>
                      <span className="text-sm text-neutral-900 dark:text-neutral-100 flex-1 text-left">
                        {facility}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {/* Selected Facilities Chips */}
              {report1Data.facilities.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {report1Data.facilities.map((facility) => (
                    <div
                      key={facility}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-full text-xs"
                    >
                      <span>{facility}</span>
                      <button
                        type="button"
                        onClick={() => toggleFacility(facility)}
                        className="hover:text-emerald-900 dark:hover:text-emerald-100 text-xs font-bold"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={handleGenerateReport1}
              disabled={loading || !report1Data.startDate || !report1Data.endDate}
              className="w-full"
            >
              <Download className="h-4 w-4" />
              {loading ? 'Generating...' : 'Generate Request Summary'}
            </Button>
          </div>
        </div>

        {/* Report 2: Inventory Consumption */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-xl">
              <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
                Inventory Consumption Report
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Detailed inventory report with consumption, supply, distribution, and count data for all tools
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-neutral-50 dark:bg-neutral-700 rounded-xl p-4">
              <h4 className="font-medium text-sm text-neutral-900 dark:text-neutral-100 mb-2">
                Report Includes:
              </h4>
              <ul className="text-xs text-neutral-600 dark:text-neutral-400 space-y-1">
                <li>• Tool Name, Category, Facilities with Stock</li>
                <li>• Opening Balance, Qty Supplied, Qty Received</li>
                <li>• Qty Distributed, Qty from Receipts</li>
                <li>• Current Facility Stock, Master Stock</li>
                <li>• Total/Approved/Pending Requests</li>
                <li>• Qty Utilized, Physical Count, Discrepancy</li>
                <li>• Export to Excel with auto-fit columns</li>
              </ul>
            </div>
            <Button
              onClick={handleGenerateReport2}
              disabled={loading}
              variant="outline"
              className="w-full"
            >
              <Download className="h-4 w-4" />
              {loading ? 'Generating...' : 'Generate Inventory Report'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}