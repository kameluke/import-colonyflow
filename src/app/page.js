"use client";

import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Download, CheckCircle, AlertTriangle, FileJson, ArrowRight, Settings } from 'lucide-react';

const generateId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
};

export default function Home() {
    const [existingDB, setExistingDB] = useState(null);
    const [csvData, setCsvData] = useState([]);
    const [processedMice, setProcessedMice] = useState([]);
    const [newCages, setNewCages] = useState([]);
    const [errors, setErrors] = useState([]);
    const [step, setStep] = useState(1);
    const [mergedDB, setMergedDB] = useState(null);

    const checkExistingDB = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);
                if (json.mice && json.cages) {
                    setExistingDB(json);
                } else {
                    alert('Invalid db.json format. Needs to have "mice" and "cages" keys.');
                }
            } catch (err) {
                alert('Error parsing JSON');
            }
        };
        reader.readAsText(file);
    };

    const handleCsvUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                setCsvData(results.data);
                processImport(results.data);
                setStep(2);
            },
            error: (err) => {
                alert('Error parsing CSV: ' + err.message);
            }
        });
    };

    const processImport = (data) => {
        const errs = [];
        const mice = [];
        let cagesCreated = [];
        
        let dbReference = existingDB || { mice: [], cages: [], strains: [], matings: [], rooms: [] };
        
        // Ensure "Imported" room exists
        if (!dbReference.rooms?.find(r => r.name === 'Imported')) {
            dbReference = { ...dbReference, rooms: [...(dbReference.rooms || []), { id: generateId(), name: 'Imported', description: 'Auto-created for imported CSVs' }] };
        }

        // 1. First pass: Create Basic Mouse Records mapping Tag -> internal ID
        const tagToIdMap = new Map(); // Fast lookup by tag
        
        // Add existing mice to lookup map
        dbReference.mice.forEach(m => {
            if (m.tag) tagToIdMap.set(String(m.tag).trim(), m.id);
        });

        // Generate IDs for new ones
        data.forEach((row, i) => {
            const rowNum = i + 2; // For human readable line numbers (1 is header)
            
            const tag = row['Tag']?.toString().trim();
            if (!tag) {
                errs.push(`Row ${rowNum}: Mouse missing 'Tag'. This row will be ignored or might break parenting relationships.`);
            }

            // Normalization
            let sex = row['Sex']?.toString().trim().toLowerCase();
            if (['m', 'male', '♂', 'オス', '男'].includes(sex)) sex = '♂';
            else if (['f', 'female', '♀', 'メス', '女'].includes(sex)) sex = '♀';
            else sex = 'Unknown';

            let status = row['Status']?.toString().trim();
            if (!status || status === '') status = 'Stock';
            
            // Format dates simply for now
            let dob = row['DOB']?.toString().trim() || '';

            const id = generateId();
            if (tag) tagToIdMap.set(tag, id);

            const record = {
                id,
                tag: tag || '',
                sex,
                dob,
                genotype: row['Genotype']?.toString().trim() || '',
                line: row['Mouseline']?.toString().trim() || 'Imported Line',
                status,
                comment: row['Comment']?.toString().trim() || 'Imported from CSV',
                endDate: row['End Date']?.toString().trim() || '',
                _sireTagRaw: row['Sire Tag']?.toString().trim(),
                _damTagRaw: row['Dam Tag']?.toString().trim(),
                cageTag: row['Cage Tag']?.toString().trim() || ''
            };
            mice.push(record);
        });

        // Extract and deduplicate lines (Strains)
        const uniqueLines = [...new Set(mice.map(m => m.line).filter(Boolean))];
        const currentLines = new Set(dbReference.strains?.map(s => s.name) || []);
        uniqueLines.forEach(line => {
            if (!currentLines.has(line)) {
                dbReference.strains = [...(dbReference.strains || []), { id: generateId(), name: line, background: 'Unknown', genotypes: '' }];
            }
        });

        // Extract and deduplicate Cage Tags
        const currentCageTags = new Set(dbReference.cages?.map(c => c.tag) || []);
        const importedCageTags = new Set(mice.map(m => m.cageTag).filter(Boolean));
        
        importedCageTags.forEach(ctag => {
            if (!currentCageTags.has(ctag)) {
                cagesCreated.push({
                    id: generateId(),
                    tag: ctag,
                    room: 'Imported',
                    row: '',
                    col: '',
                    createdAt: new Date().toISOString()
                });
            }
        });

        // 2. Second pass: Link Parents using the Tag map
        mice.forEach(m => {
            if (m._sireTagRaw) {
                const sId = tagToIdMap.get(m._sireTagRaw);
                if (sId) {
                    m.sireId = sId;
                } else {
                    errs.push(`Mouse ${m.tag}: Sire Tag '${m._sireTagRaw}' not found in current CSV or Database.`);
                }
            }
            if (m._damTagRaw) {
                const dId = tagToIdMap.get(m._damTagRaw);
                if (dId) {
                    m.damId = dId;
                } else {
                    errs.push(`Mouse ${m.tag}: Dam Tag '${m._damTagRaw}' not found in current CSV or Database.`);
                }
            }
            // cleanup temp properties
            delete m._sireTagRaw;
            delete m._damTagRaw;
        });

        setErrors(errs);
        setProcessedMice(mice);
        setNewCages(cagesCreated);

        // Prepare the final merged
        setMergedDB({
            ...dbReference,
            mice: [...(dbReference.mice || []), ...mice],
            cages: [...(dbReference.cages || []), ...cagesCreated],
        });
    };

    const downloadTemplate = () => {
        const headers = ["Tag", "Sex", "DOB", "Genotype", "Mouseline", "Sire Tag", "Dam Tag", "Status", "Cage Tag", "End Date", "Comment"];
        const dummyRow = ["100X", "Male", "2023-01-01", "+/-", "C57BL/6", "10A", "11B", "Stock", "A-1", "", "Sample imported mouse"];
        const csvContent = headers.join(",") + "\n" + dummyRow.join(",");
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", "Import_Template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const downloadFinalDB = () => {
        if (!mergedDB) return;
        const blob = new Blob([JSON.stringify(mergedDB, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", "db_migrated.json");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-800">
            <div className="max-w-4xl mx-auto space-y-6">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                            <Upload className="text-blue-600" />
                            ColonyFlow Import Tool
                        </h1>
                        <p className="text-slate-500 mt-2">Migrate your Excel or CSV data seamlessly to ColonyFlow.</p>
                    </div>
                </header>

                {/* Step 1: Pre-requisites & Optional State */}
                <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-6 transition-opacity ${step !== 1 ? 'opacity-50' : ''}`}>
                    <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                        <span className="bg-slate-100 text-slate-600 rounded-full w-8 h-8 flex items-center justify-center text-sm">1</span>
                        Prepare Environment
                    </h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-50 p-5 rounded-xl border border-slate-100">
                            <h3 className="font-semibold mb-2 flex items-center gap-2 text-slate-700">
                                <Settings size={18} /> (Optional) Existing Database
                            </h3>
                            <p className="text-sm text-slate-500 mb-4">
                                If you already have data in ColonyFlow, upload your current `db.json` here so parent relationships and lines can be resolved correctly against your existing mice.
                            </p>
                            <input 
                                type="file" 
                                accept=".json" 
                                onChange={checkExistingDB}
                                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                            />
                            {existingDB && (
                                <div className="mt-3 text-sm text-green-600 flex items-center gap-1 font-medium">
                                    <CheckCircle size={16} /> Loaded: {existingDB.mice?.length || 0} Mice, {existingDB.cages?.length || 0} Cages
                                </div>
                            )}
                        </div>

                        <div className="bg-blue-50/50 p-5 rounded-xl border border-blue-100">
                            <h3 className="font-semibold mb-2 flex items-center gap-2 text-slate-700">
                                <Download size={18} /> Download CSV Template
                            </h3>
                            <p className="text-sm text-slate-500 mb-4">
                                Please format your Excel data to match this template. Save it as a CSV file to proceed to the next step.
                            </p>
                            <button 
                                onClick={downloadTemplate}
                                className="bg-white hover:bg-slate-50 text-blue-700 font-semibold py-2 px-4 border border-slate-200 rounded-xl shadow-sm flex items-center gap-2 transition-colors text-sm"
                            >
                                <Download size={16} /> Download Template
                            </button>
                        </div>
                    </div>
                </div>

                {/* Step 2: Upload Target CSV */}
                <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-6 transition-opacity ${step === 3 ? 'opacity-50' : ''}`}>
                    <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                        <span className={`rounded-full w-8 h-8 flex items-center justify-center text-sm ${step >= 2 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>2</span>
                        <span className={step >= 2 ? 'text-slate-800' : 'text-slate-400'}>Upload Filled CSV</span>
                    </h2>
                    
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center bg-slate-50/50">
                        <input 
                            type="file" 
                            accept=".csv" 
                            onChange={handleCsvUpload}
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer mx-auto max-w-sm"
                        />
                        <p className="text-sm text-slate-400 mt-2">Only .csv files supported</p>
                    </div>
                </div>

                {/* Step 3: Preview & Merge */}
                {step >= 2 && csvData.length > 0 && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <h2 className="text-xl font-bold flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <span className="bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm">3</span>
                                Review & Confirm
                            </div>
                            <button 
                                onClick={downloadFinalDB}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-xl shadow-sm flex items-center gap-2 transition-colors"
                            >
                                <FileJson size={18} /> Generate new db.json
                            </button>
                        </h2>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="p-4 bg-green-50 border border-green-100 rounded-xl">
                                <div className="text-sm font-semibold text-green-800 uppercase tracking-wider mb-1">Mice Extracted</div>
                                <div className="text-3xl font-black text-green-600">{processedMice.length}</div>
                            </div>
                            <div className="p-4 bg-purple-50 border border-purple-100 rounded-xl">
                                <div className="text-sm font-semibold text-purple-800 uppercase tracking-wider mb-1">New Cages Auto-Created</div>
                                <div className="text-3xl font-black text-purple-600">{newCages.length}</div>
                            </div>
                        </div>

                        {errors.length > 0 && (
                            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 overflow-y-auto max-h-48">
                                <h3 className="font-bold text-amber-800 flex items-center gap-2 mb-2">
                                    <AlertTriangle size={18} /> Warnings / Issues
                                </h3>
                                <ul className="list-disc list-inside text-sm text-amber-700 space-y-1">
                                    {errors.map((e, i) => <li key={i}>{e}</li>)}
                                </ul>
                            </div>
                        )}

                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-700">Data Preview (First 10 records)</div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs uppercase tracking-wider">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold">Tag</th>
                                            <th className="px-4 py-3 font-semibold">Sex</th>
                                            <th className="px-4 py-3 font-semibold">Line</th>
                                            <th className="px-4 py-3 font-semibold">DOB</th>
                                            <th className="px-4 py-3 font-semibold">Sire ID→Internal</th>
                                            <th className="px-4 py-3 font-semibold">Dam ID→Internal</th>
                                            <th className="px-4 py-3 font-semibold">Target Cage</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {processedMice.slice(0, 10).map((m, i) => (
                                            <tr key={i} className="hover:bg-slate-50">
                                                <td className="px-4 py-3 font-semibold text-slate-800">{m.tag}</td>
                                                <td className="px-4 py-3 text-slate-600">{m.sex}</td>
                                                <td className="px-4 py-3 text-slate-600">{m.line}</td>
                                                <td className="px-4 py-3 text-slate-600">{m.dob}</td>
                                                <td className={m.sireId ? 'px-4 py-3 text-green-600' : 'px-4 py-3 text-slate-400'}>{m.sireId ? '✓ Linked' : '-'}</td>
                                                <td className={m.damId ? 'px-4 py-3 text-green-600' : 'px-4 py-3 text-slate-400'}>{m.damId ? '✓ Linked' : '-'}</td>
                                                <td className="px-4 py-3">
                                                    <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs border border-slate-200">{m.cageTag || 'No Cage'}</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="mt-8 bg-slate-900 rounded-xl p-6 text-white text-center">
                            <h3 className="text-lg font-bold mb-2">Ready to switch to ColonyFlow?</h3>
                            <p className="text-slate-300 text-sm max-w-lg mx-auto mb-6">
                                Click "Generate new db.json" above. Then move the downloaded file to your <b>ColonyFlow</b> backend/data folder and replace your old db.json.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
