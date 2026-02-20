import React, { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Trash2, FileText, AlertCircle, Loader2, RefreshCw, Settings, Bell, ArrowUpDown, Star, BookOpen, Info } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

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
  { id: '1', name: 'IBD (Crohn\'s & UC)', keywords: 'inflammatory bowel disease, IBD, ulcerative colitis, Crohn disease' },
  { id: '2', name: 'Steatotic Liver Disease (MASLD)', keywords: 'MASLD, MASH, NAFLD, NASH, steatotic liver disease, fatty liver' },
  { id: '3', name: 'Cirrhosis & Complications', keywords: 'cirrhosis, hepatic cirrhosis, portal hypertension, ascites, hepatic encephalopathy' },
  { id: '4', name: 'Viral Hepatitis', keywords: 'hepatitis B, HBV, hepatitis C, HCV, chronic hepatitis' },
  { id: '5', name: 'Hepatocellular Carcinoma', keywords: 'hepatocellular carcinoma, HCC, liver cancer, hepatic neoplasm' },
  { id: '6', name: 'Colorectal Cancer', keywords: 'colorectal cancer, colon cancer, rectal cancer, colorectal neoplasm, CRC' },
  { id: '7', name: 'Upper GI Cancers', keywords: 'gastric cancer, stomach cancer, esophageal cancer, oesophageal cancer, gastroesophageal junction cancer' },
  { id: '8', name: 'Pancreatic & Biliary Cancers', keywords: 'pancreatic cancer, pancreatic neoplasm, cholangiocarcinoma, biliary tract cancer' },
  { id: '9', name: 'Functional GI & Motility', keywords: 'irritable bowel syndrome, IBS, functional dyspepsia, gastroparesis' },
  { id: '10', name: 'Pancreatitis', keywords: 'acute pancreatitis, chronic pancreatitis' },
  { id: '11', name: 'Microbiome & C. Difficile', keywords: 'Clostridioides difficile, C. diff, fecal microbiota transplantation, FMT' }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [topics, setTopics] = useState([]);
  const [activeTopicId, setActiveTopicId] = useState('');
  const [additionalKeywords, setAdditionalKeywords] = useState('');
  const [timeframeMonths, setTimeframeMonths] = useState(60);
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
  
  const [activeTab, setActiveTab] = useState('search');
  const [settingsView, setSettingsView] = useState('topics');

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
      }
    }, (err) => console.error("Topics error:", err));

    const watchlistRef = collection(db, 'artifacts', appId, 'public', 'data', 'watchlist');
    const unsubWatchlist = onSnapshot(watchlistRef, (snapshot) => {
      setWatchlist(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Watchlist error:", err));

    return () => { unsubTopics(); unsubWatchlist(); };
  }, [user]);

  useEffect(() => {
    if (topics.length > 0 && !activeTopicId) {
      setActiveTopicId(topics[0].id);
    }
  }, [topics, activeTopicId]);

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
    
    const primaryCompletionDate = pSec?.statusModule?.primaryCompletionDateStruct?.date || 'Unknown';
    const studyCompletionDate = pSec?.statusModule?.completionDateStruct?.date || 'Unknown';
    const firstSubmittedDate = pSec?.statusModule?.studyFirstSubmitDate || 'Unknown';
    const lastUpdateDate = pSec?.statusModule?.lastUpdateSubmitDate || 'Unknown';

    const primaryOutcomes = pSec?.outcomesModule?.primaryOutcomes?.map(o => o.measure) || [];
    const interventions = pSec?.armsInterventionsModule?.interventions?.map(i => i.name) || [];
    const locations = pSec?.contactsLocationsModule?.locations || [];
    const countries = [...new Set(locations.map(l => l.country).filter(Boolean))];
    const sitesCount = locations.length;

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
      interventions,
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
      const targetAreas = ['ConditionSearch', 'BriefTitle', 'BriefSummary'];
      
      const topicKeywordArray = activeTopic.keywords.split(',').map(k => k.trim()).filter(Boolean);
      const termQuery = topicKeywordArray.map(k => `(${k})`).join(' OR ');
      
      let fieldQueries = targetAreas.map(area => `AREA[${area}](${termQuery})`).join(' OR ');
      let advancedFilters = [`(${fieldQueries})`];

      if (additionalKeywords.trim()) {
        const addKeywordArray = additionalKeywords.split(',').map(k => k.trim()).filter(Boolean);
        const addTermQuery = addKeywordArray.map(k => `(${k})`).join(' OR ');
        const addFieldQueries = targetAreas.map(area => `AREA[${area}](${addTermQuery})`).join(' OR ');
        advancedFilters.push(`(${addFieldQueries})`);
      }

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

      const advancedQueryString = `filter.advanced=${encodeURIComponent(advancedFilters.join(' AND '))}`;
      const statusFilter = `filter.overallStatus=NOT_YET_RECRUITING,RECRUITING,ACTIVE_NOT_RECRUITING`;

      let allParsedStudies = [];
      let nextPageToken = null;
      let pageCount = 0;
      const MAX_PAGES = 5;

      do {
        let url = `${CTG_API_BASE}?${advancedQueryString}&${statusFilter}&pageSize=100`;
        if (nextPageToken) url += `&pageToken=${nextPageToken}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();

        if (data.studies && data.studies.length > 0) {
          let newStudies = data.studies.map(s => {
            const parsed = parseStudyData(s);
            parsed.topicId = activeTopicId;
            return parsed;
          });
          
          if (phases.phase1Impact) {
            newStudies = newStudies.filter(study => {
              if (study.phases.includes('PHASE1') && !study.phases.includes('PHASE2')) return study.enrollment > 40;
              return true; 
            });
          }
          
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

      setResults(allParsedStudies);
    } catch (err) {
      setError(err.message || 'Fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const displayResults = useMemo(() => {
    let filtered = results;
    
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
        if (t.topicId) return t.topicId === watchlistTopicId;
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
        if (a.isHighPriority !== b.isHighPriority) return a.isHighPriority ? -1 : 1;
      } else if (watchlistSort === 'updates') {
        if (a.hasUpdates !== b.hasUpdates) return a.hasUpdates ? -1 : 1;
      } else if (watchlistSort === 'enrollment') {
        if (a.enrollment !== b.enrollment) return b.enrollment - a.enrollment;
      }
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
      if (t.interventions?.length > 0) content += `- **Interventions:** ${t.interventions.join(', ')}\n`;
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
    if (all.length === 0) return <div className="text-[11px] text-neutral-400 italic">No contacts</div>;
    
    return all.slice(0, 2).map((c, i) => (
      <div key={i} className="text-[11px] text-neutral-600 line-clamp-2 mb-1" title={`${c.name} - ${c.email || c.affiliation}`}>
        <span className="font-semibold text-neutral-800">{c.name}</span><br/>
        {c.email ? <a href={`mailto:${c.email}`} className="text-blue-600 hover:underline">{c.email}</a> : c.affiliation}
      </div>
    ));
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 font-sans">
      <nav className="bg-slate-900 text-white p-4 shadow-md flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <h1 className="text-lg font-bold tracking-tight">Commissioning Radar</h1>
        </div>
        <div className="flex space-x-1 border border-slate-700 rounded-md p-1 bg-slate-800">
          <button onClick={() => setActiveTab('search')} className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors ${activeTab === 'search' ? 'bg-slate-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}>
            Discovery
          </button>
          <button onClick={() => { setActiveTab('watchlist'); checkWatchlistUpdates(); }} className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors flex items-center space-x-2 ${activeTab === 'watchlist' ? 'bg-slate-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}>
            <span>Watchlist</span>
            {watchlist.some(w => w.hasUpdates) && <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>}
          </button>
          <button onClick={() => setActiveTab('settings')} className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors ${activeTab === 'settings' ? 'bg-slate-600 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}>
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </nav>

      <main className="max-w-[1400px] mx-auto p-4 md:p-6">
        
        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="flex space-x-2 border-b border-neutral-200 pb-2">
              <button 
                onClick={() => setSettingsView('topics')} 
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${settingsView === 'topics' ? 'bg-slate-900 text-white' : 'bg-transparent text-neutral-600 hover:bg-neutral-200'}`}>
                Topics
              </button>
              <button 
                onClick={() => setSettingsView('docs')} 
                className={`px-4 py-2 rounded text-sm font-medium transition-colors flex items-center space-x-1.5 ${settingsView === 'docs' ? 'bg-slate-900 text-white' : 'bg-transparent text-neutral-600 hover:bg-neutral-200'}`}>
                <Info className="w-4 h-4" /> <span>Search Logic & Rules</span>
              </button>
            </div>

            {settingsView === 'topics' && (
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
                          <input type="text" value={topic.name} onChange={(e) => updateTopic(topic.id, 'name', e.target.value)} className="w-full p-2 border border-neutral-300 rounded focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">Keywords (Comma Separated)</label>
                          <textarea value={topic.keywords} onChange={(e) => updateTopic(topic.id, 'keywords', e.target.value)} rows={2} className="w-full p-2 border border-neutral-300 rounded focus:ring-2 focus:ring-blue-500 outline-none font-mono text-xs" />
                        </div>
                      </div>
                      <button onClick={() => removeTopic(topic.id)} className="p-2 text-red-500 hover:bg-red-100 rounded mt-6">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {settingsView === 'docs' && (
              <div className="bg-white p-8 rounded-xl shadow-sm border border-neutral-200 text-neutral-800">
                <h2 className="text-xl font-bold mb-4">How the Search Engine Works</h2>
                <p className="mb-6 text-sm leading-relaxed text-neutral-600">The discovery engine interfaces with the ClinicalTrials.gov v2 API. To prevent false positives from generic text fields (like exclusion criteria or study site locations), the app strictly limits queries to the core components of a trial record:</p>
                
                <ul className="list-disc pl-5 mb-8 space-y-2 text-sm">
                  <li><strong>Title:</strong> The brief and official titles.</li>
                  <li><strong>Summary:</strong> The brief summary description.</li>
                  <li><strong>Condition:</strong> The indexed conditions and corresponding MeSH terms.</li>
                </ul>

                <h3 className="text-md font-bold mb-3">Topic Keywords (OR Logic)</h3>
                <p className="mb-3 text-sm leading-relaxed text-neutral-600">When you define comma-separated keywords in a topic, the system looks for trials matching <strong>ANY</strong> of those terms. The comma acts as an <code>OR</code> operator.</p>
                <div className="bg-slate-50 p-4 rounded border border-slate-200 mb-8 font-mono text-xs text-slate-800 leading-tight">
                  <span className="text-slate-500 uppercase font-bold text-[10px] tracking-wider mb-1 block">Input</span>
                  MASLD, NASH, fatty liver
                  <br/><br/>
                  <span className="text-slate-500 uppercase font-bold text-[10px] tracking-wider mb-1 block">Parsed Execution</span>
                  (MASLD) OR (NASH) OR (fatty liver)
                </div>

                <h3 className="text-md font-bold mb-3">Additional Keywords (AND Logic)</h3>
                <p className="mb-3 text-sm leading-relaxed text-neutral-600">Words entered in the "Additional Keywords" box on the Discovery tab are appended to your topic using <strong>AND</strong> logic. A trial must match both the Topic rules and the Additional Keyword rules to be returned.</p>
                <div className="bg-slate-50 p-4 rounded border border-slate-200 mb-8 font-mono text-xs text-slate-800 leading-tight">
                  <span className="text-slate-500 uppercase font-bold text-[10px] tracking-wider mb-1 block">Topic Configuration</span>
                  MASLD, NASH
                  <br/><br/>
                  <span className="text-slate-500 uppercase font-bold text-[10px] tracking-wider mb-1 block">Additional Keywords Box</span>
                  pediatric, safety
                  <br/><br/>
                  <span className="text-slate-500 uppercase font-bold text-[10px] tracking-wider mb-1 block">Parsed Execution</span>
                  ((MASLD) OR (NASH)) AND ((pediatric) OR (safety))
                </div>

                <h3 className="text-md font-bold mb-3">Advanced Rules & Phrase Matching</h3>
                <p className="mb-4 text-sm leading-relaxed text-neutral-600">Because your input is injected directly into the API parameters, you can use native Boolean operators within your comma-separated items.</p>
                
                <div className="space-y-4">
                  <div className="border border-neutral-200 rounded p-4">
                    <h4 className="font-semibold text-sm mb-1">Exact Phrases</h4>
                    <p className="text-xs text-neutral-600 mb-2">Wrap terms in double quotes to prevent the API from breaking them apart or substituting synonyms.</p>
                    <code className="text-xs bg-neutral-100 px-1.5 py-0.5 rounded text-blue-700">"ulcerative colitis"</code>
                  </div>

                  <div className="border border-neutral-200 rounded p-4">
                    <h4 className="font-semibold text-sm mb-1">NOT Operator</h4>
                    <p className="text-xs text-neutral-600 mb-2">Exclude specific sub-types or contexts within a single concept block.</p>
                    <code className="text-xs bg-neutral-100 px-1.5 py-0.5 rounded text-blue-700">"breast cancer" NOT metastatic</code>
                  </div>

                  <div className="border border-neutral-200 rounded p-4">
                    <h4 className="font-semibold text-sm mb-1">Nested Logic Blocks</h4>
                    <p className="text-xs text-neutral-600 mb-2">You can write complex strings as a single comma-separated item using parentheses.</p>
                    <code className="text-xs bg-neutral-100 px-1.5 py-0.5 rounded text-blue-700">("crohn disease" OR "crohn's") AND NOT fistula</code>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* SEARCH TAB */}
        {activeTab === 'search' && (
          <div className="space-y-4">
            <div className="bg-white p-5 rounded-xl shadow-sm border border-neutral-200">
              <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-semibold text-neutral-700 mb-2">Select Topic</label>
                  <select value={activeTopicId} onChange={(e) => setActiveTopicId(e.target.value)} className="w-full p-2.5 border border-neutral-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-semibold text-neutral-700 mb-2">Additional Keywords (AND)</label>
                  <input type="text" value={additionalKeywords} onChange={(e) => setAdditionalKeywords(e.target.value)} placeholder="e.g. safety, pediatric" className="w-full p-2.5 border border-neutral-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"/>
                </div>
                
                <div className="col-span-1 md:col-span-4 grid grid-cols-1 md:grid-cols-3 gap-8 w-full mt-2">
                  <div className="w-full">
                    <label className="flex justify-between text-xs font-semibold text-neutral-700 mb-3">
                      <span className="truncate mr-1">Primary Completion</span>
                      <span className="text-blue-600 whitespace-nowrap">{timeframeMonths >= 60 ? 'Any' : `≤ ${timeframeMonths} mo`}</span>
                    </label>
                    <input type="range" min="1" max="60" value={timeframeMonths} onChange={(e) => setTimeframeMonths(Number(e.target.value))} className="w-full accent-blue-600 cursor-pointer"/>
                  </div>
                  <div className="w-full">
                    <label className="flex justify-between text-xs font-semibold text-neutral-700 mb-3">
                      <span className="truncate mr-1">Min Enrollment</span>
                      <span className="text-blue-600 whitespace-nowrap">{minEnrollment > 0 ? `≥ ${minEnrollment}` : 'Any'}</span>
                    </label>
                    <input type="range" min="0" max="2000" step="10" value={minEnrollment} onChange={(e) => setMinEnrollment(Number(e.target.value))} className="w-full accent-blue-600 cursor-pointer"/>
                  </div>
                  <div className="w-full">
                    <label className="flex justify-between text-xs font-semibold text-neutral-700 mb-3">
                      <span className="truncate mr-1">Min Sites</span>
                      <span className="text-blue-600 whitespace-nowrap">{minSites > 1 ? `≥ ${minSites}` : 'Any'}</span>
                    </label>
                    <input type="range" min="1" max="100" value={minSites} onChange={(e) => setMinSites(Number(e.target.value))} className="w-full accent-blue-600 cursor-pointer"/>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-neutral-100">
                  <div className="flex flex-wrap gap-6">
                     <label className="flex items-center space-x-2 cursor-pointer">
                        <input type="checkbox" checked={phases.phase2} onChange={() => setPhases(p => ({...p, phase2: !p.phase2}))} className="rounded text-blue-600 w-4 h-4" />
                        <span className="text-sm font-medium text-neutral-700">Phase 2</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input type="checkbox" checked={phases.phase3} onChange={() => setPhases(p => ({...p, phase3: !p.phase3}))} className="rounded text-blue-600 w-4 h-4" />
                        <span className="text-sm font-medium text-neutral-700">Phase 3</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input type="checkbox" checked={phases.phase1Impact} onChange={() => setPhases(p => ({...p, phase1Impact: !p.phase1Impact}))} className="rounded text-blue-600 w-4 h-4" />
                        <span className="text-sm font-medium text-neutral-700">Phase 1 (&gt;40 n)</span>
                      </label>
                  </div>
                  <button type="submit" disabled={loading} className="px-8 py-2.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-800 transition-colors flex items-center justify-center h-[42px]">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Run Discovery'}
                  </button>
                </div>
              </form>
            </div>

            {error && <div className="bg-red-50 text-red-700 p-3 text-sm rounded border border-red-200">{error}</div>}

            {!loading && displayResults.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200 flex justify-between items-center">
                  <h2 className="text-sm font-semibold text-neutral-800">Results ({displayResults.length})</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse table-fixed min-w-[900px]">
                    <thead>
                      <tr className="bg-neutral-50 text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                        <th className="px-3 py-2 font-semibold w-[35%]">Study, Sponsor & Endpoints</th>
                        <th className="px-3 py-2 font-semibold cursor-pointer hover:bg-neutral-100 transition-colors w-[15%]" onClick={() => toggleSort('date')}>
                          <div className="flex items-center space-x-1"><span>Timeline</span><ArrowUpDown className="w-3 h-3" /></div>
                        </th>
                        <th className="px-3 py-2 font-semibold cursor-pointer hover:bg-neutral-100 transition-colors w-[15%]" onClick={() => toggleSort('enrollment')}>
                          <div className="flex items-center space-x-1"><span>Size & Locations</span><ArrowUpDown className="w-3 h-3" /></div>
                        </th>
                        <th className="px-3 py-2 font-semibold w-[20%]">Contacts</th>
                        <th className="px-3 py-2 font-semibold text-right w-[15%]">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 text-xs">
                      {displayResults.map((trial) => {
                        const inWatchlist = watchlist.some(t => t.nctId === trial.nctId);
                        return (
                          <tr key={trial.nctId} className="hover:bg-neutral-50 transition-colors">
                            <td className="px-3 py-4 align-top break-words">
                              <div className="flex items-center gap-2 mb-1">
                                <a href={`https://clinicaltrials.gov/study/${trial.nctId}`} target="_blank" rel="noreferrer" className="text-blue-600 font-mono text-[11px] hover:underline">{trial.nctId}</a>
                                <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${trial.nctId}`} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-blue-600"><BookOpen className="w-3 h-3" /></a>
                              </div>
                              <p className="font-semibold text-neutral-900 mb-0.5 leading-snug">{trial.title}</p>
                              <div className="text-[11px] text-neutral-600 mb-2 line-clamp-2" title={trial.sponsor}>{trial.sponsor}</div>
                              <div className="flex flex-wrap gap-1 mb-2">
                                {trial.phases.map(p => <span key={p} className="bg-slate-200 text-slate-800 text-[9px] px-1 py-0.5 rounded font-bold">{p}</span>)}
                                {trial.interventions?.slice(0, 4).map((inv, idx) => (
                                  <span key={idx} className="bg-neutral-100 text-neutral-600 text-[9px] px-1.5 py-0.5 rounded border border-neutral-200 line-clamp-1 max-w-[150px] font-normal" title={inv}>{inv}</span>
                                ))}
                                {trial.interventions?.length > 4 && (
                                  <span className="bg-neutral-100 text-neutral-600 text-[9px] px-1.5 py-0.5 rounded border border-neutral-200 cursor-help whitespace-nowrap font-normal" title={trial.interventions.join(', ')}>
                                    ... (+{trial.interventions.length - 4})
                                  </span>
                                )}
                              </div>
                              {trial.primaryOutcomes.length > 0 && (
                                <div className="mt-2 text-[11px] text-neutral-600 bg-neutral-50 p-2 rounded border border-neutral-100 max-h-24 overflow-y-auto">
                                  <strong className="text-neutral-800 block mb-0.5">Primary Endpoints:</strong>
                                  <ul className="list-disc pl-4 space-y-0.5">
                                    {trial.primaryOutcomes.map((outcome, idx) => <li key={idx} className="line-clamp-2" title={outcome}>{outcome}</li>)}
                                  </ul>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-4 align-top whitespace-nowrap">
                              <div className="font-medium text-neutral-900 mb-1">{trial.status.replace(/_/g, ' ')}</div>
                              <div className="text-[11px] text-neutral-600">Pri: {trial.primaryCompletionDate}</div>
                              <div className="text-[11px] text-neutral-500 mb-2">Std: {trial.studyCompletionDate}</div>
                              <div className="text-[9px] text-neutral-400">Reg: {trial.firstSubmittedDate}</div>
                              <div className="text-[9px] text-neutral-400">Upd: {trial.lastUpdateDate}</div>
                            </td>
                            <td className="px-3 py-4 align-top break-words">
                              <div className="font-bold text-neutral-900 mb-0.5">n = {trial.enrollment}</div>
                              <div className="text-[11px] text-neutral-600 mb-1">{trial.sitesCount} Sites</div>
                              {trial.countries.length > 0 && (
                                <div className="text-[10px] text-neutral-500 line-clamp-2" title={trial.countries.join(', ')}>{trial.countries.join(', ')}</div>
                              )}
                            </td>
                            <td className="px-3 py-4 align-top break-words">
                              {renderContacts(trial)}
                            </td>
                            <td className="px-3 py-4 text-right align-top">
                              {inWatchlist ? (
                                <button onClick={() => removeFromWatchlist(trial.nctId)} className="inline-flex items-center justify-center space-x-1 px-3 py-1.5 rounded text-xs font-medium bg-green-100 text-green-800 hover:bg-red-100 hover:text-red-700 transition-colors">
                                  <Trash2 className="w-3 h-3" /> <span>Untrack</span>
                                </button>
                              ) : (
                                <div className="flex flex-col gap-2 items-end">
                                  <button onClick={() => addToWatchlist(trial, false)} className="inline-flex w-[90px] items-center justify-center space-x-1 px-2 py-1.5 rounded text-[11px] font-medium bg-white border border-neutral-300 hover:bg-neutral-50 transition-colors">
                                    <Plus className="w-3 h-3" /> <span>Track</span>
                                  </button>
                                  <button onClick={() => addToWatchlist(trial, true)} className="inline-flex w-[90px] items-center justify-center space-x-1 px-2 py-1.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors">
                                    <Star className="w-3 h-3" fill="currentColor" /> <span>Priority</span>
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
          </div>
        )}

        {/* WATCHLIST TAB */}
        {activeTab === 'watchlist' && (
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white p-4 rounded-xl shadow-sm border border-neutral-200 gap-4">
              <div>
                <h2 className="text-lg font-bold text-neutral-900 leading-tight">Active Watchlist</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                <select value={watchlistTopicId} onChange={(e) => setWatchlistTopicId(e.target.value)} className="px-2 py-1.5 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white min-w-[120px]">
                  <option value="all">All Topics</option>
                  {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <div className="relative flex-grow lg:flex-grow-0 lg:w-48">
                  <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 transform -translate-y-1/2 text-neutral-400" />
                  <input type="text" placeholder="Filter..." value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} className="w-full pl-7 pr-2 py-1.5 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"/>
                </div>
                <select value={watchlistSort} onChange={(e) => setWatchlistSort(e.target.value)} className="px-2 py-1.5 border border-neutral-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white">
                  <option value="date">Sort: Newest</option>
                  <option value="priority">Sort: Priority</option>
                  <option value="updates">Sort: Updates</option>
                  <option value="enrollment">Sort: Patients</option>
                </select>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button onClick={checkWatchlistUpdates} disabled={updatesLoading} className="px-3 py-1.5 border border-neutral-300 text-neutral-700 rounded text-xs font-medium hover:bg-neutral-50 flex items-center justify-center space-x-1 flex-1 sm:flex-none">
                    <RefreshCw className={`w-3.5 h-3.5 ${updatesLoading ? 'animate-spin' : ''}`} />
                    <span>{updatesLoading ? 'Wait...' : 'Refresh'}</span>
                  </button>
                  <button onClick={generateReport} disabled={watchlist.length === 0} className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-medium hover:bg-slate-800 flex items-center justify-center space-x-1 flex-1 sm:flex-none">
                    <FileText className="w-3.5 h-3.5" />
                    <span>Export</span>
                  </button>
                </div>
              </div>
            </div>

            {watchlist.length === 0 ? (
              <div className="text-center py-12 text-neutral-500 text-sm bg-white border border-neutral-200 rounded-xl">Watchlist is empty.</div>
            ) : processedWatchlist.length === 0 ? (
              <div className="text-center py-12 text-neutral-500 text-sm bg-white border border-neutral-200 rounded-xl">No trials match filter.</div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse table-fixed min-w-[900px]">
                    <thead>
                      <tr className="bg-neutral-50 text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                        <th className="px-3 py-2 font-semibold w-[35%]">Study, Sponsor & Endpoints</th>
                        <th className="px-3 py-2 font-semibold w-[15%]">Timeline</th>
                        <th className="px-3 py-2 font-semibold w-[15%]">Size & Locations</th>
                        <th className="px-3 py-2 font-semibold w-[20%]">Contacts</th>
                        <th className="px-3 py-2 font-semibold text-right w-[15%]">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 text-xs">
                      {processedWatchlist.map((trial) => {
                        const rowClass = trial.hasUpdates ? 'bg-red-50' : trial.isHighPriority ? 'bg-amber-50/40' : 'bg-white hover:bg-neutral-50';
                        return (
                          <React.Fragment key={trial.nctId}>
                            <tr className={`${rowClass} transition-colors border-b-0`}>
                              <td className="px-3 pt-3 pb-1 align-top break-words">
                                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                  <button onClick={() => togglePriority(trial.nctId, trial.isHighPriority)} className="focus:outline-none group mt-0.5" title="Toggle High Priority">
                                    <Star fill={trial.isHighPriority ? "currentColor" : "none"} className={`w-3.5 h-3.5 transition-colors ${trial.isHighPriority ? 'text-amber-500' : 'text-neutral-300 group-hover:text-amber-500'}`} />
                                  </button>
                                  <a href={`https://clinicaltrials.gov/study/${trial.nctId}`} target="_blank" rel="noreferrer" className="text-blue-600 font-mono text-[11px] hover:underline">{trial.nctId}</a>
                                  <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${trial.nctId}`} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-blue-600"><BookOpen className="w-3 h-3" /></a>
                                  {trial.topicId && topics.find(t => t.id === trial.topicId) && (
                                    <span className="text-[9px] uppercase font-bold tracking-wider text-blue-700 bg-blue-100 px-1 py-0.5 rounded">{topics.find(t => t.id === trial.topicId)?.name}</span>
                                  )}
                                  {trial.hasUpdates && <span className="bg-red-500 text-white text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1"><Bell className="w-2.5 h-2.5"/> Update</span>}
                                </div>
                                <p className="font-semibold text-neutral-900 mb-0.5 leading-snug">{trial.title}</p>
                                <div className="text-[11px] text-neutral-600 mb-2 line-clamp-2" title={trial.sponsor}>{trial.sponsor}</div>
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {trial.phases.map(p => <span key={p} className="bg-slate-200 text-slate-800 text-[9px] px-1 py-0.5 rounded font-bold">{p}</span>)}
                                  {trial.interventions?.slice(0, 4).map((inv, idx) => (
                                    <span key={idx} className="bg-neutral-100 text-neutral-600 text-[9px] px-1.5 py-0.5 rounded border border-neutral-200 line-clamp-1 max-w-[150px] font-normal" title={inv}>{inv}</span>
                                  ))}
                                  {trial.interventions?.length > 4 && (
                                    <span className="bg-neutral-100 text-neutral-600 text-[9px] px-1.5 py-0.5 rounded border border-neutral-200 cursor-help whitespace-nowrap font-normal" title={trial.interventions.join(', ')}>
                                      ... (+{trial.interventions.length - 4})
                                    </span>
                                  )}
                                </div>
                                
                                {trial.hasUpdates && (
                                  <div className="mb-2 p-1.5 bg-white rounded border border-red-200 text-[11px] shadow-sm">
                                    {trial.previousStatus && trial.previousStatus !== trial.status && (
                                      <div className="text-red-700"><strong>Status:</strong> <span className="line-through opacity-60">{trial.previousStatus.replace(/_/g, ' ')}</span> &rarr; {trial.status.replace(/_/g, ' ')}</div>
                                    )}
                                    {trial.previousDate && trial.previousDate !== trial.primaryCompletionDate && (
                                      <div className="text-red-700"><strong>Date:</strong> <span className="line-through opacity-60">{trial.previousDate}</span> &rarr; {trial.primaryCompletionDate}</div>
                                    )}
                                  </div>
                                )}

                                {trial.primaryOutcomes?.length > 0 && (
                                  <div className="mt-1 text-[11px] text-neutral-600 bg-white/50 p-2 rounded border border-neutral-100 max-h-24 overflow-y-auto">
                                    <strong className="text-neutral-800 block mb-0.5">Primary Endpoints:</strong>
                                    <ul className="list-disc pl-4 space-y-0.5">
                                      {trial.primaryOutcomes.map((outcome, idx) => <li key={idx} className="line-clamp-2" title={outcome}>{outcome}</li>)}
                                    </ul>
                                  </div>
                                )}
                              </td>
                              <td className="px-3 pt-3 pb-1 align-top whitespace-nowrap">
                                <div className="font-medium text-neutral-900 mb-1">{trial.status.replace(/_/g, ' ')}</div>
                                <div className="text-[11px] text-neutral-600">Pri: {trial.primaryCompletionDate}</div>
                                <div className="text-[11px] text-neutral-500 mb-2">Std: {trial.studyCompletionDate}</div>
                                <div className="text-[9px] text-neutral-400">Reg: {trial.firstSubmittedDate}</div>
                                <div className="text-[9px] text-neutral-400">Upd: {trial.lastUpdateDate}</div>
                              </td>
                              <td className="px-3 pt-3 pb-1 align-top break-words">
                                <div className="font-bold text-neutral-900 mb-0.5">n = {trial.enrollment}</div>
                                <div className="text-[11px] text-neutral-600 mb-1">{trial.sitesCount} Sites</div>
                                {trial.countries?.length > 0 && (
                                  <div className="text-[10px] text-neutral-500 line-clamp-2" title={trial.countries.join(', ')}>{trial.countries.join(', ')}</div>
                                )}
                              </td>
                              <td className="px-3 pt-3 pb-1 align-top break-words">
                                {renderContacts(trial)}
                              </td>
                              <td className="px-3 pt-3 pb-1 text-right align-top">
                                <div className="flex flex-col gap-2 items-end">
                                  {trial.hasUpdates && (
                                     <button onClick={() => acknowledgeUpdates(trial.nctId)} className="inline-flex w-[90px] items-center justify-center px-2 py-1.5 rounded text-[11px] font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
                                       Ack
                                     </button>
                                  )}
                                  <button onClick={() => removeFromWatchlist(trial.nctId)} className="inline-flex w-[90px] items-center justify-center space-x-1 px-2 py-1.5 rounded text-[11px] font-medium bg-white border border-neutral-300 text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors">
                                    <Trash2 className="w-3 h-3" /> <span>Remove</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                            <tr className={`${rowClass} transition-colors`}>
                              <td colSpan="5" className="px-3 pb-3 pt-1 border-t-0">
                                <div className="flex items-center gap-2 border-t border-neutral-200/50 pt-2">
                                  <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider">Notes</span>
                                  <input type="text" defaultValue={trial.notes || ''} onBlur={(e) => saveNotes(trial.nctId, e.target.value)} placeholder="Add internal notes regarding trial status, PI outreach, etc..." className="w-full px-2 py-1.5 bg-white/60 border border-neutral-200 rounded text-[11px] focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none transition-colors" />
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
      </main>
    </div>
  );
}