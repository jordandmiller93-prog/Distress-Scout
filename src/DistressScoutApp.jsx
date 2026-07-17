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

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function DistressScoutApp() {
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [leads, setLeads] = useState([]);
  const [view, setView] = useState('login'); // login, dashboard, scan, details
  const [selectedLead, setSelectedLead] = useState(null);
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [stats, setStats] = useState({ scansThisMonth: 0, leadsGenerated: 0, contactsFound: 0 });
  const [uploadedFile, setUploadedFile] = useState(null);
  const [scanAddress, setScanAddress] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState([]);
  const [token, setToken] = useState(null);
  const [isGeneratingOutreach, setIsGeneratingOutreach] = useState(false);
  const [authMode, setAuthMode] = useState('signup'); // signup | login
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const mapRef = useRef(null);

  // Freemium limits
  const limits = {
    free: { scansPerMonth: 20, storageLeads: 50, exportLimit: 5 },
    premium: { scansPerMonth: 500, storageLeads: 5000, exportLimit: 'unlimited' }
  };

  const authFetch = (path, options = {}) =>
    fetch(`${API_URL}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token || localStorage.getItem('ds_token')}` }
    });

  const loadWorkspace = async (authToken) => {
    const headers = { Authorization: `Bearer ${authToken}` };
    const [meRes, leadsRes, statsRes] = await Promise.all([
      fetch(`${API_URL}/api/me`, { headers }),
      fetch(`${API_URL}/api/leads`, { headers }),
      fetch(`${API_URL}/api/stats`, { headers })
    ]);
    if (!meRes.ok) throw new Error('Session expired');

    const me = await meRes.json();
    const leadsData = leadsRes.ok ? await leadsRes.json() : { leads: [] };
    const statsData = statsRes.ok ? await statsRes.json() : {};

    setUserId(me.userId);
    setSubscriptionTier(me.tier);
    setUser({ email: me.email, tier: me.tier, joinedDate: new Date(me.createdAt).toLocaleDateString() });
    setLeads(leadsData.leads.map(mapLeadFromApi));
    setStats({
      scansThisMonth: statsData.scansThisMonth ?? 0,
      leadsGenerated: statsData.leadsGenerated ?? leadsData.leads.length,
      contactsFound: statsData.contactsFound ?? 0
    });
    setView('dashboard');
  };

  // Restore session on page load
  useEffect(() => {
    const saved = localStorage.getItem('ds_token');
    if (saved) {
      setToken(saved);
      loadWorkspace(saved).catch(() => {
        localStorage.removeItem('ds_token');
        setToken(null);
      });
    }
  }, []);

  const handleAuth = async (email, password, mode) => {
    try {
      const res = await fetch(`${API_URL}/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || `${mode === 'signup' ? 'Signup' : 'Login'} failed`);
        return;
      }

      localStorage.setItem('ds_token', data.token);
      setToken(data.token);
      await loadWorkspace(data.token);
    } catch (err) {
      alert(`Could not reach the Distress Scout API at ${API_URL}. Is the backend running? (npm run dev)`);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('ds_token');
    setToken(null);
    setUser(null);
    setUserId(null);
    setLeads([]);
    setScanResults([]);
    setView('login');
  };

  const mapLeadFromApi = (lead) => ({
    id: lead.leadId,
    leadId: lead.leadId,
    scanId: lead.scanId,
    address: lead.address,
    lat: lead.coordinates?.latitude ? parseFloat(lead.coordinates.latitude) : null,
    lng: lead.coordinates?.longitude ? parseFloat(lead.coordinates.longitude) : null,
    distressScore: lead.distressScore,
    riskLevel: lead.riskLevel,
    indicators: lead.indicators || [],
    summary: lead.summary,
    owner: lead.ownerInfo
      ? {
          owner: lead.ownerInfo.name,
          phone: lead.ownerInfo.phone,
          email: lead.ownerInfo.email,
          equity: lead.ownerInfo.equity
        }
      : null,
    dateFound: new Date(lead.addedAt || lead.createdAt || Date.now()).toLocaleDateString(),
    status: lead.status || 'new',
    outreach: lead.outreach || null
  });

  const handleAnalyzeImage = async () => {
    if (!uploadedFile || isScanning) return;

    setIsScanning(true);
    try {
      const formData = new FormData();
      formData.append('image', uploadedFile);
      if (scanAddress) formData.append('address', scanAddress);

      const res = await authFetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json();

      if (res.status === 429) {
        alert(`${data.error} (limit: ${data.limit}/month). Upgrade to Premium for more scans.`);
        return;
      }
      if (!res.ok || !data.success) throw new Error(data.error || 'Scan failed');

      const scan = data.data;
      const newScan = {
        id: scan.scanId,
        scanId: scan.scanId,
        address: scan.address,
        distressScore: scan.distressScore,
        riskLevel: scan.riskLevel,
        indicators: scan.indicators || [],
        summary: scan.summary,
        investmentPotential: scan.investmentPotential,
        ownerInfo: scan.ownerInfo,
        imageFile: uploadedFile.name,
        timestamp: new Date().toLocaleTimeString(),
        status: 'review'
      };

      setScanResults([...scanResults, newScan]);
      setStats((s) => ({ ...s, scansThisMonth: s.scansThisMonth + 1 }));
      setUploadedFile(null);
      setScanAddress('');
    } catch (err) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddToLeads = async (scan) => {
    try {
      const res = await authFetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId: scan.scanId })
      });
      const data = await res.json();
      if (res.status === 429) {
        alert(`${data.error} (limit: ${data.limit}). Upgrade to Premium for more storage.`);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed to save lead');

      setLeads([...leads, mapLeadFromApi(data.lead)]);
      setScanResults(scanResults.filter((s) => s.id !== scan.id));
      setStats((s) => ({ ...s, leadsGenerated: s.leadsGenerated + 1, contactsFound: s.contactsFound + 1 }));
    } catch (err) {
      alert(`Could not save lead: ${err.message}`);
    }
  };

  const handleExport = async () => {
    try {
      const res = await authFetch('/api/export');
      if (res.status === 429) {
        const data = await res.json();
        alert(`${data.error} (${data.used}/${data.limit} used this month). Upgrade to Premium for unlimited exports.`);
        return;
      }
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `distress-scout-leads-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleGenerateOutreach = async (lead, refresh = false) => {
    setIsGeneratingOutreach(true);
    try {
      const res = await authFetch(`/api/leads/${lead.leadId}/outreach${refresh ? '?refresh=1' : ''}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      setLeads((prev) => prev.map((l) => (l.leadId === lead.leadId ? { ...l, outreach: data.outreach } : l)));
      setSelectedLead((prev) => (prev && prev.leadId === lead.leadId ? { ...prev, outreach: data.outreach } : prev));
    } catch (err) {
      alert(`Outreach generation failed: ${err.message}`);
    } finally {
      setIsGeneratingOutreach(false);
    }
  };

  const handleSendSms = async (lead) => {
    const suggested = lead.owner?.phone?.match(/^\+?\d/) ? lead.owner.phone : '';
    const to = window.prompt('Send to phone number (E.164 format, e.g. +15551234567):', suggested);
    if (!to) return;

    try {
      const res = await authFetch(`/api/leads/${lead.leadId}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.missing) {
          alert(`Twilio setup incomplete. Still needed in .env: ${data.missing.join(', ')}`);
        } else {
          alert(data.error || 'SMS send failed');
        }
        return;
      }
      alert(`SMS sent to ${data.to} (status: ${data.status})`);
    } catch (err) {
      alert(`SMS send failed: ${err.message}`);
    }
  };

  const handleLeadStatusChange = async (leadId, status) => {
    try {
      const res = await authFetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Update failed');

      setLeads((prev) => prev.map((l) => (l.leadId === leadId ? { ...l, status } : l)));
      setSelectedLead((prev) => (prev && prev.leadId === leadId ? { ...prev, status } : prev));
    } catch (err) {
      alert(`Could not update lead status: ${err.message}`);
    }
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
          
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleAuth(authEmail, authPassword, authMode);
            }}
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                required
                placeholder="investor@example.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                type="password"
                required
                minLength={8}
                placeholder={authMode === 'signup' ? 'At least 8 characters' : 'Your password'}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition"
            >
              {authMode === 'signup' ? 'Start Free Trial' : 'Log In'}
            </button>

            <p className="text-center text-sm text-gray-600">
              {authMode === 'signup' ? 'Already have an account?' : 'New to Distress Scout?'}{' '}
              <button
                type="button"
                onClick={() => setAuthMode(authMode === 'signup' ? 'login' : 'signup')}
                className="text-blue-600 font-bold hover:underline"
              >
                {authMode === 'signup' ? 'Log in' : 'Sign up free'}
              </button>
            </p>

            <p className="text-center text-xs text-gray-500 mt-4">Free: 20 scans/month • Unlimited list viewing</p>
          </form>

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
              <button onClick={handleLogout} className="p-2 hover:bg-gray-100 rounded"><LogOut className="w-5 h-5" /></button>
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
                  value={scanAddress}
                  onChange={(e) => setScanAddress(e.target.value)}
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
              disabled={!uploadedFile || isScanning}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition"
            >
              {isScanning ? 'Analyzing with AI…' : 'Analyze Photo for Distress'}
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
                          {ind.replace(/_/g, ' ')}{mockDistressIndicators[ind] ? ` (${mockDistressIndicators[ind].score}/10)` : ''}
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
                    <select
                      value={selectedLead.status}
                      onChange={(e) => handleLeadStatusChange(selectedLead.leadId, e.target.value)}
                      className="text-lg font-bold text-blue-600 capitalize bg-transparent border border-gray-300 rounded-lg px-2 py-1 mt-1"
                    >
                      {['new', 'contacted', 'negotiating', 'under_contract', 'closed', 'dead'].map((s) => (
                        <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
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
                        mockDistressIndicators[ind]?.risk === 'high' ? 'text-red-600' :
                        mockDistressIndicators[ind]?.risk === 'medium' ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {mockDistressIndicators[ind] ? `${mockDistressIndicators[ind].score}/10` : 'detected'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Outreach Agent */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center">
                    <Zap className="w-5 h-5 mr-2 text-yellow-500" /> Outreach Agent
                  </h3>
                  <button
                    onClick={() => handleGenerateOutreach(selectedLead, !!selectedLead.outreach)}
                    disabled={isGeneratingOutreach}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded-lg text-sm transition"
                  >
                    {isGeneratingOutreach ? 'Writing…' : selectedLead.outreach ? 'Regenerate' : 'Generate Outreach'}
                  </button>
                </div>

                {!selectedLead.outreach && !isGeneratingOutreach && (
                  <p className="text-sm text-gray-600">
                    AI writes a personalized call script, voicemail, SMS, and direct-mail letter for this owner,
                    based on the property's condition and equity position.
                  </p>
                )}

                {selectedLead.outreach && (
                  <div className="space-y-4">
                    {[
                      ['Call Script', selectedLead.outreach.callScript],
                      ['Voicemail', selectedLead.outreach.voicemail],
                      ['Text Message', selectedLead.outreach.sms],
                      ['Direct Mail Letter', selectedLead.outreach.directMailLetter]
                    ].map(([label, content]) => content && (
                      <div key={label} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-bold text-gray-900 text-sm">{label}</h4>
                          <div className="flex gap-3">
                            {label === 'Text Message' && (
                              <button
                                onClick={() => handleSendSms(selectedLead)}
                                className="text-xs text-green-600 font-bold hover:underline"
                              >
                                Send SMS
                              </button>
                            )}
                            <button
                              onClick={() => navigator.clipboard.writeText(content)}
                              className="text-xs text-blue-600 font-bold hover:underline"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{content}</p>
                      </div>
                    ))}

                    {selectedLead.outreach.negotiationTips?.length > 0 && (
                      <div className="border border-gray-200 rounded-lg p-4 bg-yellow-50">
                        <h4 className="font-bold text-gray-900 text-sm mb-2">Negotiation Tips</h4>
                        <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                          {selectedLead.outreach.negotiationTips.map((tip, i) => (
                            <li key={i}>{tip}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
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
