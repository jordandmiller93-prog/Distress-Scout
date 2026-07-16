import React, { useState, useEffect, useRef } from 'react';
import { Map, MapPin, AlertCircle, Download, Settings, LogOut, BarChart3, Zap, Home, X } from 'lucide-react';

// Mock data for demo
const mockDistressIndicators = {
  boarded_windows: { score: 8, risk: 'high' },
  overgrown_yard: { score: 6, risk: 'medium' },
  roof_damage: { score: 8, risk: 'high' },
  peeling_paint: { score: 4, risk: 'low' },
  abandoned_sign: { score: 9, risk: 'high' },
  broken_fence: { score: 3, risk: 'low' },
  boarded_door: { score: 8, risk: 'high' },
  junk_piles: { score: 7, risk: 'medium' }
};

const mockOwnerData = {
  '123 Main St': { owner: 'John Smith', phone: '555-0101', email: 'john@example.com', equity: '$85K' },
  '456 Oak Ave': { owner: 'LLC Estate Holdings', phone: '555-0102', email: 'admin@estateholdings.com', equity: '$120K' },
  '789 Elm St': { owner: 'Mary Johnson', phone: '555-0103', email: 'mary@example.com', equity: '$45K' }
};

export default function DistressScoutApp() {
  const [user, setUser] = useState(null);
  const [leads, setLeads] = useState([]);
  const [view, setView] = useState('login'); // login, dashboard, scan, details
  const [selectedLead, setSelectedLead] = useState(null);
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [stats, setStats] = useState({ scansThisMonth: 0, leadsGenerated: 0, contactsFound: 0 });
  const [uploadedFile, setUploadedFile] = useState(null);
  const [scanResults, setScanResults] = useState([]);
  const mapRef = useRef(null);

  // Freemium limits
  const limits = {
    free: { scansPerMonth: 20, storageLeads: 50, exportLimit: 5 },
    premium: { scansPerMonth: 500, storageLeads: 5000, exportLimit: 'unlimited' }
  };

  const handleLogin = (email) => {
    setUser({ email, tier: 'free', joinedDate: new Date().toLocaleDateString() });
    setView('dashboard');
    // Initialize mock leads for demo
    setLeads([
      {
        id: 1,
        address: '123 Main St',
        lat: 40.7128,
        lng: -74.0060,
        distressScore: 8.2,
        indicators: ['boarded_windows', 'roof_damage'],
        owner: mockOwnerData['123 Main St'],
        dateFound: new Date().toLocaleDateString(),
        status: 'new'
      },
      {
        id: 2,
        address: '456 Oak Ave',
        lat: 40.7580,
        lng: -73.9855,
        distressScore: 6.5,
        indicators: ['overgrown_yard', 'peeling_paint'],
        owner: mockOwnerData['456 Oak Ave'],
        dateFound: new Date().toLocaleDateString(),
        status: 'contacted'
      }
    ]);
    setStats({ scansThisMonth: 12, leadsGenerated: 2, contactsFound: 1 });
  };

  const handleAnalyzeImage = async () => {
    if (!uploadedFile) return;

    // Simulate distress detection
    const detectedIndicators = Object.keys(mockDistressIndicators).slice(0, Math.floor(Math.random() * 3) + 2);
    const distressScore = detectedIndicators.reduce((sum, ind) => sum + mockDistressIndicators[ind].score, 0) / detectedIndicators.length;

    const newScan = {
      id: leads.length + 1,
      address: `Property #${leads.length + 1}`,
      distressScore: parseFloat(distressScore.toFixed(1)),
      indicators: detectedIndicators,
      imageFile: uploadedFile.name,
      timestamp: new Date().toLocaleTimeString(),
      status: 'review'
    };

    setScanResults([...scanResults, newScan]);
    setUploadedFile(null);
  };

  const handleAddToLeads = (scan) => {
    const newLead = {
      ...scan,
      lat: 40.7128 + Math.random() * 0.5,
      lng: -74.0060 + Math.random() * 0.5,
      owner: {
        owner: 'Owner Info Pending',
        phone: 'Processing...',
        email: 'Pending',
        equity: 'Analyzing...'
      },
      dateFound: new Date().toLocaleDateString(),
      status: 'new'
    };

    setLeads([...leads, newLead]);
    setScanResults(scanResults.filter(s => s.id !== scan.id));
    setStats({ ...stats, leadsGenerated: stats.leadsGenerated + 1, scansThisMonth: stats.scansThisMonth + 1 });
  };

  const handleExport = () => {
    if (subscriptionTier === 'free' && stats.leadsGenerated > limits.free.exportLimit) {
      alert(`Free tier limited to ${limits.free.exportLimit} exports/month`);
      return;
    }

    const csv = [
      ['Address', 'Distress Score', 'Indicators', 'Owner', 'Phone', 'Equity', 'Status'].join(','),
      ...leads.map(lead => [
        lead.address,
        lead.distressScore,
        lead.indicators.join(';'),
        lead.owner?.owner || 'N/A',
        lead.owner?.phone || 'N/A',
        lead.owner?.equity || 'N/A',
        lead.status
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `distress-scout-leads-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleUpgrade = () => {
    alert('Redirecting to payment...\n\nIn production: Stripe checkout integration here\n\nMonthly: $29\nYearly: $290 (save $58)');
  };

  // LOGIN VIEW
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-8">
          <div className="flex items-center justify-center mb-8">
            <MapPin className="w-8 h-8 text-blue-600 mr-2" />
            <h1 className="text-3xl font-bold text-gray-900">Distress Scout</h1>
          </div>
          
          <p className="text-center text-gray-600 mb-8">AI-Powered Property Distress Detection for RE Investors</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                placeholder="investor@example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                defaultValue="demo@investor.com"
              />
            </div>
            
            <button
              onClick={(e) => handleLogin(e.target.previousElementSibling.querySelector('input').value)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition"
            >
              Start Free Trial
            </button>
            
            <p className="text-center text-xs text-gray-500 mt-4">Free: 20 scans/month • Unlimited list viewing</p>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="font-bold text-gray-900 mb-4">Features:</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-center"><Zap className="w-4 h-4 mr-2 text-yellow-500" /> AI Distress Detection</li>
              <li className="flex items-center"><MapPin className="w-4 h-4 mr-2 text-blue-600" /> Location Mapping</li>
              <li className="flex items-center"><Home className="w-4 h-4 mr-2 text-green-600" /> Owner Lookup</li>
              <li className="flex items-center"><Download className="w-4 h-4 mr-2 text-purple-600" /> CSV Export</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // DASHBOARD VIEW
  if (view === 'dashboard') {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <div className="flex items-center">
              <MapPin className="w-6 h-6 text-blue-600 mr-2" />
              <h1 className="text-2xl font-bold text-gray-900">Distress Scout</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                {user.email} • <span className="font-bold text-blue-600">{subscriptionTier.toUpperCase()}</span>
              </span>
              <button onClick={() => setView('settings')} className="p-2 hover:bg-gray-100 rounded"><Settings className="w-5 h-5" /></button>
              <button onClick={() => { setUser(null); setView('login'); }} className="p-2 hover:bg-gray-100 rounded"><LogOut className="w-5 h-5" /></button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600 text-sm">Scans This Month</p>
                  <p className="text-3xl font-bold text-gray-900">{stats.scansThisMonth}</p>
                  <p className="text-xs text-gray-500 mt-1">of {limits[subscriptionTier].scansPerMonth}</p>
                </div>
                <Zap className="w-10 h-10 text-yellow-500 opacity-20" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600 text-sm">Leads Generated</p>
                  <p className="text-3xl font-bold text-gray-900">{leads.length}</p>
                  <p className="text-xs text-gray-500 mt-1">stored in list</p>
                </div>
                <MapPin className="w-10 h-10 text-blue-600 opacity-20" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600 text-sm">Contacts Found</p>
                  <p className="text-3xl font-bold text-gray-900">{stats.contactsFound}</p>
                  <p className="text-xs text-gray-500 mt-1">skip traced</p>
                </div>
                <Home className="w-10 h-10 text-green-600 opacity-20" />
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-lg shadow p-6 text-white cursor-pointer hover:shadow-lg transition" onClick={handleUpgrade}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-sm">Current Plan</p>
                  <p className="text-2xl font-bold">Free</p>
                  <p className="text-xs text-purple-200 mt-1">upgrade to premium</p>
                </div>
                <Zap className="w-10 h-10 opacity-30" />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h2>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => setView('scan')}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition flex items-center"
              >
                <MapPin className="w-4 h-4 mr-2" /> New Scan
              </button>
              <button
                onClick={handleExport}
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition flex items-center"
              >
                <Download className="w-4 h-4 mr-2" /> Export CSV
              </button>
              <button
                onClick={handleUpgrade}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-6 rounded-lg transition flex items-center"
              >
                <Zap className="w-4 h-4 mr-2" /> Upgrade to Premium
              </button>
            </div>
          </div>

          {/* Leads List */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Your Lead List ({leads.length})</h2>
            </div>
            
            {leads.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">No leads yet. Start scanning to build your list.</p>
                <button
                  onClick={() => setView('scan')}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition"
                >
                  Start Scanning
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-700">Address</th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-700">Score</th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-700">Owner</th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-700">Phone</th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-700">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-700">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr key={lead.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-6 py-4 font-medium text-gray-900">{lead.address}</td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                            lead.distressScore >= 7 ? 'bg-red-100 text-red-800' :
                            lead.distressScore >= 5 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {lead.distressScore}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">{lead.owner?.owner}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{lead.owner?.phone}</td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded text-xs font-bold ${
                            lead.status === 'new' ? 'bg-blue-100 text-blue-800' :
                            lead.status === 'contacted' ? 'bg-purple-100 text-purple-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {lead.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => { setSelectedLead(lead); setView('details'); }}
                            className="text-blue-600 hover:text-blue-900 text-sm font-bold"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // SCAN VIEW
  if (view === 'scan') {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <button onClick={() => setView('dashboard')} className="text-gray-600 hover:text-gray-900 font-bold">← Back</button>
            <h1 className="text-2xl font-bold text-gray-900">New Scan</h1>
            <div className="w-20"></div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white rounded-lg shadow p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Upload Property Photo</h2>
            
            <div className="border-2 border-dashed border-blue-300 rounded-lg p-12 text-center mb-8 cursor-pointer hover:border-blue-500 transition"
              onClick={() => document.getElementById('fileInput').click()}
            >
              <MapPin className="w-12 h-12 text-blue-600 mx-auto mb-4" />
              <p className="text-gray-900 font-bold mb-2">Click to upload or drag and drop</p>
              <p className="text-gray-600 text-sm">PNG, JPG, GIF up to 10MB</p>
              <input
                id="fileInput"
                type="file"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files[0]) {
                    setUploadedFile(e.target.files[0]);
                  }
                }}
              />
            </div>

            {uploadedFile && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-gray-700">
                  <span className="font-bold">File selected:</span> {uploadedFile.name}
                </p>
              </div>
            )}

            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Property Address (Optional)</label>
                <input
                  type="text"
                  placeholder="123 Main St, New York, NY 10001"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Latitude</label>
                  <input
                    type="text"
                    placeholder="40.7128"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Longitude</label>
                  <input
                    type="text"
                    placeholder="-74.0060"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleAnalyzeImage}
              disabled={!uploadedFile}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition"
            >
              Analyze Photo for Distress
            </button>
          </div>

          {/* Scan Results */}
          {scanResults.length > 0 && (
            <div className="bg-white rounded-lg shadow p-8 mt-8">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Analysis Results</h2>
              {scanResults.map((scan) => (
                <div key={scan.id} className="border border-gray-200 rounded-lg p-6 mb-4">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Distress Score: <span className="text-red-600">{scan.distressScore}</span>/10</h3>
                      <p className="text-sm text-gray-600 mt-1">{scan.imageFile}</p>
                    </div>
                    <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full font-bold">HIGH PRIORITY</span>
                  </div>

                  <div className="mb-4">
                    <h4 className="font-bold text-gray-900 mb-2">Detected Issues:</h4>
                    <div className="flex flex-wrap gap-2">
                      {scan.indicators.map((ind) => (
                        <span key={ind} className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded text-sm">
                          {ind.replace(/_/g, ' ')} ({mockDistressIndicators[ind].score}/10)
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={() => handleAddToLeads(scan)}
                      className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition"
                    >
                      Add to Lead List
                    </button>
                    <button
                      onClick={() => setScanResults(scanResults.filter(s => s.id !== scan.id))}
                      className="bg-gray-300 hover:bg-gray-400 text-gray-900 font-bold py-2 px-6 rounded-lg transition"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  // DETAILS VIEW
  if (view === 'details' && selectedLead) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <button onClick={() => setView('dashboard')} className="text-gray-600 hover:text-gray-900 font-bold">← Back</button>
            <h1 className="text-2xl font-bold text-gray-900">Lead Details</h1>
            <div className="w-20"></div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Property Info */}
            <div className="md:col-span-2 space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">{selectedLead.address}</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-gray-600 text-sm">Distress Score</p>
                    <p className="text-3xl font-bold text-red-600">{selectedLead.distressScore}</p>
                  </div>
                  <div>
                    <p className="text-gray-600 text-sm">Status</p>
                    <p className="text-lg font-bold text-blue-600 capitalize">{selectedLead.status}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Detected Issues</h3>
                <div className="space-y-3">
                  {selectedLead.indicators.map((ind) => (
                    <div key={ind} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                      <span className="font-medium text-gray-900">{ind.replace(/_/g, ' ')}</span>
                      <span className={`font-bold ${
                        mockDistressIndicators[ind].risk === 'high' ? 'text-red-600' :
                        mockDistressIndicators[ind].risk === 'medium' ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {mockDistressIndicators[ind].score}/10
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Owner Info Card */}
            <div className="bg-white rounded-lg shadow p-6 h-fit">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Owner Information</h3>
              
              <div className="space-y-4">
                <div>
                  <p className="text-gray-600 text-sm">Owner Name</p>
                  <p className="font-bold text-gray-900">{selectedLead.owner?.owner}</p>
                </div>

                <div>
                  <p className="text-gray-600 text-sm">Phone</p>
                  <p className="font-bold text-gray-900 font-mono">{selectedLead.owner?.phone}</p>
                </div>

                <div>
                  <p className="text-gray-600 text-sm">Email</p>
                  <p className="font-bold text-gray-900 text-sm">{selectedLead.owner?.email}</p>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <p className="text-gray-600 text-sm">Estimated Equity</p>
                  <p className="font-bold text-green-600 text-lg">{selectedLead.owner?.equity}</p>
                </div>

                <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition">
                  Call Owner
                </button>

                <button className="w-full bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold py-2 px-4 rounded-lg transition">
                  Send Email
                </button>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-xs text-gray-500 mb-2">Found: {selectedLead.dateFound}</p>
                <select
                  defaultValue={selectedLead.status}
                  onChange={(e) => {
                    const updatedLeads = leads.map(l => 
                      l.id === selectedLead.id ? { ...l, status: e.target.value } : l
                    );
                    setLeads(updatedLeads);
                    setSelectedLead({ ...selectedLead, status: e.target.value });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="negotiating">Negotiating</option>
                  <option value="deal">Deal!</option>
                </select>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // SETTINGS VIEW
  if (view === 'settings') {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <button onClick={() => setView('dashboard')} className="text-gray-600 hover:text-gray-900 font-bold">← Back</button>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <div className="w-20"></div>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white rounded-lg shadow p-8 space-y-8">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Subscription</h2>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="font-bold text-gray-900">Current Plan: <span className="text-blue-600">FREE</span></p>
                <p className="text-sm text-gray-600 mt-1">{limits.free.scansPerMonth} scans/month • {limits.free.storageLeads} lead slots</p>
              </div>
              <button
                onClick={handleUpgrade}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-6 rounded-lg"
              >
                Upgrade to Premium ($29/month)
              </button>
            </div>

            <div className="border-t border-gray-200 pt-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Account</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <input type="email" value={user.email} disabled className="w-full px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-600" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Member Since</label>
                  <input type="text" value={user.joinedDate} disabled className="w-full px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-600" />
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Integrations</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <p className="font-bold text-gray-900">Skip Tracing API</p>
                    <p className="text-sm text-gray-600">Connect your Trestle account</p>
                  </div>
                  <button className="bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold py-2 px-4 rounded">Connect</button>
                </div>
                <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div>
                    <p className="font-bold text-gray-900">CRM Export</p>
                    <p className="text-sm text-gray-600">Export leads to Sift or DataSift</p>
                  </div>
                  <button className="bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold py-2 px-4 rounded">Setup</button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
