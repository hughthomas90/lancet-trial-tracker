import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Trash2, FileText, AlertCircle, Loader2, RefreshCw, Settings, Bell, ArrowUpDown, Star, BookOpen } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAgzU0TBHcNXs5TzWgSABxGcZNQfkcrmrQ",
  authDomain: "lancet-trial-tracker.firebaseapp.com",
  projectId: "lancet-trial-tracker",
  storageBucket: "lancet-trial-tracker.firebasestorage.app",
  messagingSenderId: "318604270085",
  appId: "1:318604270085:web:d2cf1635a0f07ad81b1a6c",
  measurementId: "G-5DP1G6X3JC"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : "1:318604270085:web:d2cf1635a0f07ad81b1a6c";

const CTG_API_BASE = 'https://clinicaltrials.gov/api/v2/studies';

const DEFAULT_TOPICS = [
  { id: '1', name: 'Fatty Liver Disease', keywords: 'MASLD, MASH, NAFLD, NASH, fatty liver, steatotic liver disease' },
  { id: '2', name: 'CAR-T Therapies', keywords: 'CAR-T, chimeric antigen receptor, BCMA, CD19' }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [topics, setTopics] = useState([]);
  const [activeTopicId, setActiveTopicId] = useState('');
  const [additionalKeywords, setAdditionalKeywords] = useState('');
  const [timeframeMonths, setTimeframeMonths] = useState(60); // 60 = Any
  const [phases, setPhases] = useState({ phase1Impact: false, phase2: true, phase3: true });
  const [minEnrollment, setMinEnrollment] = useState(0);
  const [minSites, setMinSites] = useState(1);
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'asc' });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  
  const [watchlist, setWatchlist] = useState([]);
  const [watchlistTopicId, setWatchlistTopicId] = useState('all');
  const [watchlistFilter, setWatchlistFilter] = useState('');
  const [watchlistSort, setWatchlistSort] = useState('date');
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search'); // search, watchlist, settings

  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const topicsRef = collection(db, 'artifacts', appId, 'public', 'data', 'topics');
    const unsubTopics = onSnapshot(topicsRef, (snapshot) => {
      const fetchedTopics = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      if (fetchedTopics.length === 0) {
        DEFAULT_TOPICS.forEach(t => setDoc(doc(topicsRef, t.id), t));
      } else {
        setTopics(fetchedTopics);
        if (!activeTopicId || !fetchedTopics.find(t => t.id === activeTopicId)) {
          setActiveTopicId(fetchedTopics[0]?.id);
        }
      }
    }, (err) => console.error("Topics error:", err));

    const watchlistRef = collection(db, 'artifacts', appId, 'public', 'data', 'watchlist');
    const unsubWatchlist = onSnapshot(watchlistRef, (snapshot) => {
      setWatchlist(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Watchlist error:", err));

    return () => { unsubTopics(); unsubWatchlist(); };
  }, [user, activeTopicId]);

  const getFutureDate = (months) => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().split('T')[0];
  };

  const getTodayDate = () => new Date().toISOString().split('T')[0];

  const parseStudyData = (study) => {
    const pSec = study.protocolSection;
    const nctId = pSec?.identificationModule?.nctId || 'Unknown';
    const title = pSec?.identificationModule?.briefTitle || 'No Title';
    const sponsor = pSec?.sponsorCollaboratorsModule?.leadSponsor?.name || 'Unknown Sponsor';
    const studyPhases = pSec?.designModule?.phases || [];
    const status = pSec?.statusModule?.overallStatus || 'Unknown';
    const enrollment = pSec?.designModule?.enrollmentInfo?.count || 0;
    
    // Dates
    const primaryCompletionDate = pSec?.statusModule?.primaryCompletionDateStruct?.date || 'Unknown';
    const studyCompletionDate = pSec?.statusModule?.completionDateStruct?.date || 'Unknown';
    const firstSubmittedDate = pSec?.statusModule?.studyFirstSubmitDate || 'Unknown';
    const lastUpdateDate = pSec?.statusModule?.lastUpdateSubmitDate || 'Unknown';

    // Outcomes & Locations
    const primaryOutcomes = pSec?.outcomesModule?.primaryOutcomes?.map(o => o.measure) || [];
    const locations = pSec?.contactsLocationsModule?.locations || [];
    const countries = [...new Set(locations.map(l => l.country).filter(Boolean))];
    const sitesCount = locations.length;

    // Contacts & Officials
    const contacts = pSec?.contactsLocationsModule?.centralContacts || [];
    const officials = pSec?.contactsLocationsModule?.overallOfficials || [];
    
    return {
      nctId,
      title,
      sponsor,
      phases: studyPhases,
      status,
      enrollment,
      primaryCompletionDate,
      studyCompletionDate,
      firstSubmittedDate,
      lastUpdateDate,
      primaryOutcomes,
      countries,
      sitesCount,
      contacts,
      officials,
      savedAt: new Date().toISOString()
    };
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    const activeTopic = topics.find(t => t.id === activeTopicId);
    if (!activeTopic || !activeTopic.keywords.trim()) {
      setError('Selected topic has no keywords.');
      return;
    }

    setLoading(true);
    setError('');
    setResults([]);

    try {
      // 1. Build Keyword Query
      // CHANGE: Removed quotes ("") around keywords to allow API synonym expansion
      const topicKeywordArray = activeTopic.keywords.split(',').map(k => k.trim()).filter(Boolean);
      
      // Wrap each keyword in parentheses to group multi-word terms safely without forcing exact phrase match
      let termQuery = topicKeywordArray.map(k => `(${k})`).join(' OR ');
      
      if (topicKeywordArray.length > 1) {
        termQuery = `(${termQuery})`;
      }

      // Add additional keywords as an AND condition
      if (additionalKeywords.trim()) {
        const addKeywordArray = additionalKeywords.split(',').map(k => k.trim()).filter(Boolean);
        // CHANGE: Removed quotes here as well
        const addTermQuery = addKeywordArray.map(k => `(${k})`).join(' OR ');
        termQuery = `${termQuery} AND (${addTermQuery})`;
      }

      // 2. Build Advanced Filters
      const advancedFilters = [];

      const apiPhases = [];
      if (phases.phase1Impact) apiPhases.push('PHASE1');
      if (phases.phase2) apiPhases.push('PHASE2');
      if (phases.phase3) apiPhases.push('PHASE3');
      
      if (apiPhases.length > 0) {
        advancedFilters.push(`(${apiPhases.map(p => `AREA[Phase]${p}`).join(' OR ')})`);
      }

      if (timeframeMonths < 60) {
        advancedFilters.push(`AREA[PrimaryCompletionDate]RANGE[${getTodayDate()},${getFutureDate(timeframeMonths)}]`);
      }

      if (minEnrollment > 0) {
        advancedFilters.push(`AREA[EnrollmentCount]RANGE[${minEnrollment},MAX]`);
      }

      const advancedQueryString = advancedFilters.length > 0 
        ? `&filter.advanced=${encodeURIComponent(advancedFilters.join(' AND '))}` 
        : '';

      // 3. Status Filter
      const statusFilter = `&filter.overallStatus=NOT_YET_RECRUITING,RECRUITING,ACTIVE_NOT_RECRUITING`;

      // Pagination Loop
      let allParsedStudies = [];
      let nextPageToken = null;
      let pageCount = 0;
      const MAX_PAGES = 10; 

      do {
        // Construct final URL
        let url = `${CTG_API_BASE}?query.term=${encodeURIComponent(termQuery)}${advancedQueryString}${statusFilter}&pageSize=100`;
        if (nextPageToken) url += `&pageToken=${nextPageToken}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();

        if (data.studies && data.studies.length > 0) {
          const newStudies = data.studies.map(s => {
            const parsed = parseStudyData(s);
            parsed.topicId = activeTopicId;
            return parsed;
          });
          allParsedStudies = allParsedStudies.concat(newStudies);
        }

        nextPageToken = data.nextPageToken;
        pageCount++;
      } while (nextPageToken && pageCount < MAX_PAGES);

      if (allParsedStudies.length === 0) {
        setError('No trials match this criteria.');
        setLoading(false);
        return;
      }

      // Phase 1 high-impact proxy filter
      if (phases.phase1Impact) {
        allParsedStudies = allParsedStudies.filter(study => {
          if (study.phases.includes('PHASE1') && !study.phases.includes('PHASE2')) return study.enrollment > 40;
          return true; 
        });
      }

      setResults(allParsedStudies);
    } catch (err) {
      setError(err.message || 'Fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const displayResults = useMemo(() => {
    let filtered = results;
    
    // minEnrollment is now handled by the API, so we only filter sites locally
    if (minSites > 1) {
      filtered = filtered.filter(r => r.sitesCount >= minSites);
    }

    return [...filtered].sort((a, b) => {
      if (sortConfig.key === 'enrollment') {
        return sortConfig.direction === 'asc' ? a.enrollment - b.enrollment : b.enrollment - a.enrollment;
      }
      if (sortConfig.key === 'date') {
        const dateA = a.primaryCompletionDate === 'Unknown' ? '9999-12-31' : a.primaryCompletionDate;
        const dateB = b.primaryCompletionDate === 'Unknown' ? '9999-12-31' : b.primaryCompletionDate;
        if (dateA < dateB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (dateA > dateB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      }
      return 0;
    });
  }, [results, minSites, sortConfig]);

  const processedWatchlist = useMemo(() => {
    let filtered = watchlist;
    
    if (watchlistTopicId !== 'all') {
      const topic = topics.find(t => t.id === watchlistTopicId);
      filtered = filtered.filter(t => {
        if (t.topicId) {
          return t.topicId === watchlistTopicId;
        }
        // Legacy fallback for trials saved before topicId tagging
        if (topic && topic.keywords.trim()) {
          const keywords = topic.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
          const searchStr = `${t.title} ${t.sponsor} ${t.primaryOutcomes.join(' ')}`.toLowerCase();
          return keywords.some(k => searchStr.includes(k));
        }
        return false;
      });
    }

    if (watchlistFilter.trim()) {
      const lowerFilter = watchlistFilter.toLowerCase();
      filtered = filtered.filter(t => 
        t.nctId.toLowerCase().includes(lowerFilter) ||
        t.title.toLowerCase().includes(lowerFilter) ||
        t.sponsor.toLowerCase().includes(lowerFilter) ||
        (t.notes && t.notes.toLowerCase().includes(lowerFilter))
      );
    }

    return filtered.sort((a, b) => {
      if (watchlistSort === 'priority') {
        if (a.isHighPriority !== b.isHighPriority) {
          return a.isHighPriority ? -1 : 1;
        }
      } else if (watchlistSort === 'updates') {
        if (a.hasUpdates !== b.hasUpdates) {
          return a.hasUpdates ? -1 : 1;
        }
      }
      // Fallback to date sorting
      return new Date(b.savedAt) - new Date(a.savedAt);
    });
  }, [watchlist, watchlistFilter, watchlistTopicId, watchlistSort, topics]);

  const toggleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const checkWatchlistUpdates = async () => {
    if (watchlist.length === 0) return;
    setUpdatesLoading(true);
    
    try {
      const nctIds = watchlist.map(w => w.nctId);
      const url = `${CTG_API_BASE}?filter.ids=${nctIds.join(',')}&pageSize=100`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch updates');
      const data = await response.json();
      
      const latestDataMap = new Map();
      (data.studies || []).forEach(study => {
        const parsed = parseStudyData(study);
        latestDataMap.set(parsed.nctId, parsed);
      });

      const updates = [];
      watchlist.forEach(savedTrial => {
        const latest = latestDataMap.get(savedTrial.nctId);
        if (!latest) return;

        const statusChanged = savedTrial.status !== latest.status;
        const dateChanged = savedTrial.primaryCompletionDate !== latest.primaryCompletionDate;

        if (statusChanged || dateChanged) {
          updates.push(updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'watchlist', savedTrial.nctId), {
            ...latest,
            hasUpdates: true,
            previousStatus: statusChanged ? savedTrial.status : savedTrial.previousStatus,
            previousDate: dateChanged ? savedTrial.primaryCompletionDate : savedTrial.previousDate,
            savedAt: savedTrial.savedAt
          }));
        }
      });
      await Promise.all(updates);
    } catch (err) {
      console.error("Update check failed", err);
      alert("Failed to check for updates. Try again later.");
    } finally {
      setUpdatesLoading(false);
    }
  };

  const addToWatchlist = async (trial, isHighPriority = false) => {
    if (!user || watchlist.find(t => t.nctId === trial.nctId)) return;
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'watchlist', trial.nctId), { 
      ...trial, 
      hasUpdates: false,
      isHighPriority: isHighPriority,
      notes: ''
    });
  };

  const removeFromWatchlist = async (nctId) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'watchlist', nctId));
  };

  const acknowledgeUpdates = async (nctId) => {
    if (!user) return;
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'watchlist', nctId), {
      hasUpdates: false,
      previousStatus: null,
      previousDate: null
    });
  };

  const togglePriority = async (nctId, currentPriority) => {
    if (!user) return;
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'watchlist', nctId), { isHighPriority: !currentPriority });
  };

  const saveNotes = async (nctId, notes) => {
    if (!user) return;
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'watchlist', nctId), { notes });
  };

  const updateTopic = async (id, field, value) => {
    if (!user) return;
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'topics', id), { [field]: value });
  };

  const addTopic = async () => {
    if (!user) return;
    const newId = Date.now().toString();
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'topics', newId), { id: newId, name: 'New Topic', keywords: '' });
  };

  const removeTopic = async (id) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'topics', id));
  };

  const generateReport = () => {
    if (watchlist.length === 0) return;
    
    let content = `# Trial Commissioning Watchlist\nGenerated: ${new Date().toLocaleDateString()}\n\n`;
    
    watchlist.forEach(t => {
      content += `## ${t.title}\n`;
      content += `- **ID:** ${t.nctId} (https://clinicaltrials.gov/study/${t.nctId})\n`;
      content += `- **Phase:** ${t.phases.join(', ')}\n`;
      content += `- **Status:** ${t.status.replace(/_/g, ' ')}\n`;
      content += `- **Primary Completion:** ${t.primaryCompletionDate}\n`;
      content += `- **Enrollment:** ${t.enrollment} across ${t.sitesCount} sites\n`;
      content += `- **Countries:** ${t.countries.join(', ') || 'N/A'}\n`;
      content += `- **Sponsor:** ${t.sponsor}\n`;
      if (t.isHighPriority) content += `- **Priority:** High\n`;
      if (t.notes) content += `- **Notes:** ${t.notes}\n`;
      
      content += `- **Contacts:**\n`;
      let hasContact = false;
      t.officials.forEach(o => {
        content += `  - [PI/Official] ${o.name || 'N/A'} | ${o.affiliation || ''}\n`;
        hasContact = true;
      });
      t.contacts.forEach(c => {
        content += `  - [Central] ${c.name || 'N/A'} | ${c.email || 'No email'} | ${c.phone || ''}\n`;
        hasContact = true;
      });
      if (!hasContact) content += `  - No contacts listed.\n`;
      
      content += `\n---\n\n`;
    });

    navigator.clipboard.writeText(content).then(() => {
      alert('Markdown report copied to clipboard.');
    });
  };

  const renderContacts = (trial) => {
    const all = [...trial.officials.map(o => ({...o, type: 'Official'})), ...trial.contacts.map(c => ({...c, type: 'Contact'}))];
    if (all.length === 0) return <div className="text-xs text-neutral-400 italic">No contacts provided</div>;
    
    return all.slice(0, 2).map((c, i) => (
      <div key={i} className="text-xs text-neutral-600 truncate">
        <span className="font-semibold text-neutral-800">{c.name}</span> {c.email ? <a href={`mailto:${c.email}`} className="text-blue-600 hover:underline">{c.email}</a> : c.affiliation}
      </div>
    ));
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 font-sans">
      <nav className="bg-slate-900 text-white p-4 shadow-md flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-6 h-6 text-red-500" />
          <h1 className="text-xl font-bold tracking-tight">Lancet Trial Tracker</h1>
        </div>
        <div className="flex space-x-1 border border-slate-700 rounded-md p-1 bg-slate-800">
          <button onClick={() => setActiveTab('search')} className={`px-4 py-2 text-sm font-medium rounded-sm transition-colors ${activeTab === 'search' ? 'bg-slate-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}>
            Discovery
          </button>
          <button onClick={() => { setActiveTab('watchlist'); checkWatchlistUpdates(); }} className={`px-4 py-2 text-sm font-medium rounded-sm transition-colors flex items-center space-x-2 ${activeTab === 'watchlist' ? 'bg-slate-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}>
            <span>Watchlist</span>
            {watchlist.some(w => w.hasUpdates) && <span className="w-2 h-2 rounded-full bg-red-500"></span>}
          </button>
          <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 text-sm font-medium rounded-sm transition-colors ${activeTab === 'settings' ? 'bg-slate-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}>
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6">
        
        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-neutral-200">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold">Topic Configuration</h2>
                <button onClick={addTopic} className="text-sm bg-neutral-900 text-white px-3 py-1.5 rounded flex items-center gap-1 hover:bg-neutral-800">
                  <Plus className="w-4 h-4" /> Add Topic
                </button>
              </div>
              <p className="text-sm text-neutral-600 mb-6">Define comma-separated keywords. The system will search for trials matching ANY of the keywords in a topic.</p>
              
              <div className="space-y-4">
                {topics.map(topic => (
                  <div key={topic.id} className="border border-neutral-200 p-4 rounded-lg bg-neutral-50 flex gap-4 items-start">
                    <div className="flex-grow space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">Topic Name</label>
                        <input type="text" value={topic.name} onChange={(e) => updateTopic(topic.id, 'name', e.target.value)} className="w-full p-2 border border-neutral-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">Keywords (Comma Separated)</label>
                        <textarea value={topic.keywords} onChange={(e) => updateTopic(topic.id, 'keywords', e.target.value)} rows={2} className="w-full p-2 border border-neutral-300 rounded focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm" />
                      </div>
                    </div>
                    <button onClick={() => removeTopic(topic.id)} className="p-2 text-red-500 hover:bg-red-100 rounded mt-6">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SEARCH TAB */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-neutral-200">
              <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-semibold text-neutral-700 mb-1">Select Topic</label>
                  <select 
                    value={activeTopicId} 
                    onChange={(e) => setActiveTopicId(e.target.value)}
                    className="w-full p-2.5 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                  >
                    {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-semibold text-neutral-700 mb-1">Additional Keywords (AND)</label>
                  <input 
                    type="text"
                    value={additionalKeywords}
                    onChange={(e) => setAdditionalKeywords(e.target.value)}
                    placeholder="e.g. safety, pediatric (comma separated)"
                    className="w-full p-2.5 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                  />
                </div>

                <div className="col-span-1 md:col-span-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1 flex justify-between">
                      <span>Primary Completion</span>
                      <span className="text-blue-600 font-mono">{timeframeMonths >= 60 ? 'Any' : `≤ ${timeframeMonths} mo`}</span>
                    </label>
                    <input 
                      type="range" min="1" max="60" value={timeframeMonths} onChange={(e) => setTimeframeMonths(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1 flex justify-between">
                      <span>Min Enrollment</span>
                      <span className="text-blue-600 font-mono">{minEnrollment > 0 ? `≥ ${minEnrollment}` : 'Any'}</span>
                    </label>
                    <input 
                      type="range" min="0" max="2000" step="10" value={minEnrollment} onChange={(e) => setMinEnrollment(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1 flex justify-between">
                      <span>Min Sites</span>
                      <span className="text-blue-600 font-mono">{minSites > 1 ? `≥ ${minSites}` : 'Any'}</span>
                    </label>
                    <input 
                      type="range" min="1" max="100" value={minSites} onChange={(e) => setMinSites(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>
                </div>
                
                <div className="col-span-1 md:col-span-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-neutral-100">
                  <div className="flex flex-wrap gap-4">
                     <label className="flex items-center space-x-2 cursor-pointer">
                        <input type="checkbox" checked={phases.phase2} onChange={() => setPhases(p => ({...p, phase2: !p.phase2}))} className="rounded text-blue-600" />
                        <span className="text-sm font-medium">Phase 2</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input type="checkbox" checked={phases.phase3} onChange={() => setPhases(p => ({...p, phase3: !p.phase3}))} className="rounded text-blue-600" />
                        <span className="text-sm font-medium">Phase 3</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input type="checkbox" checked={phases.phase1Impact} onChange={() => setPhases(p => ({...p, phase1Impact: !p.phase1Impact}))} className="rounded text-blue-600" />
                        <span className="text-sm font-medium">Phase 1 (&gt;40 n)</span>
                      </label>
                  </div>
                  <button type="submit" disabled={loading} className="h-[46px] px-8 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors flex items-center justify-center">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Run Discovery'}
                  </button>
                </div>
              </form>
            </div>

            {error && <div className="bg-red-50 text-red-700 p-4 rounded-lg font-medium">{error}</div>}

            {!loading && displayResults.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="p-4 bg-neutral-50 border-b border-neutral-200 flex justify-between items-center">
                  <h2 className="font-semibold text-neutral-800">Results ({displayResults.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                        <th className="p-4 font-semibold min-w-[400px]">Study, Sponsor & Endpoints</th>
                        <th className="p-4 font-semibold cursor-pointer hover:bg-neutral-100 transition-colors" onClick={() => toggleSort('date')}>
                          <div className="flex items-center space-x-1">
                            <span>Timeline</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                        <th className="p-4 font-semibold cursor-pointer hover:bg-neutral-100 transition-colors" onClick={() => toggleSort('enrollment')}>
                          <div className="flex items-center space-x-1">
                            <span>Size & Locations</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                        <th className="p-4 font-semibold w-[250px] max-w-[250px]">Contacts</th>
                        <th className="p-4 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 text-sm">
                      {displayResults.map((trial) => {
                        const inWatchlist = watchlist.some(t => t.nctId === trial.nctId);
                        return (
                          <tr key={trial.nctId} className="hover:bg-neutral-50">
                            <td className="p-4">
                              <div className="flex items-center gap-2 mb-1">
                                <a href={`https://clinicaltrials.gov/study/${trial.nctId}`} target="_blank" rel="noreferrer" className="text-blue-600 font-mono text-xs hover:underline">
                                  {trial.nctId}
                                </a>
                                <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${trial.nctId}`} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-blue-600 transition-colors" title="Search PubMed for publications">
                                  <BookOpen className="w-3 h-3" />
                                </a>
                              </div>
                              <p className="font-medium text-neutral-900 mb-1">{trial.title}</p>
                              <div className="text-xs font-semibold text-neutral-700 mb-2">{trial.sponsor}</div>
                              <div className="flex gap-1 mb-3">
                                {trial.phases.map(p => <span key={p} className="bg-slate-200 text-slate-800 text-[10px] px-1.5 py-0.5 rounded font-bold">{p}</span>)}
                              </div>
                              {trial.primaryOutcomes.length > 0 && (
                                <div className="mt-2 text-xs text-neutral-600 bg-neutral-50 p-2 rounded border border-neutral-100 max-h-24 overflow-y-auto">
                                  <strong className="text-neutral-800 block mb-1">Primary Endpoints:</strong>
                                  <ul className="list-disc pl-4 space-y-1">
                                    {trial.primaryOutcomes.map((outcome, idx) => (
                                      <li key={idx} className="line-clamp-2" title={outcome}>{outcome}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </td>
                            <td className="p-4 align-top whitespace-nowrap">
                              <div className="font-medium text-neutral-900 mb-1">{trial.status.replace(/_/g, ' ')}</div>
                              <div className="text-xs text-neutral-600">Primary: {trial.primaryCompletionDate}</div>
                              <div className="text-xs text-neutral-500 mb-2">Study: {trial.studyCompletionDate}</div>
                              <div className="text-[10px] text-neutral-400">Reg: {trial.firstSubmittedDate}</div>
                              <div className="text-[10px] text-neutral-400">Upd: {trial.lastUpdateDate}</div>
                            </td>
                            <td className="p-4 align-top">
                              <div className="font-bold text-neutral-900 mb-1">n = {trial.enrollment}</div>
                              <div className="text-xs text-neutral-600 mb-1">{trial.sitesCount} Sites</div>
                              {trial.countries.length > 0 && (
                                <div className="text-xs text-neutral-500 max-w-[150px] truncate" title={trial.countries.join(', ')}>
                                  {trial.countries.join(', ')}
                                 </div>
                              )}
                            </td>
                            <td className="p-4 align-top w-[250px] max-w-[250px]">
                              {renderContacts(trial)}
                            </td>
                            <td className="p-4 text-right align-top">
                              {inWatchlist ? (
                                <button 
                                  onClick={() => removeFromWatchlist(trial.nctId)}
                                  className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors min-w-[120px] justify-center bg-green-100 text-green-800 hover:bg-red-100 hover:text-red-700 border border-transparent"
                                >
                                  <Trash2 className="w-4 h-4" /> <span>Untrack</span>
                                </button>
                              ) : (
                                <div className="flex flex-col items-end gap-2">
                                  <button 
                                    onClick={() => addToWatchlist(trial, false)}
                                    className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors min-w-[120px] justify-center bg-white border border-neutral-300 hover:bg-neutral-50"
                                  >
                                    <Plus className="w-4 h-4" /> <span>Track</span>
                                  </button>
                                  <button 
                                    onClick={() => addToWatchlist(trial, true)}
                                    className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors min-w-[120px] justify-center bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                                  >
                                    <Star className="w-4 h-4" fill="currentColor" /> <span>Priority</span>
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {!loading && results.length > 0 && displayResults.length === 0 && (
              <div className="text-center py-12 bg-white rounded-xl border border-neutral-200 text-neutral-500">
                All results filtered out by minimum site count.
              </div>
            )}
          </div>
        )}

        {/* WATCHLIST TAB */}
        {activeTab === 'watchlist' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-xl shadow-sm border border-neutral-200 gap-4">
              <div>
                <h2 className="text-xl font-bold text-neutral-900">Active Watchlist</h2>
                <p className="text-sm text-neutral-500 mt-1">Trials are checked against CT.gov to spot status or date shifts.</p>
              </div>
              <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3 w-full md:w-auto">
                <select 
                  value={watchlistTopicId} 
                  onChange={(e) => setWatchlistTopicId(e.target.value)}
                  className="px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-neutral-700 w-full sm:w-auto"
                >
                  <option value="all">All Topics</option>
                  {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    placeholder="Filter keywords/ID..."
                    value={watchlistFilter}
                    onChange={(e) => setWatchlistFilter(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select 
                  value={watchlistSort} 
                  onChange={(e) => setWatchlistSort(e.target.value)}
                  className="px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-neutral-700 w-full sm:w-auto"
                >
                  <option value="date">Sort: Newest</option>
                  <option value="priority">Sort: Priority</option>
                  <option value="updates">Sort: Updates</option>
                </select>
                <button onClick={checkWatchlistUpdates} disabled={updatesLoading} className="px-4 py-2 border border-neutral-300 text-neutral-700 rounded-lg font-medium hover:bg-neutral-50 flex items-center justify-center space-x-2 w-full sm:w-auto">
                  <RefreshCw className={`w-4 h-4 ${updatesLoading ? 'animate-spin' : ''}`} />
                  <span>{updatesLoading ? 'Checking...' : 'Refresh'}</span>
                </button>
                <button onClick={generateReport} disabled={watchlist.length === 0} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 flex items-center justify-center space-x-2 w-full sm:w-auto">
                  <FileText className="w-4 h-4" />
                  <span>Export</span>
                </button>
              </div>
            </div>

            {watchlist.length === 0 ? (
              <div className="text-center py-12 text-neutral-500 bg-white border border-neutral-200 rounded-xl">Watchlist is empty.</div>
            ) : processedWatchlist.length === 0 ? (
              <div className="text-center py-12 text-neutral-500 bg-white border border-neutral-200 rounded-xl">No trials match your filter.</div>
            ) : (
              <div className="grid gap-4">
                {processedWatchlist.length === 0 ? (
              <div className="text-center py-12 text-neutral-500 bg-white border border-neutral-200 rounded-xl">No trials match your filter.</div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                        <th className="p-4 font-semibold min-w-[400px]">Study, Sponsor & Endpoints</th>
                        <th className="p-4 font-semibold">Timeline</th>
                        <th className="p-4 font-semibold">Size & Locations</th>
                        <th className="p-4 font-semibold w-[250px] max-w-[250px]">Contacts</th>
                        <th className="p-4 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 text-sm">
                      {processedWatchlist.map((trial) => {
                        const rowClass = trial.hasUpdates ? 'bg-red-50' : trial.isHighPriority ? 'bg-amber-50/30' : 'bg-white hover:bg-neutral-50';
                        return (
                          <React.Fragment key={trial.nctId}>
                            <tr className={`${rowClass} transition-colors border-b-0`}>
                              <td className="p-4 align-top">
                                <div className="flex items-center gap-2 mb-1">
                                  <button onClick={() => togglePriority(trial.nctId, trial.isHighPriority)} className="focus:outline-none group mt-0.5" title="Toggle High Priority">
                                    <Star fill={trial.isHighPriority ? "currentColor" : "none"} className={`w-4 h-4 transition-colors ${trial.isHighPriority ? 'text-amber-500' : 'text-neutral-300 group-hover:text-amber-500'}`} />
                                  </button>
                                  <a href={`https://clinicaltrials.gov/study/${trial.nctId}`} target="_blank" rel="noreferrer" className="text-blue-600 font-mono text-xs hover:underline">
                                    {trial.nctId}
                                  </a>
                                  <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${trial.nctId}`} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-blue-600 transition-colors" title="Search PubMed for publications">
                                    <BookOpen className="w-3 h-3" />
                                  </a>
                                  {trial.topicId && topics.find(t => t.id === trial.topicId) && (
                                    <span className="text-[10px] uppercase font-bold tracking-wider text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                                      {topics.find(t => t.id === trial.topicId)?.name}
                                    </span>
                                  )}
                                  {trial.hasUpdates && <span className="bg-red-500 text-white text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1"><Bell className="w-3 h-3"/> Update</span>}
                                </div>
                                <p className="font-medium text-neutral-900 mb-1 leading-snug">{trial.title}</p>
                                <div className="text-xs font-semibold text-neutral-700 mb-2">{trial.sponsor}</div>
                                <div className="flex gap-1 mb-3">
                                  {trial.phases.map(p => <span key={p} className="bg-slate-200 text-slate-800 text-[10px] px-1.5 py-0.5 rounded font-bold">{p}</span>)}
                                </div>
                                
                                {trial.hasUpdates && (
                                  <div className="mb-3 p-2 bg-white rounded border border-red-200 text-xs shadow-sm">
                                    {trial.previousStatus && trial.previousStatus !== trial.status && (
                                      <div className="text-red-700"><strong>Status changed:</strong> <span className="line-through opacity-60">{trial.previousStatus.replace(/_/g, ' ')}</span> &rarr; {trial.status.replace(/_/g, ' ')}</div>
                                    )}
                                    {trial.previousDate && trial.previousDate !== trial.primaryCompletionDate && (
                                      <div className="text-red-700"><strong>Completion changed:</strong> <span className="line-through opacity-60">{trial.previousDate}</span> &rarr; {trial.primaryCompletionDate}</div>
                                    )}
                                  </div>
                                )}

                                {trial.primaryOutcomes?.length > 0 && (
                                  <div className="mt-2 text-xs text-neutral-600 bg-white/50 p-2 rounded border border-neutral-100 max-h-24 overflow-y-auto">
                                    <strong className="text-neutral-800 block mb-1">Primary Endpoints:</strong>
                                    <ul className="list-disc pl-4 space-y-1">
                                      {trial.primaryOutcomes.map((outcome, idx) => (
                                        <li key={idx} className="line-clamp-2" title={outcome}>{outcome}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </td>
                              <td className="p-4 align-top whitespace-nowrap">
                                <div className="font-medium text-neutral-900 mb-1">{trial.status.replace(/_/g, ' ')}</div>
                                <div className="text-xs text-neutral-600">Primary: {trial.primaryCompletionDate}</div>
                                <div className="text-xs text-neutral-500 mb-2">Study: {trial.studyCompletionDate}</div>
                                <div className="text-[10px] text-neutral-400">Reg: {trial.firstSubmittedDate}</div>
                                <div className="text-[10px] text-neutral-400">Upd: {trial.lastUpdateDate}</div>
                              </td>
                              <td className="p-4 align-top">
                                <div className="font-bold text-neutral-900 mb-1">n = {trial.enrollment}</div>
                                <div className="text-xs text-neutral-600 mb-1">{trial.sitesCount} Sites</div>
                                {trial.countries?.length > 0 && (
                                  <div className="text-xs text-neutral-500 max-w-[150px] truncate" title={trial.countries.join(', ')}>
                                    {trial.countries.join(', ')}
                                  </div>
                                )}
                              </td>
                              <td className="p-4 align-top w-[250px] max-w-[250px]">
                                {renderContacts(trial)}
                              </td>
                              <td className="p-4 text-right align-top">
                                <div className="flex flex-col items-end gap-2">
                                  {trial.hasUpdates && (
                                     <button onClick={() => acknowledgeUpdates(trial.nctId)} className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-md text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors min-w-[100px] justify-center">
                                       <span>Ack</span>
                                     </button>
                                  )}
                                  <button 
                                    onClick={() => removeFromWatchlist(trial.nctId)}
                                    className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors min-w-[100px] justify-center bg-white border border-neutral-300 text-red-600 hover:bg-red-50 hover:border-red-200"
                                  >
                                    <Trash2 className="w-3 h-3" /> <span>Remove</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                            <tr className={`${rowClass} transition-colors`}>
                              <td colSpan="5" className="px-4 pb-4 pt-0 border-t-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Notes</span>
                                  <input 
                                    type="text" 
                                    defaultValue={trial.notes || ''} 
                                    onBlur={(e) => saveNotes(trial.nctId, e.target.value)}
                                    placeholder="Add internal notes regarding trial status, PI outreach, etc..."
                                    className="w-full p-2 bg-white/60 border border-neutral-200 rounded text-xs focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none transition-colors" 
                                  />
                                </div>
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}