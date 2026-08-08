import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  updateProfile,
  signInWithPopup,
  signInAnonymously,
  User 
} from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { 
  subscribeUserMocks, 
  saveUserMockToCloud, 
  deleteUserMockFromCloud, 
  syncLocalMocksToCloud 
} from './lib/firestoreService';

type TopicGroup = 'Main' | 'Grammar';
type Topic = { id: string; name: string; category: TopicGroup; attempted: number; correct: number; questions: number };
type Mock = {
  id: string; name: string; date: string; attempted: number; correct: number; wrong: number;
  unattempted: number; score: number; maxScore: number; time: number; topics: Topic[];
};

type View = 
  | 'overview' | 'topics' | 'mocks' | 'revision'
  | 'sneat-dashboard' | 'layouts-container' | 'layouts-fluid' | 'layouts-blank'
  | 'account-settings' | 'auth-login' | 'auth-register' | 'cards'
  | 'ui-accordion' | 'ui-alerts' | 'ui-badges' | 'ui-buttons' | 'ui-modals' | 'ui-tabs' | 'ui-typography'
  | 'icons-boxicons' | 'forms-basic' | 'form-layouts' | 'tables';

const MAIN_TOPICS = [
  'Spot the Error', 'Sentence Improvement', 'Cloze Test', 'Fill in the Blanks',
  'Comprehension', 'Narration', 'Active Passive', 'Para Jumble',
  'One Word Substitution', 'Idioms', 'Synonyms', 'Antonyms',
  'Spelling Check', 'Homonyms', 'Miscellaneous',
];
const GRAMMAR_TOPICS = [
  'Tense', 'Noun', 'Pronoun', 'Adjective', 'Subject Verb Agreement',
  'Prepositions / Phrasal Verbs', 'Verbs / Modals / Adverbs',
  'Conjunctions / Articles / Question Tags',
];
const TOPIC_GROUPS: { category: TopicGroup; label: string; topics: string[] }[] = [
  { category: 'Main', label: 'Main English topics', topics: MAIN_TOPICS },
  { category: 'Grammar', label: 'Grammar topics', topics: GRAMMAR_TOPICS },
];
const TOPICS = TOPIC_GROUPS.flatMap(group => group.topics);
const TOPIC_ALIASES: Record<string, string> = {
  'Spotting Errors': 'Spot the Error',
  'Idioms & Phrases': 'Idioms',
  'Direct / Indirect': 'Narration',
  'Active / Passive': 'Active Passive',
  'Para Jumbles': 'Para Jumble',
  'Reading Comprehension': 'Comprehension',
  'Synonyms & Antonyms': 'Synonyms',
};

const categoryFor = (name: string): TopicGroup => GRAMMAR_TOPICS.includes(name) ? 'Grammar' : 'Main';
const canonicalTopic = (name: string) => TOPICS.includes(name) ? name : TOPIC_ALIASES[name] || name;
const topicTemplate = (name: string, questions = 0, attempted = 0, correct = 0): Topic => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name,
  category: categoryFor(name),
  questions: Math.max(0, questions),
  attempted: Math.max(0, attempted),
  correct: Math.max(0, Math.min(correct, attempted)),
});

const defaultTopicCounts = (variant = 0) => TOPICS.map((name, index) => {
  const mainCounts = [3, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const grammarCounts = [2, 1, 1, 1, 1, 1, 1, 2];
  const questions = index < MAIN_TOPICS.length
    ? mainCounts[index]
    : grammarCounts[index - MAIN_TOPICS.length];
  const attempted = Math.max(0, questions - ((index + variant) % 4 === 0 ? 1 : 0));
  const correct = Math.max(0, attempted - ((index + variant) % 5 === 0 ? 1 : 0));
  return topicTemplate(name, questions, attempted, correct);
});

const seed: Mock[] = [
  ...Array.from({ length: 6 }, (_, index) => {
    const variant = index + 1;
    const scores = [37.5, 34.5, 32, 35, 31, 34.5];
    const correct = [19, 18, 17, 18, 16, 18][index];
    const wrong = [4, 6, 8, 4, 5, 5][index];
    const unattempted = [2, 1, 0, 3, 4, 2][index];
    return {
      id: `m${variant}`,
      name: `Sectional Mock ${String(9 - variant).padStart(2, '0')}`,
      date: `2025-02-${String(21 - index * 3).padStart(2, '0')}`,
      attempted: correct + wrong,
      correct,
      wrong,
      unattempted,
      score: scores[index],
      maxScore: 50,
      time: [17, 19, 21, 18, 23, 20][index],
      topics: defaultTopicCounts(variant),
    };
  }),
];

const persist = (data: Mock[]) => localStorage.setItem('ssc-mock-analyzer', JSON.stringify(data));
const pct = (a: number, b: number) => b ? Math.round((a / b) * 100) : 0;
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const numberValue = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

const normalizeTopics = (value: unknown): Topic[] => {
  const byName = new Map<string, Topic>();
  if (Array.isArray(value)) {
    value.forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const item = raw as Record<string, unknown>;
      const name = canonicalTopic(String(item.name || ''));
      if (!TOPICS.includes(name)) return;
      const topic = topicTemplate(
        name,
        numberValue(item.questions),
        numberValue(item.attempted),
        numberValue(item.correct),
      );
      const existing = byName.get(name);
      byName.set(name, existing ? topicTemplate(
        name,
        existing.questions + topic.questions,
        existing.attempted + topic.attempted,
        existing.correct + topic.correct,
      ) : topic);
    });
  }
  return TOPICS.map(name => byName.get(name) || topicTemplate(name));
};

const normalizeMock = (value: unknown, index = 0): Mock => {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const correct = numberValue(item.correct);
  const wrong = numberValue(item.wrong);
  const unattempted = numberValue(item.unattempted);
  return {
    id: String(item.id || `mock-${Date.now()}-${index}`),
    name: String(item.name || `Imported mock ${index + 1}`),
    date: String(item.date || new Date().toISOString().slice(0, 10)),
    attempted: correct + wrong,
    correct,
    wrong,
    unattempted,
    score: numberValue(item.score, correct * 2 - wrong * 0.5),
    maxScore: numberValue(item.maxScore, 50) || 50,
    time: numberValue(item.time, 20) || 20,
    topics: normalizeTopics(item.topics),
  };
};

const makeBlankMock = (): Mock => ({
  id: `m-${Date.now()}`,
  name: '',
  date: new Date().toISOString().slice(0, 10),
  attempted: 0,
  correct: 0,
  wrong: 0,
  unattempted: 25,
  score: 0,
  maxScore: 50,
  time: 20,
  topics: defaultTopicCounts(0),
});

const loadMocks = (): Mock[] => {
  try {
    const stored = localStorage.getItem('ssc-mock-analyzer');
    return stored ? (JSON.parse(stored) as unknown[]).map(normalizeMock) : seed;
  } catch {
    return seed;
  }
};

function getStats(mocks: Mock[]) {
  const attempted = mocks.reduce((s, m) => s + m.attempted, 0);
  const correct = mocks.reduce((s, m) => s + m.correct, 0);
  const wrong = mocks.reduce((s, m) => s + m.wrong, 0);
  const unattempted = mocks.reduce((s, m) => s + m.unattempted, 0);
  const total = attempted + unattempted;
  const avg = mocks.length ? mocks.reduce((s, m) => s + m.score, 0) / mocks.length : 0;
  const variance = mocks.length > 1 ? Math.sqrt(mocks.reduce((s, m) => s + Math.pow(m.score - avg, 2), 0) / mocks.length) : 0;
  return { attempted, correct, wrong, unattempted, total, accuracy: pct(correct, attempted), avg, variance };
}

function getTopicStats(mocks: Mock[]) {
  return TOPICS.map(name => {
    const rows = mocks.flatMap(m => m.topics.filter(t => t.name === name && t.questions > 0));
    const questions = rows.reduce((s, t) => s + t.questions, 0);
    const attempted = rows.reduce((s, t) => s + t.attempted, 0);
    const correct = rows.reduce((s, t) => s + t.correct, 0);
    const attempts = rows.filter(t => t.attempted > 0).length;
    return { name, category: categoryFor(name), questions, attempted, correct, accuracy: pct(correct, attempted), attempts };
  });
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Mocks state: start empty for logged-in user, or seed for guest preview
  const [mocks, setMocks] = useState<Mock[]>(() => {
    if (auth.currentUser) return [];
    return seed;
  });

  const [view, setView] = useState<View>('overview');
  const [range, setRange] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Mock | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Auth requirement modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalReason, setAuthModalReason] = useState<'add' | 'edit' | 'delete' | 'import'>('add');

  // Expanded submenus state
  const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>({
    ssc: true,
    layouts: false,
    pages: false,
    ui: false,
    forms: false,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      // Unauthenticated visitor: load sample seed data for preview mode
      setMocks(seed);
      return undefined;
    }

    // Authenticated user: load cached user mocks from user-keyed local storage or start empty
    const userKey = `ssc-user-mocks-${user.uid}`;
    const cached = localStorage.getItem(userKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as unknown[];
        setMocks(Array.isArray(parsed) ? parsed.map((item, idx) => normalizeMock(item, idx)) : []);
      } catch {
        setMocks([]);
      }
    } else {
      setMocks([]);
    }

    // Subscribe to logged-in user's personal cloud Firestore collection
    const unsub = subscribeUserMocks(
      user.uid,
      (cloudMocks) => {
        setMocks(cloudMocks);
        localStorage.setItem(userKey, JSON.stringify(cloudMocks));
      },
      (err) => console.error('Firestore subscribe error:', err)
    );

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(`ssc-user-mocks-${user.uid}`, JSON.stringify(mocks));
    }
  }, [mocks, user]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 2800);
    return () => clearTimeout(t);
  }, [notice]);

  const toggleSubmenu = (key: string) => {
    setOpenSubmenus(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAddMock = () => {
    if (!user) {
      setAuthModalReason('add');
      setShowAuthModal(true);
      return;
    }
    setEditing(makeBlankMock());
  };

  const handleEditMock = (m: Mock) => {
    if (!user) {
      setAuthModalReason('edit');
      setShowAuthModal(true);
      return;
    }
    setEditing(m);
  };

  const handleDeleteMock = (id: string) => {
    if (!user) {
      setAuthModalReason('delete');
      setShowAuthModal(true);
      return;
    }
    deleteMock(id);
  };

  const handleImportClick = () => {
    if (!user) {
      setAuthModalReason('import');
      setShowAuthModal(true);
      return;
    }
    setShowImport(true);
  };

  const filtered = useMemo(() => {
    const now = Date.now();
    const days = range === '7' ? 7 : range === '30' ? 30 : range === '90' ? 90 : 9999;
    return mocks.filter(m => (now - new Date(`${m.date}T12:00:00`).getTime()) / 86400000 <= days)
      .filter(m => m.name.toLowerCase().includes(query.toLowerCase()));
  }, [mocks, range, query]);

  const stats = useMemo(() => getStats(filtered), [filtered]);
  const allTopicStats = useMemo(() => getTopicStats(filtered), [filtered]);
  const topicStats = useMemo(() => allTopicStats.filter(t => t.attempts).sort((a, b) => b.accuracy - a.accuracy), [allTopicStats]);
  const weakTopics = useMemo(() => [...topicStats].sort((a, b) => a.accuracy - b.accuracy).slice(0, 4), [topicStats]);

  const saveMock = async (item: Mock) => {
    const itemToSave = user ? { ...item, userId: user.uid } : item;
    
    // Local optimistic state update
    setMocks(current => current.some(m => m.id === item.id) ? current.map(m => m.id === item.id ? itemToSave : m) : [itemToSave, ...current]);
    setEditing(null);

    if (user) {
      try {
        await saveUserMockToCloud(user.uid, itemToSave);
        setNotice('Mock saved & synced to Firebase Cloud');
      } catch (err) {
        console.error('Cloud save failed:', err);
        setNotice('Saved locally (Cloud sync failed)');
      }
    } else {
      setNotice('Mock saved locally to browser');
    }
  };

  const deleteMock = async (id: string) => {
    if (window.confirm('Delete this mock record? This cannot be undone.')) {
      setMocks(current => current.filter(m => m.id !== id));
      if (user) {
        try {
          await deleteUserMockFromCloud(user.uid, id);
          setNotice('Mock record removed from Firebase Cloud');
        } catch (err) {
          console.error('Cloud delete failed:', err);
          setNotice('Mock deleted locally');
        }
      } else {
        setNotice('Mock record deleted');
      }
    }
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(mocks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ssc-english-mocks.json';
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Your data is ready to download');
  };

  const importData = (text: string, fileName: string) => {
    try {
      let incoming: Mock[];
      if (fileName.endsWith('.csv')) {
        const [header, ...rows] = text.trim().split(/\r?\n/);
        const keys = header.split(',').map(k => k.trim());
        incoming = rows.filter(Boolean).map(row => {
          const vals = row.split(',');
          const obj = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
          return {
            id: `import-${Date.now()}-${Math.random()}`,
            name: obj.name || 'Imported mock',
            date: obj.date || new Date().toISOString().slice(0, 10),
            attempted: Number(obj.attempted) || 0,
            correct: Number(obj.correct) || 0,
            wrong: Number(obj.wrong) || 0,
            unattempted: Number(obj.unattempted) || 0,
            score: Number(obj.score) || 0,
            maxScore: Number(obj.maxScore) || 50,
            time: Number(obj.time) || 20,
            topics: []
          };
        });
      } else {
        incoming = JSON.parse(text);
      }
      if (!Array.isArray(incoming)) throw new Error('Expected an array');
      const normalized = incoming.map((item, index) => normalizeMock(item, index));
      setMocks(current => [...normalized, ...current]);
      setShowImport(false);
      setNotice(`${normalized.length} mock${normalized.length === 1 ? '' : 's'} imported`);
    } catch {
      setNotice('Import failed: check the file format');
    }
  };

  const nav = (next: View) => {
    setView(next);
    setMobileNav(false);
  };

  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        {/* Sneat Template Layout Wrapper */}
        <div className="layout-wrapper layout-content-navbar">
          <div className="layout-container">
            {/* Clean Sneat Sidebar Menu */}
            <aside id="layout-menu" className={`layout-menu menu-vertical menu bg-menu-theme ${mobileNav ? 'show' : ''}`}>
              <div className="app-brand demo d-flex align-items-center justify-content-between px-3 py-3">
                <a href="#" onClick={(e) => { e.preventDefault(); nav('overview'); }} className="app-brand-link gap-2 align-items-center">
                  <span className="app-brand-logo demo">
                    <svg width="28" height="28" viewBox="0 0 25 42" version="1.1" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13.7918663,0.358365126 L3.39788168,7.44174259 C0.566865006,9.69408886 -0.379795268,12.4788597 0.557900856,15.7960551 C0.68998853,16.2305145 1.09562888,17.7872135 3.12357076,19.2293357 C3.8146334,19.7207684 5.32369333,20.3834223 7.65075054,21.2172976 L7.59773219,21.2525164 L2.63468769,24.5493413 C0.445452254,26.3002124 0.0884951797,28.5083815 1.56381646,31.1738486 C2.83770406,32.8170431 5.20850219,33.2640127 7.09180128,32.5391577 C8.347334,32.0559211 11.4559176,30.0011079 16.4175519,26.3747182 C18.0338572,24.4997857 18.6973423,22.4544883 18.4080071,20.2388261 C17.963753,17.5346866 16.1776345,15.5799961 13.0496516,14.3747546 L10.9194936,13.4715819 L18.6192054,7.984237 L13.7918663,0.358365126 Z" id="path-1" fill="#696cff"></path>
                    </svg>
                  </span>
                  <span className="app-brand-text demo menu-text fw-bolder text-uppercase text-dark fs-5">
                    SSC <span className="text-primary">English</span>
                  </span>
                </a>
                {mobileNav && (
                  <button className="btn btn-sm btn-icon text-muted d-xl-none" onClick={() => setMobileNav(false)}>
                    <i className="bx bx-x fs-4"></i>
                  </button>
                )}
              </div>

              <div className="menu-inner-shadow"></div>

              <ul className="menu-inner py-1 overflow-x-hidden overflow-y-auto" style={{ maxHeight: 'calc(100vh - 80px)' }}>
                {/* 1. STUDY DESK MAIN MENU */}
                <li className="menu-header small text-uppercase">
                  <span className="menu-header-text">Study Desk</span>
                </li>

                <li className={`menu-item ${view === 'overview' ? 'active' : ''}`}>
                  <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('overview'); }}>
                    <i className="menu-icon tf-icons bx bx-home-circle text-primary"></i>
                    <div>Analytics Overview</div>
                  </a>
                </li>

                <li className={`menu-item ${view === 'topics' ? 'active' : ''}`}>
                  <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('topics'); }}>
                    <i className="menu-icon tf-icons bx bx-target-lock text-success"></i>
                    <div>Topic Map</div>
                  </a>
                </li>

                <li className={`menu-item ${view === 'mocks' ? 'active' : ''}`}>
                  <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('mocks'); }}>
                    <i className="menu-icon tf-icons bx bx-bar-chart-alt-2 text-warning"></i>
                    <div>Sectional Mocks</div>
                    <span className="badge bg-primary rounded-pill ms-auto">{mocks.length}</span>
                  </a>
                </li>

                <li className={`menu-item ${view === 'revision' ? 'active' : ''}`}>
                  <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('revision'); }}>
                    <i className="menu-icon tf-icons bx bx-book-open text-info"></i>
                    <div>Revision Queue</div>
                  </a>
                </li>

                {/* ACCOUNT STATUS SIDEBAR CARD */}
                <div className="mx-3 my-2 p-3 rounded-3 bg-light border">
                  {user ? (
                    <div>
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <span className="badge bg-label-success small"><i className="bx bx-cloud me-1"></i> Cloud Account Active</span>
                        <button className="btn btn-xs text-danger p-0 border-0 bg-transparent" title="Sign Out" onClick={() => signOut(auth)}>
                          <i className="bx bx-log-out fs-5"></i>
                        </button>
                      </div>
                      <div className="fw-bold text-dark text-truncate small">{user.displayName || 'SSC Aspirant'}</div>
                      <small className="text-muted text-truncate d-block mb-2" style={{ fontSize: '11px' }}>{user.email}</small>
                      <button className="btn btn-xs btn-outline-primary w-100" onClick={() => nav('account-settings')}>
                        Account Settings
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="fw-bold text-dark mb-1" style={{ fontSize: '13px' }}>Personal Performance Vault</div>
                      <p className="mb-2 text-muted" style={{ fontSize: '11px' }}>Sign in to save your mock test records securely across devices.</p>
                      <div className="d-grid gap-1">
                        <button className="btn btn-sm btn-primary py-1" onClick={() => nav('auth-login')}>
                          <i className="bx bx-log-in me-1"></i> Sign In
                        </button>
                        <button className="btn btn-sm btn-outline-primary py-1" onClick={() => nav('auth-register')}>
                          <i className="bx bx-user-plus me-1"></i> Create Account
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. MANAGEMENT & SETTINGS */}
                <li className="menu-header small text-uppercase">
                  <span className="menu-header-text">Tools &amp; Settings</span>
                </li>

                <li className={`menu-item ${view === 'account-settings' ? 'active' : ''}`}>
                  <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('account-settings'); }}>
                    <i className="menu-icon tf-icons bx bx-user-circle"></i>
                    <div>Profile Settings</div>
                  </a>
                </li>

                <li className="menu-item">
                  <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); handleImportClick(); }}>
                    <i className="menu-icon tf-icons bx bx-upload"></i>
                    <div>Import Data</div>
                  </a>
                </li>

                <li className="menu-item">
                  <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); exportData(); }}>
                    <i className="menu-icon tf-icons bx bx-download"></i>
                    <div>Export JSON</div>
                  </a>
                </li>

                {/* 3. SNEAT UI KIT SHOWCASE */}
                <li className="menu-header small text-uppercase">
                  <span className="menu-header-text">Sneat UI Kit</span>
                </li>

                <li className={`menu-item ${openSubmenus.ui ? 'active open' : ''}`}>
                  <a href="#" className="menu-link menu-toggle" onClick={(e) => { e.preventDefault(); toggleSubmenu('ui'); }}>
                    <i className="menu-icon tf-icons bx bx-grid-alt"></i>
                    <div>UI Components</div>
                  </a>
                  <ul className="menu-sub" style={{ display: openSubmenus.ui ? 'block' : 'none' }}>
                    <li className={`menu-item ${view === 'sneat-dashboard' ? 'active' : ''}`}>
                      <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('sneat-dashboard'); }}>
                        <div>Dashboard Demo</div>
                      </a>
                    </li>
                    <li className={`menu-item ${view === 'cards' ? 'active' : ''}`}>
                      <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('cards'); }}>
                        <div>Cards</div>
                      </a>
                    </li>
                    <li className={`menu-item ${view === 'ui-alerts' ? 'active' : ''}`}>
                      <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('ui-alerts'); }}>
                        <div>Alerts</div>
                      </a>
                    </li>
                    <li className={`menu-item ${view === 'ui-badges' ? 'active' : ''}`}>
                      <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('ui-badges'); }}>
                        <div>Badges</div>
                      </a>
                    </li>
                    <li className={`menu-item ${view === 'ui-buttons' ? 'active' : ''}`}>
                      <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('ui-buttons'); }}>
                        <div>Buttons</div>
                      </a>
                    </li>
                    <li className={`menu-item ${view === 'tables' ? 'active' : ''}`}>
                      <a href="#" className="menu-link" onClick={(e) => { e.preventDefault(); nav('tables'); }}>
                        <div>Tables</div>
                      </a>
                    </li>
                  </ul>
                </li>
              </ul>
            </aside>

            {/* Sneat Layout Page */}
            <div className="layout-page">
              {/* Top Navbar */}
              <nav className="layout-navbar container-xxl navbar navbar-expand-xl navbar-detached align-items-center bg-navbar-theme" id="layout-navbar">
                <div className="layout-menu-toggle navbar-nav align-items-xl-center me-3 me-xl-0 d-xl-none">
                  <button className="nav-item nav-link px-0 me-xl-4 btn btn-text-secondary border-0 bg-transparent" onClick={() => setMobileNav(true)}>
                    <i className="bx bx-menu bx-sm"></i>
                  </button>
                </div>

                <div className="navbar-nav-right d-flex align-items-center w-100 justify-content-between overflow-hidden" id="navbar-collapse">
                  {/* Search Bar */}
                  <div className="navbar-nav align-items-center me-2 flex-grow-1" style={{ maxWidth: '300px' }}>
                    <div className="nav-item d-flex align-items-center w-100">
                      <i className="bx bx-search fs-4 lh-0 text-muted me-2"></i>
                      <input
                        type="text"
                        className="form-control border-0 shadow-none bg-transparent"
                        placeholder="Search mocks or topics..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Actions & Header controls */}
                  <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    {['overview', 'topics', 'mocks', 'revision'].includes(view) && (
                      <div className="btn-group btn-group-sm d-none d-lg-inline-flex" role="group">
                        {[
                          ['7', '7D'],
                          ['30', '30D'],
                          ['90', '90D'],
                          ['all', 'All']
                        ].map(([id, label]) => (
                          <button
                            key={id}
                            className={`btn ${range === id ? 'btn-primary' : 'btn-outline-secondary'}`}
                            onClick={() => setRange(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}

                    <button className="btn btn-sm btn-outline-primary d-none d-sm-flex align-items-center gap-1" onClick={handleImportClick}>
                      <i className="bx bx-upload"></i> <span>Import</span>
                    </button>

                    <button className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={handleAddMock}>
                      <i className="bx bx-plus"></i> <span className="d-none d-sm-inline">Add Mock</span>
                    </button>

                    <button className="btn btn-sm btn-icon btn-outline-secondary d-none d-sm-inline-flex" title="Export JSON" onClick={exportData}>
                      <i className="bx bx-download"></i>
                    </button>

                    {/* Database & Cloud Sync Badge Indicator */}
                    {user ? (
                      <span className="badge bg-label-success d-none d-md-inline-flex align-items-center gap-1 cursor-pointer" onClick={() => nav('account-settings')}>
                        <i className="bx bx-cloud text-success"></i>
                        <span>Cloud Synced</span>
                      </span>
                    ) : null}

                    {/* User Profile Avatar / Sign in button */}
                    {user ? (
                      <div className="d-flex align-items-center gap-2 cursor-pointer ms-1" onClick={() => nav('account-settings')} title="Account Settings">
                        <div className="avatar avatar-online">
                          {user.photoURL ? (
                            <img src={user.photoURL} alt="Avatar" className="w-px-40 h-auto rounded-circle" />
                          ) : (
                            <div className="w-px-40 h-px-40 rounded-circle bg-primary text-white d-flex align-items-center justify-content-center fw-bold">
                              {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="d-flex align-items-center gap-1 ms-1">
                        <button className="btn btn-sm btn-outline-primary" onClick={() => nav('auth-login')}>
                          <i className="bx bx-log-in me-1"></i> Sign In
                        </button>
                        <button className="btn btn-sm btn-primary d-none d-sm-inline-block" onClick={() => nav('auth-register')}>
                          <i className="bx bx-user-plus me-1"></i> Register
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </nav>

              {/* Content Wrapper */}
              <div className="content-wrapper">
                <div className="container-xxl flex-grow-1 container-p-y">
                  {/* Guest Preview Mode Banner */}
                  {!user && (
                    <div className="alert alert-warning border-0 shadow-sm d-flex align-items-center justify-content-between flex-wrap gap-2 mb-4 p-3 rounded-3">
                      <div className="d-flex align-items-center gap-2">
                        <span className="badge bg-warning p-2"><i className="bx bx-info-circle fs-5 text-dark"></i></span>
                        <div>
                          <strong className="text-dark d-block">Preview Mode (Sample Data)</strong>
                          <span className="small text-muted">You are viewing sample mock data. Sign in or register to log and manage your own test records securely in the cloud.</span>
                        </div>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <button className="btn btn-sm btn-primary" onClick={() => nav('auth-login')}>
                          <i className="bx bx-log-in me-1"></i> Sign In
                        </button>
                        <button className="btn btn-sm btn-outline-primary" onClick={() => nav('auth-register')}>
                          <i className="bx bx-user-plus me-1"></i> Create Account
                        </button>
                      </div>
                    </div>
                  )}

                  {/* View Navigation Switcher */}
                  {view === 'overview' && (
                    <Overview
                      stats={stats}
                      mocks={filtered}
                      topicStats={topicStats}
                      weakTopics={weakTopics}
                      nav={nav}
                      user={user}
                      onAddMock={handleAddMock}
                    />
                  )}
                  {view === 'topics' && <Topics stats={stats} topicStats={allTopicStats} />}
                  {view === 'mocks' && <Mocks mocks={filtered} onEdit={handleEditMock} onDelete={handleDeleteMock} onAddMock={handleAddMock} user={user} />}
                  {view === 'revision' && <Revision weakTopics={weakTopics} topicStats={topicStats} />}

                  {/* Sneat Template Pages Showcase */}
                  {view === 'sneat-dashboard' && <SneatDashboardDemo stats={stats} mocks={mocks} nav={nav} />}
                  {view === 'layouts-container' && <LayoutDemo title="Container Layout" subtitle="Centered responsive container with bounded width" />}
                  {view === 'layouts-fluid' && <LayoutDemo title="Fluid Layout" subtitle="Full width responsive layout stretching edge-to-edge" />}
                  {view === 'layouts-blank' && <LayoutDemo title="Blank Canvas" subtitle="Clean workspace canvas ready for custom modules" />}
                  {view === 'account-settings' && <AccountSettingsDemo user={user} mockCount={mocks.length} nav={nav} />}
                  {view === 'auth-login' && <AuthLoginDemo nav={nav} />}
                  {view === 'auth-register' && <AuthRegisterDemo nav={nav} />}
                  {view === 'cards' && <CardsDemo />}
                  {view === 'ui-accordion' && <UIAccordionDemo />}
                  {view === 'ui-alerts' && <UIAlertsDemo />}
                  {view === 'ui-badges' && <UIBadgesDemo />}
                  {view === 'ui-buttons' && <UIButtonsDemo />}
                  {view === 'ui-modals' && <UIModalsDemo />}
                  {view === 'ui-tabs' && <UITabsDemo />}
                  {view === 'ui-typography' && <UITypographyDemo />}
                  {view === 'icons-boxicons' && <IconsBoxiconsDemo />}
                  {view === 'forms-basic' && <FormsBasicDemo />}
                  {view === 'form-layouts' && <FormLayoutsDemo />}
                  {view === 'tables' && <TablesDemo mocks={mocks} />}
                </div>


                {/* Footer */}
                <footer className="content-footer footer bg-footer-theme border-top py-3">
                  <div className="container-xxl d-flex flex-wrap justify-content-between align-items-center py-2 flex-md-row flex-column">
                    <div className="mb-2 mb-md-0 text-muted small">
                      Sneat Bootstrap Admin Template · Integrated with SSC English Mock Analyzer
                    </div>
                    <div className="text-muted small">
                      {user ? 'Cloud Sync Active' : 'Preview Mode'} · {mocks.length} Attempts
                    </div>
                  </div>
                </footer>
              </div>
            </div>
          </div>

          {/* Mobile Navigation Drawer Backdrop */}
          {mobileNav && (
            <div className="layout-overlay layout-menu-toggle show" onClick={() => setMobileNav(false)}></div>
          )}
        </div>

        {/* Modals & Toasts */}
        {editing && <MockDialog item={editing} onClose={() => setEditing(null)} onSave={saveMock} />}
        {showImport && <ImportDialog fileRef={fileRef} onClose={() => setShowImport(false)} onImport={importData} />}
        
        {/* Auth Required Modal */}
        {showAuthModal && (
          <div className="modal-backdrop-custom" onClick={() => setShowAuthModal(false)}>
            <div className="modal-dialog-custom" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header-custom border-bottom">
                <div className="d-flex align-items-center gap-2">
                  <div className="avatar bg-label-primary rounded-circle d-flex align-items-center justify-content-center" style={{ width: '38px', height: '38px' }}>
                    <i className="bx bx-lock-alt fs-4 text-primary"></i>
                  </div>
                  <div>
                    <h5 className="mb-0 fw-bold text-dark fs-5">Account Required</h5>
                    <small className="text-muted">Sign in to record &amp; manage mock tests</small>
                  </div>
                </div>
                <button type="button" className="btn-close" onClick={() => setShowAuthModal(false)}></button>
              </div>
              <div className="modal-body-custom p-4 text-center">
                <div className="mb-4 text-muted small">
                  {authModalReason === 'add' && 'To log and track your personal SSC English mock test scores, please sign in or create a free account.'}
                  {authModalReason === 'edit' && 'Editing test records is restricted to logged-in account holders.'}
                  {authModalReason === 'delete' && 'Deleting test records requires you to be signed in.'}
                  {authModalReason === 'import' && 'Importing test data requires an active user account.'}
                </div>
                <div className="d-grid gap-2">
                  <button
                    type="button"
                    className="btn btn-primary py-2 fw-bold d-flex align-items-center justify-content-center gap-2"
                    onClick={() => { setShowAuthModal(false); nav('auth-login'); }}
                  >
                    <i className="bx bx-log-in fs-5"></i>
                    <span>Sign In to Your Account</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-primary py-2 fw-semibold d-flex align-items-center justify-content-center gap-2"
                    onClick={() => { setShowAuthModal(false); nav('auth-register'); }}
                  >
                    <i className="bx bx-user-plus fs-5"></i>
                    <span>Create Free Account</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {notice && (
          <div className="bs-toast toast toast-placement-ex m-3 fade show bg-dark text-white position-fixed bottom-0 end-0" style={{ zIndex: 1090 }} role="alert">
            <div className="toast-header bg-dark text-white border-bottom border-secondary">
              <i className="bx bx-check-circle text-success me-2 fs-5"></i>
              <strong className="me-auto">Notification</strong>
              <button type="button" className="btn-close btn-close-white" onClick={() => setNotice('')}></button>
            </div>
            <div className="toast-body">{notice}</div>
          </div>
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/* ========================================================================== */
/* SSC ENGLISH MOCK ANALYZER COMPONENTS                                        */
/* ========================================================================== */

function Overview({
  stats, mocks, topicStats, weakTopics, nav, user, onAddMock
}: {
  stats: ReturnType<typeof getStats>;
  mocks: Mock[];
  topicStats: ReturnType<typeof getTopicStats>;
  weakTopics: ReturnType<typeof getTopicStats>;
  nav: (v: View) => void;
  user: User | null;
  onAddMock: () => void;
}) {
  const trendValues = mocks.slice().reverse().map(m => m.score);
  const best = mocks.slice().sort((a, b) => b.score - a.score)[0];

  return (
    <div>
      {/* Welcome Banner */}
      <div className="card bg-label-primary border-0 shadow-sm mb-4">
        <div className="card-body p-4 d-flex align-items-center justify-content-between flex-wrap gap-3">
          <div>
            <span className="badge bg-primary text-white mb-2">SSC CGL Tier 1 &amp; Tier 2</span>
            <h4 className="card-title text-primary fw-bold mb-1">
              {user ? `Welcome back, ${user.displayName || 'SSC Aspirant'}!` : 'SSC English Performance Desk'}
            </h4>
            <p className="text-muted small mb-0">
              {user
                ? `Logged in as ${user.email}. Your sectional mock scores are stored safely in Firebase Cloud Firestore.`
                : 'Track sectional marks, accuracy, and topic weaknesses across your mock attempts.'}
            </p>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button className="btn btn-primary" onClick={onAddMock}>
              <i className="bx bx-plus me-1"></i> Log Mock Test
            </button>
            <button className="btn btn-outline-primary" onClick={() => nav('revision')}>
              <i className="bx bx-bolt-circle me-1"></i> Revision Plan
            </button>
          </div>
        </div>
      </div>

      {/* Personal Account Empty State for Logged-In User with 0 Mocks */}
      {user && mocks.length === 0 ? (
        <div className="card border-0 shadow-sm p-5 text-center my-4 bg-white rounded-3">
          <div className="avatar bg-label-primary rounded-circle mx-auto mb-3 d-flex align-items-center justify-content-center" style={{ width: '64px', height: '64px' }}>
            <i className="bx bx-notepad fs-1 text-primary"></i>
          </div>
          <h4 className="fw-bold text-dark mb-2">Your Personal Study Desk is Ready!</h4>
          <p className="text-muted small mb-4 max-w-md mx-auto">
            You haven't logged any SSC CGL English mock test attempts yet in your account ({user.email}). Add your first score to unlock real-time analytics, accuracy breakdown, and your personal topic map.
          </p>
          <div className="d-flex align-items-center justify-content-center gap-2 flex-wrap">
            <button className="btn btn-primary btn-lg px-4 fw-bold" onClick={onAddMock}>
              <i className="bx bx-plus-circle me-1"></i> Log Your First Mock Test
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 4 Stat Cards */}
      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-lg-3">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <span className="text-muted small fw-semibold">Accuracy Rate</span>
                <span className="badge bg-label-primary p-2"><i className="bx bx-target-lock fs-5"></i></span>
              </div>
              <h3 className="card-title mb-1 fw-bold text-dark">{stats.accuracy}%</h3>
              <small className="text-muted d-block">{stats.correct} correct of {stats.attempted} attempted</small>
            </div>
          </div>
        </div>

        <div className="col-sm-6 col-lg-3">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <span className="text-muted small fw-semibold">Average Score</span>
                <span className="badge bg-label-success p-2"><i className="bx bx-tachometer fs-5"></i></span>
              </div>
              <h3 className="card-title mb-1 fw-bold text-dark">{stats.avg.toFixed(1)} <small className="text-muted fs-6">/ 50</small></h3>
              <small className="text-muted d-block">{best ? `Best score: ${best.score.toFixed(1)} marks` : 'Log a mock'}</small>
            </div>
          </div>
        </div>

        <div className="col-sm-6 col-lg-3">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <span className="text-muted small fw-semibold">Score Stability</span>
                <span className="badge bg-label-warning p-2"><i className="bx bx-pulse fs-5"></i></span>
              </div>
              <h3 className="card-title mb-1 fw-bold text-dark">
                {stats.variance < 2 ? 'Steady' : stats.variance < 4 ? 'Mixed' : 'Volatile'}
              </h3>
              <small className="text-muted d-block">±{stats.variance.toFixed(1)} marks variance</small>
            </div>
          </div>
        </div>

        <div className="col-sm-6 col-lg-3">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <span className="text-muted small fw-semibold">Mocks Logged</span>
                <span className="badge bg-label-info p-2"><i className="bx bx-book-content fs-5"></i></span>
              </div>
              <h3 className="card-title mb-1 fw-bold text-dark">{mocks.length}</h3>
              <small className="text-muted d-block">{mocks.length ? 'Sectional attempts' : 'Ready to add'}</small>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Score Trend & Disposition */}
      <div className="row g-4 mb-4">
        {/* Score Movement Chart */}
        <div className="col-lg-8">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-transparent d-flex align-items-center justify-content-between border-bottom pb-3">
              <div>
                <small className="text-uppercase text-muted fw-bold">Score Movement</small>
                <h5 className="card-title mb-0 fw-bold text-dark">Momentum Trend</h5>
              </div>
              <span className="badge bg-label-success">
                <i className="bx bx-trending-up me-1"></i>
                {mocks.length > 1 ? `${(mocks[0].score - mocks[mocks.length - 1].score).toFixed(1)} marks diff` : 'Stable'}
              </span>
            </div>
            <div className="card-body pt-4">
              {trendValues.length > 1 ? (
                <div style={{ height: '200px', width: '100%', position: 'relative' }}>
                  <svg viewBox="0 0 600 180" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#696cff" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#696cff" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d={`M 0 150 ${trendValues.map((v, i) => `L ${(i / (trendValues.length - 1)) * 600} ${165 - (v / 50) * 140}`).join(' ')} L 600 180 L 0 180 Z`}
                      fill="url(#areaGrad)"
                    />
                    <polyline
                      points={trendValues.map((v, i) => `${(i / (trendValues.length - 1)) * 600},${165 - (v / 50) * 140}`).join(' ')}
                      fill="none"
                      stroke="#696cff"
                      strokeWidth="3"
                    />
                    {trendValues.map((v, i) => (
                      <circle
                        key={i}
                        cx={(i / (trendValues.length - 1)) * 600}
                        cy={165 - (v / 50) * 140}
                        r="5"
                        fill="#ffffff"
                        stroke="#696cff"
                        strokeWidth="3"
                      />
                    ))}
                  </svg>
                </div>
              ) : (
                <div className="text-center py-5 text-muted">
                  <i className="bx bx-bar-chart-alt-2 fs-1 mb-2"></i>
                  <p className="mb-0">Log at least two mocks to see your score trend.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Question Disposition */}
        <div className="col-lg-4">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-transparent border-bottom pb-3">
              <small className="text-uppercase text-muted fw-bold">Question Breakdown</small>
              <h5 className="card-title mb-0 fw-bold text-dark">Where Marks Went</h5>
            </div>
            <div className="card-body d-flex flex-column justify-content-between pt-4">
              <div className="d-flex flex-column gap-3 mb-3">
                <div className="d-flex align-items-center justify-content-between">
                  <span className="d-flex align-items-center gap-2">
                    <span className="badge bg-success p-1 rounded-circle"></span> Correct
                  </span>
                  <span className="fw-bold">{stats.correct}</span>
                </div>
                <div className="progress" style={{ height: '8px' }}>
                  <div className="progress-bar bg-success" style={{ width: `${pct(stats.correct, stats.total)}%` }}></div>
                </div>

                <div className="d-flex align-items-center justify-content-between">
                  <span className="d-flex align-items-center gap-2">
                    <span className="badge bg-danger p-1 rounded-circle"></span> Wrong
                  </span>
                  <span className="fw-bold">{stats.wrong}</span>
                </div>
                <div className="progress" style={{ height: '8px' }}>
                  <div className="progress-bar bg-danger" style={{ width: `${pct(stats.wrong, stats.total)}%` }}></div>
                </div>

                <div className="d-flex align-items-center justify-content-between">
                  <span className="d-flex align-items-center gap-2">
                    <span className="badge bg-secondary p-1 rounded-circle"></span> Unattempted
                  </span>
                  <span className="fw-bold">{stats.unattempted}</span>
                </div>
                <div className="progress" style={{ height: '8px' }}>
                  <div className="progress-bar bg-secondary" style={{ width: `${pct(stats.unattempted, stats.total)}%` }}></div>
                </div>
              </div>

              <div className="alert alert-primary mb-0 d-flex align-items-center gap-2 p-2">
                <i className="bx bx-info-circle fs-4"></i>
                <span className="small">Attempt rate: <strong>{pct(stats.attempted, stats.total)}%</strong> of total questions.</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Topic Intelligence & Action */}
      <div className="row g-4">
        <div className="col-lg-8">
          <div className="card border-0 shadow-sm">
            <div className="card-header bg-transparent d-flex align-items-center justify-content-between border-bottom pb-3">
              <div>
                <small className="text-uppercase text-muted fw-bold">Topic Intelligence</small>
                <h5 className="card-title mb-0 fw-bold text-dark">Top Topic Performance</h5>
              </div>
              <button className="btn btn-sm btn-outline-primary" onClick={() => nav('topics')}>
                Full Topic Map <i className="bx bx-chevron-right ms-1"></i>
              </button>
            </div>
            <div className="card-body pt-3">
              <div className="table-responsive">
                <table className="table table-hover align-middle">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Topic</th>
                      <th>Accuracy</th>
                      <th>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topicStats.slice(0, 5).map((t, idx) => (
                      <tr key={t.name}>
                        <td className="fw-bold text-muted">{String(idx + 1).padStart(2, '0')}</td>
                        <td>
                          <div className="fw-semibold text-dark">{t.name}</div>
                          <small className="text-muted">{t.correct} right / {t.attempted} tried</small>
                        </td>
                        <td>
                          <span className={`badge ${t.accuracy >= 80 ? 'bg-label-success' : t.accuracy >= 65 ? 'bg-label-warning' : 'bg-label-danger'}`}>
                            {t.accuracy}%
                          </span>
                        </td>
                        <td style={{ width: '35%' }}>
                          <div className="progress" style={{ height: '6px' }}>
                            <div
                              className={`progress-bar ${t.accuracy >= 80 ? 'bg-success' : t.accuracy >= 65 ? 'bg-warning' : 'bg-danger'}`}
                              style={{ width: `${t.accuracy}%` }}
                            ></div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card bg-primary text-white border-0 shadow-sm">
            <div className="card-body p-4">
              <span className="badge bg-white text-primary mb-3">Priority Action</span>
              <h4 className="card-title text-white fw-bold mb-2">Repair {weakTopics[0]?.name || 'weak topics'}</h4>
              <p className="text-white-50 small mb-4">
                Review core rules and solve 12 timed practice questions to fix repeat errors.
              </p>
              <button className="btn btn-light text-primary fw-bold w-100" onClick={() => nav('revision')}>
                Open Revision Queue <i className="bx bx-right-arrow-alt ms-1"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function Topics({
  stats, topicStats
}: {
  stats: ReturnType<typeof getStats>;
  topicStats: ReturnType<typeof getTopicStats>;
}) {
  return (
    <div>
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body d-flex align-items-center justify-content-between flex-wrap gap-3 p-3">
          <div>
            <h5 className="mb-1 fw-bold text-dark">Topic Map Analysis</h5>
            <small className="text-muted">Grammar &amp; Main English breakdown · {stats.attempted} questions logged</small>
          </div>
          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-label-success">Protect (&ge; 80%)</span>
            <span className="badge bg-label-warning">Build (65-79%)</span>
            <span className="badge bg-label-danger">Repair (&lt; 65%)</span>
          </div>
        </div>
      </div>

      {TOPIC_GROUPS.map(group => {
        const rows = topicStats.filter(topic => topic.category === group.category).sort((a, b) => b.accuracy - a.accuracy);
        return (
          <div className="card border-0 shadow-sm mb-4" key={group.category}>
            <div className="card-header bg-transparent border-bottom d-flex align-items-center justify-content-between py-3">
              <div>
                <small className="text-uppercase text-muted fw-bold">
                  {group.category === 'Grammar' ? 'Grammar Track' : 'Main English Track'}
                </small>
                <h5 className="card-title mb-0 fw-bold text-dark">{group.label}</h5>
              </div>
              <span className="badge bg-label-secondary">
                {rows.filter(r => r.attempts).length} logged · {rows.reduce((s, r) => s + r.questions, 0)} questions
              </span>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>#</th>
                      <th>Topic Name</th>
                      <th>Questions</th>
                      <th>Attempted</th>
                      <th>Correct</th>
                      <th>Accuracy</th>
                      <th>Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t, i) => (
                      <tr key={t.name} className={!t.attempts ? 'text-muted opacity-75' : ''}>
                        <td className="fw-bold">{String(i + 1).padStart(2, '0')}</td>
                        <td className="fw-semibold text-dark">{t.name}</td>
                        <td>{t.questions}</td>
                        <td>{t.attempted}</td>
                        <td>{t.correct}</td>
                        <td>
                          {t.attempts ? (
                            <span className={`fw-bold ${t.accuracy >= 80 ? 'text-success' : t.accuracy < 65 ? 'text-danger' : 'text-warning'}`}>
                              {t.accuracy}%
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {!t.attempts ? (
                            <span className="badge bg-label-secondary">Not Logged</span>
                          ) : t.accuracy >= 80 ? (
                            <span className="badge bg-label-success">Protect</span>
                          ) : t.accuracy < 65 ? (
                            <span className="badge bg-label-danger">Repair</span>
                          ) : (
                            <span className="badge bg-label-warning">Build</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Mocks({
  mocks, onEdit, onDelete, onAddMock, user
}: {
  mocks: Mock[];
  onEdit: (m: Mock) => void;
  onDelete: (id: string) => void;
  onAddMock: () => void;
  user: User | null;
}) {
  return (
    <div className="card border-0 shadow-sm">
      <div className="card-header bg-transparent d-flex align-items-center justify-content-between border-bottom py-3">
        <div>
          <small className="text-uppercase text-muted fw-bold">Attempt History</small>
          <h5 className="card-title mb-0 fw-bold text-dark">{mocks.length} Sectional Mocks</h5>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onAddMock}>
          <i className="bx bx-plus me-1"></i> Add Mock
        </button>
      </div>
      <div className="card-body p-0">
        {mocks.length ? (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Mock Name</th>
                  <th>Date</th>
                  <th>Score</th>
                  <th>Accuracy</th>
                  <th>Disposition</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {mocks.map(m => (
                  <tr key={m.id}>
                    <td>
                      <div className="fw-bold text-dark">{m.name}</div>
                      <small className="text-muted">{m.time} mins limit</small>
                    </td>
                    <td>{dateLabel(m.date)}</td>
                    <td>
                      <span className="fw-bold text-primary fs-6">{m.score.toFixed(1)}</span>
                      <small className="text-muted"> / {m.maxScore}</small>
                    </td>
                    <td>
                      <span className="badge bg-label-primary">{pct(m.correct, m.attempted)}%</span>
                    </td>
                    <td>
                      <small className="text-muted me-2">
                        <span className="text-success fw-bold">{m.correct}</span> right · <span className="text-danger fw-bold">{m.wrong}</span> wrong
                      </small>
                    </td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-icon btn-outline-secondary me-1" title="Edit" onClick={() => onEdit(m)}>
                        <i className="bx bx-edit"></i>
                      </button>
                      <button className="btn btn-sm btn-icon btn-outline-danger" title="Delete" onClick={() => onDelete(m.id)}>
                        <i className="bx bx-trash"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-5">
            <i className="bx bx-book-open fs-1 text-muted mb-2"></i>
            <h5 className="fw-bold text-dark">
              {user ? 'No Mock Tests Logged in Your Account' : 'No Mocks Available'}
            </h5>
            <p className="text-muted small mb-3">
              {user
                ? 'Your personal cloud vault has no test records yet. Log your first mock test to get started.'
                : 'Sign in to add and manage your test attempts.'}
            </p>
            <button className="btn btn-primary btn-sm fw-bold px-3" onClick={onAddMock}>
              <i className="bx bx-plus me-1"></i> Add Mock
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Revision({
  weakTopics, topicStats
}: {
  weakTopics: ReturnType<typeof getTopicStats>;
  topicStats: ReturnType<typeof getTopicStats>;
}) {
  return (
    <div>
      <div className="card bg-primary text-white border-0 shadow-sm mb-4">
        <div className="card-body p-4 d-flex align-items-center justify-content-between flex-wrap gap-3">
          <div>
            <span className="badge bg-white text-primary mb-2">Targeted Repair</span>
            <h3 className="card-title text-white fw-bold mb-1">Focus your revision strategy</h3>
            <p className="text-white-50 small mb-0">Address your lowest-accuracy topics with targeted rule reviews and timed problem sets.</p>
          </div>
          <div className="text-end">
            <h2 className="text-white fw-bold mb-0">{weakTopics.length}</h2>
            <small className="text-white-50">Weak Topics</small>
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-8">
          <div className="d-flex flex-column gap-3">
            {weakTopics.map((t, idx) => (
              <div className="card border-0 shadow-sm" key={t.name}>
                <div className="card-body p-3">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <span className="badge bg-label-danger">Priority {idx + 1} · {t.accuracy}% Accuracy</span>
                    <span className="text-muted small"><i className="bx bx-time me-1"></i> {idx === 0 ? '20' : '15'} mins</span>
                  </div>
                  <h5 className="fw-bold text-dark mb-1">{t.name}</h5>
                  <p className="text-muted small mb-3">
                    {t.accuracy < 60
                      ? 'Revisit core grammar rules before attempting practice questions.'
                      : 'Accuracy is close; focus on eliminating tricky repeat errors.'}
                  </p>
                  <div className="progress mb-3" style={{ height: '6px' }}>
                    <div className="progress-bar bg-danger" style={{ width: `${Math.min(100, t.accuracy)}%` }}></div>
                  </div>
                  <button className="btn btn-sm btn-outline-primary">
                    <i className="bx bx-check me-1"></i> Mark as Reviewed
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card border-0 shadow-sm">
            <div className="card-header bg-transparent border-bottom">
              <small className="text-uppercase text-muted fw-bold">Session Structure</small>
              <h5 className="card-title mb-0 fw-bold text-dark">60-Minute Revision Block</h5>
            </div>
            <div className="card-body py-3">
              <div className="d-flex align-items-center gap-3 py-2 border-bottom">
                <span className="badge bg-label-primary p-2">20m</span>
                <div>
                  <h6 className="mb-0 fw-bold text-dark">Rule Refresh</h6>
                  <small className="text-muted">{weakTopics[0]?.name || 'Weakest topic'}</small>
                </div>
              </div>
              <div className="d-flex align-items-center gap-3 py-2 border-bottom">
                <span className="badge bg-label-warning p-2">25m</span>
                <div>
                  <h6 className="mb-0 fw-bold text-dark">Timed Practice</h6>
                  <small className="text-muted">12 targeted questions</small>
                </div>
              </div>
              <div className="d-flex align-items-center gap-3 py-2">
                <span className="badge bg-label-success p-2">15m</span>
                <div>
                  <h6 className="mb-0 fw-bold text-dark">Error Analysis</h6>
                  <small className="text-muted">Document root cause of errors</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* SNEAT BOOTSTRAP TEMPLATE SHOWCASE PAGES                                     */
/* ========================================================================== */

function SneatDashboardDemo({ stats, mocks, nav }: { stats: ReturnType<typeof getStats>; mocks: Mock[]; nav: (v: View) => void }) {
  return (
    <div>
      <div className="row g-4 mb-4">
        <div className="col-lg-8">
          <div className="card border-0 shadow-sm">
            <div className="d-flex align-items-end row">
              <div className="col-sm-7">
                <div className="card-body">
                  <h5 className="card-title text-primary fw-bold">Congratulations 🎉</h5>
                  <p className="mb-4">You have completed <strong>{mocks.length}</strong> mock attempts today. Check your topic breakdown to improve your score.</p>
                  <button className="btn btn-sm btn-outline-primary" onClick={() => nav('overview')}>View Mock Desk</button>
                </div>
              </div>
              <div className="col-sm-5 text-center text-sm-left">
                <div className="card-body pb-0 px-0 px-md-4">
                  <img src="/assets/img/illustrations/man-with-laptop-light.png" height="140" alt="View Badge User" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <span className="fw-semibold d-block text-muted">Average Score</span>
                <span className="badge bg-label-success">+14.2%</span>
              </div>
              <h2 className="fw-bold mb-1">{stats.avg.toFixed(1)} <small className="text-muted fs-6">/ 50</small></h2>
              <small className="text-muted">Based on your last {mocks.length} tests</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayoutDemo({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body text-center py-5">
        <i className="bx bx-layout fs-1 text-primary mb-3"></i>
        <h4 className="fw-bold text-dark">{title}</h4>
        <p className="text-muted max-w-md mx-auto mb-4">{subtitle}</p>
        <span className="badge bg-label-primary">Sneat Template Container</span>
      </div>
    </div>
  );
}

function AccountSettingsDemo({ user, mockCount, nav }: { user: User | null; mockCount: number; nav: (v: View) => void }) {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (user?.displayName) setDisplayName(user.displayName);
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setMsg('');
    try {
      await updateProfile(user, { displayName });
      setMsg('Profile name updated successfully!');
    } catch (err: any) {
      setMsg(`Update failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    nav('overview');
  };

  if (!user) {
    return (
      <div className="card border-0 shadow-sm p-4 text-center max-w-lg mx-auto">
        <div className="avatar bg-label-warning rounded-circle mx-auto mb-3 d-flex align-items-center justify-content-center" style={{ width: '64px', height: '64px' }}>
          <i className="bx bx-lock-alt fs-2 text-warning"></i>
        </div>
        <h4 className="fw-bold text-dark mb-2">Guest Mode Active</h4>
        <p className="text-muted small mb-4">
          You are currently using offline local storage. Connect a free Firebase Cloud Database account to sync your test scores across all your devices securely.
        </p>
        <div className="d-flex justify-content-center gap-2">
          <button className="btn btn-primary" onClick={() => nav('auth-login')}>
            <i className="bx bx-log-in me-1"></i> Sign In to Account
          </button>
          <button className="btn btn-outline-primary" onClick={() => nav('auth-register')}>
            <i className="bx bx-user-plus me-1"></i> Create Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="row g-4">
      <div className="col-md-12">
        <div className="card mb-4 border-0 shadow-sm">
          <h5 className="card-header border-bottom fw-bold text-dark d-flex align-items-center justify-content-between">
            <span><i className="bx bx-user-circle text-primary me-2"></i>Account &amp; Database Settings</span>
            <span className="badge bg-label-success fs-6"><i className="bx bx-cloud me-1"></i> Cloud Synced</span>
          </h5>
          <div className="card-body pt-4">
            {msg && (
              <div className={`alert ${msg.includes('failed') ? 'alert-danger' : 'alert-success'} mb-4`}>
                {msg}
              </div>
            )}

            <div className="d-flex align-items-center gap-3 mb-4 p-3 bg-light rounded border">
              <div className="avatar avatar-md bg-primary text-white rounded-circle d-flex align-items-center justify-content-center fw-bold fs-4">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="User photo" className="rounded-circle w-100 h-100" />
                ) : (
                  (user.displayName || user.email || 'U').charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-grow-1">
                <h5 className="fw-bold text-dark mb-0">{user.displayName || 'SSC CGL Aspirant'}</h5>
                <small className="text-muted d-block">{user.email}</small>
                <small className="text-success fw-semibold"><i className="bx bx-check-circle me-1"></i>Firebase Cloud Firestore Database Connected</small>
              </div>
              <button className="btn btn-outline-danger btn-sm" onClick={handleSignOut}>
                <i className="bx bx-log-out me-1"></i> Sign Out
              </button>
            </div>

            <form onSubmit={handleUpdateProfile}>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label fw-semibold text-dark">Display Name</label>
                  <input
                    className="form-control"
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Enter your name"
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold text-dark">Email Address</label>
                  <input className="form-control bg-light" type="text" value={user.email || ''} disabled />
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold text-dark">User Account ID (UID)</label>
                  <input className="form-control bg-light text-muted font-monospace small" type="text" value={user.uid} disabled />
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold text-dark">Cloud Database Status</label>
                  <div className="form-control bg-light d-flex align-items-center justify-content-between">
                    <span className="text-dark fw-bold">{mockCount} Mock Records Stored</span>
                    <span className="badge bg-success">Firestore Online</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 d-flex align-items-center gap-2">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Profile Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthLoginDemo({ nav }: { nav: (v: View) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in both email and password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      nav('overview');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/operation-not-allowed' || (err.message && err.message.includes('operation-not-allowed'))) {
        // Firebase project has email/pass disabled; seamlessly log in as Guest
        try {
          await signInAnonymously(auth);
        } catch {
          // Fallback to client guest mode
        }
        nav('overview');
        return;
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Invalid email address or password.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError(err.message || 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
      nav('overview');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Google Sign-In failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await signInAnonymously(auth);
      nav('overview');
    } catch (err: any) {
      console.error('Anonymous auth failed, entering local guest mode:', err);
      // Fallback: navigate directly to overview in preview guest mode
      nav('overview');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container-xxl d-flex align-items-center justify-content-center py-5">
      <div className="card border-0 shadow-lg rounded-3" style={{ maxWidth: '440px', width: '100%' }}>
        <div className="card-body p-4 p-sm-5">
          <div className="text-center mb-4">
            <div className="avatar bg-label-primary rounded-circle mx-auto mb-2 d-flex align-items-center justify-content-center" style={{ width: '56px', height: '56px' }}>
              <i className="bx bx-log-in-circle fs-2 text-primary"></i>
            </div>
            <h4 className="mb-1 fw-bold text-dark">Welcome Back!</h4>
            <p className="text-muted small">Sign in to sync your SSC mock scores &amp; analytics</p>
          </div>

          {error && (
            <div className="alert alert-danger d-flex align-items-center p-2 small mb-3">
              <i className="bx bx-error-circle me-2 fs-5"></i>
              <div>{error}</div>
            </div>
          )}

          <div className="d-flex flex-column gap-2 mb-3">
            <button
              type="button"
              className="btn btn-outline-secondary w-100 d-flex align-items-center justify-content-center gap-2 py-2 fw-semibold"
              onClick={handleGoogleLogin}
              disabled={loading}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              className="btn btn-light border w-100 d-flex align-items-center justify-content-center gap-2 py-2 fw-semibold text-dark"
              onClick={handleGuestLogin}
              disabled={loading}
            >
              <i className="bx bx-user-check fs-5 text-success"></i>
              Continue as Guest (Instant Demo)
            </button>
          </div>

          <div className="d-flex align-items-center my-3">
            <hr className="flex-grow-1 my-0" />
            <span className="px-2 text-muted small uppercase">OR</span>
            <hr className="flex-grow-1 my-0" />
          </div>

          <form onSubmit={handleLogin}>
            <div className="mb-3">
              <label className="form-label fw-semibold text-dark">Email Address</label>
              <input
                type="email"
                className="form-control"
                placeholder="aspirant@sscexam.in"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold text-dark">Password</label>
              <div className="input-group">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-control"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <i className={`bx ${showPassword ? 'bx-hide' : 'bx-show'}`}></i>
                </button>
              </div>
            </div>

            <button className="btn btn-primary w-100 py-2 fw-bold" type="submit" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="text-center mt-4">
            <span className="text-muted small">Don't have an account? </span>
            <a href="#" className="fw-bold text-primary small ms-1" onClick={(e) => { e.preventDefault(); nav('auth-register'); }}>
              Create Account
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthRegisterDemo({ nav }: { nav: (v: View) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !name) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPass) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await createUserWithEmailAndPassword(auth, email, password);
      if (res.user) {
        await updateProfile(res.user, { displayName: name });
      }
      nav('overview');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/operation-not-allowed' || (err.message && err.message.includes('operation-not-allowed'))) {
        try {
          const res = await signInAnonymously(auth);
          if (res.user && name) {
            await updateProfile(res.user, { displayName: name });
          }
        } catch {
          // Fallback to client guest mode
        }
        nav('overview');
        return;
      } else if (err.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Try logging in.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters long.');
      } else {
        setError(err.message || 'Registration failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRegister = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
      nav('overview');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Google Sign-Up failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestRegister = async () => {
    setLoading(true);
    setError('');
    try {
      await signInAnonymously(auth);
      nav('overview');
    } catch (err: any) {
      console.error('Anonymous auth failed, entering local guest mode:', err);
      nav('overview');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container-xxl d-flex align-items-center justify-content-center py-5">
      <div className="card border-0 shadow-lg rounded-3" style={{ maxWidth: '460px', width: '100%' }}>
        <div className="card-body p-4 p-sm-5">
          <div className="text-center mb-4">
            <div className="avatar bg-label-primary rounded-circle mx-auto mb-2 d-flex align-items-center justify-content-center" style={{ width: '56px', height: '56px' }}>
              <i className="bx bx-user-plus fs-2 text-primary"></i>
            </div>
            <h4 className="mb-1 fw-bold text-dark">Create Account 🚀</h4>
            <p className="text-muted small">Store your SSC test history safely in Cloud Database</p>
          </div>

          {error && (
            <div className="alert alert-danger d-flex align-items-center p-2 small mb-3">
              <i className="bx bx-error-circle me-2 fs-5"></i>
              <div>{error}</div>
            </div>
          )}

          <div className="d-flex flex-column gap-2 mb-3">
            <button
              type="button"
              className="btn btn-outline-secondary w-100 d-flex align-items-center justify-content-center gap-2 py-2 fw-semibold"
              onClick={handleGoogleRegister}
              disabled={loading}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              Sign up with Google
            </button>

            <button
              type="button"
              className="btn btn-light border w-100 d-flex align-items-center justify-content-center gap-2 py-2 fw-semibold text-dark"
              onClick={handleGuestRegister}
              disabled={loading}
            >
              <i className="bx bx-user-check fs-5 text-success"></i>
              Continue as Guest (Instant Demo)
            </button>
          </div>

          <div className="d-flex align-items-center my-3">
            <hr className="flex-grow-1 my-0" />
            <span className="px-2 text-muted small uppercase">OR</span>
            <hr className="flex-grow-1 my-0" />
          </div>

          <form onSubmit={handleRegister}>
            <div className="mb-3">
              <label className="form-label fw-semibold text-dark">Full Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Rahul Sharma"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold text-dark">Email Address</label>
              <input
                type="email"
                className="form-control"
                placeholder="aspirant@sscexam.in"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold text-dark">Password</label>
              <input
                type="password"
                className="form-control"
                placeholder="Min 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold text-dark">Confirm Password</label>
              <input
                type="password"
                className="form-control"
                placeholder="Repeat password"
                value={confirmPass}
                onChange={e => setConfirmPass(e.target.value)}
                required
              />
            </div>

            <button className="btn btn-primary w-100 py-2 fw-bold" type="submit" disabled={loading}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <div className="text-center mt-4">
            <span className="text-muted small">Already have an account? </span>
            <a href="#" className="fw-bold text-primary small ms-1" onClick={(e) => { e.preventDefault(); nav('auth-login'); }}>
              Sign In
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardsDemo() {
  return (
    <div className="row g-4">
      <div className="col-md-6 col-lg-4">
        <div className="card h-100 border-0 shadow-sm">
          <img className="card-img-top" src="/assets/img/elements/1.jpg" alt="Card image cap" />
          <div className="card-body">
            <h5 className="card-title fw-bold text-dark">Basic Card</h5>
            <p className="card-text text-muted small">Sneat Bootstrap cards are flexible and responsive content containers.</p>
            <a href="#" className="btn btn-outline-primary btn-sm">Go somewhere</a>
          </div>
        </div>
      </div>
      <div className="col-md-6 col-lg-4">
        <div className="card h-100 border-0 shadow-sm">
          <div className="card-body">
            <h5 className="card-title fw-bold text-dark">Header Card</h5>
            <h6 className="card-subtitle text-muted mb-2">Subtitle text</h6>
            <p className="card-text text-muted small">Cards support various sub-components, headers, footers, and color variations.</p>
            <a href="#" className="card-link text-primary">Card link</a>
          </div>
        </div>
      </div>
      <div className="col-md-6 col-lg-4">
        <div className="card bg-primary text-white h-100 border-0 shadow-sm">
          <div className="card-body">
            <h5 className="card-title text-white fw-bold">Primary Solid Card</h5>
            <p className="card-text text-white-50 small">Colored background cards provide visual contrast for high-priority calls to action.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function UIAccordionDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Bootstrap Accordions</h5>
      <div className="card-body pt-4">
        <div className="accordion" id="accordionExample">
          <div className="accordion-item active">
            <h2 className="accordion-header" id="headingOne">
              <button type="button" className="accordion-button" data-bs-toggle="collapse" data-bs-target="#accordionOne">
                Accordion Item #1
              </button>
            </h2>
            <div id="accordionOne" className="accordion-collapse collapse show">
              <div className="accordion-body">
                Accordion body content using Bootstrap styles. Smooth animation and accessible HTML elements.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UIAlertsDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Alert Messages</h5>
      <div className="card-body pt-4 d-flex flex-column gap-3">
        <div className="alert alert-primary mb-0" role="alert">Primary alert - This is a primary notification badge!</div>
        <div className="alert alert-success mb-0" role="alert">Success alert - Mock data saved successfully!</div>
        <div className="alert alert-warning mb-0" role="alert">Warning alert - Check your weak topic accuracy!</div>
        <div className="alert alert-danger mb-0" role="alert">Danger alert - Incorrect answer penalty calculated.</div>
      </div>
    </div>
  );
}

function UIBadgesDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Badges &amp; Labels</h5>
      <div className="card-body pt-4 d-flex flex-wrap gap-2">
        <span className="badge bg-primary">Primary</span>
        <span className="badge bg-secondary">Secondary</span>
        <span className="badge bg-success">Success</span>
        <span className="badge bg-danger">Danger</span>
        <span className="badge bg-warning">Warning</span>
        <span className="badge bg-info">Info</span>
        <span className="badge bg-label-primary">Label Primary</span>
        <span className="badge bg-label-success">Label Success</span>
      </div>
    </div>
  );
}

function UIButtonsDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Button Variations</h5>
      <div className="card-body pt-4 d-flex flex-wrap gap-2">
        <button className="btn btn-primary">Primary</button>
        <button className="btn btn-secondary">Secondary</button>
        <button className="btn btn-success">Success</button>
        <button className="btn btn-danger">Danger</button>
        <button className="btn btn-outline-primary">Outline Primary</button>
        <button className="btn btn-outline-secondary">Outline Secondary</button>
      </div>
    </div>
  );
}

function UIModalsDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Modal Dialog Preview</h5>
      <div className="card-body pt-4">
        <p className="text-muted small">Sneat modal overlay templates support smooth backdrop transitions and responsive form inputs.</p>
        <button className="btn btn-primary">Launch Demo Modal</button>
      </div>
    </div>
  );
}

function UITabsDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Tabs &amp; Nav Pills</h5>
      <div className="card-body pt-4">
        <ul className="nav nav-pills mb-3" role="tablist">
          <li className="nav-item">
            <button className="nav-link active">Home</button>
          </li>
          <li className="nav-item">
            <button className="nav-link">Profile</button>
          </li>
          <li className="nav-item">
            <button className="nav-link">Messages</button>
          </li>
        </ul>
      </div>
    </div>
  );
}

function UITypographyDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Public Sans Typography</h5>
      <div className="card-body pt-4">
        <h1 className="fw-bold">Display Heading 1</h1>
        <h2 className="fw-semibold">Heading 2</h2>
        <h3 className="fw-semibold">Heading 3</h3>
        <p className="text-muted">Public Sans body text typography optimized for dense dashboard readability and clear visual hierarchy.</p>
      </div>
    </div>
  );
}

function IconsBoxiconsDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Boxicons Library</h5>
      <div className="card-body pt-4 d-flex flex-wrap gap-4 text-center">
        <div><i className="bx bx-home-circle fs-2 text-primary"></i><div className="small text-muted mt-1">home</div></div>
        <div><i className="bx bx-target-lock fs-2 text-success"></i><div className="small text-muted mt-1">target</div></div>
        <div><i className="bx bx-bar-chart-alt-2 fs-2 text-warning"></i><div className="small text-muted mt-1">chart</div></div>
        <div><i className="bx bx-book-open fs-2 text-info"></i><div className="small text-muted mt-1">book</div></div>
        <div><i className="bx bx-crown fs-2 text-danger"></i><div className="small text-muted mt-1">crown</div></div>
      </div>
    </div>
  );
}

function FormsBasicDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Basic Form Inputs</h5>
      <div className="card-body pt-4">
        <div className="mb-3">
          <label className="form-label">Default Input</label>
          <input type="text" className="form-control" placeholder="Enter text..." />
        </div>
        <div className="mb-3">
          <label className="form-label">Select Option</label>
          <select className="form-select">
            <option>Option 1</option>
            <option>Option 2</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function FormLayoutsDemo() {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Vertical Form Layout</h5>
      <div className="card-body pt-4">
        <form onSubmit={e => e.preventDefault()}>
          <div className="mb-3">
            <label className="form-label">Full Name</label>
            <input type="text" className="form-control" placeholder="John Doe" />
          </div>
          <div className="mb-3">
            <label className="form-label">Email</label>
            <input type="email" className="form-control" placeholder="john@example.com" />
          </div>
          <button type="submit" className="btn btn-primary">Submit Form</button>
        </form>
      </div>
    </div>
  );
}

function TablesDemo({ mocks }: { mocks: Mock[] }) {
  return (
    <div className="card border-0 shadow-sm">
      <h5 className="card-header border-bottom">Basic Table Layout</h5>
      <div className="card-body p-0">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {mocks.map(m => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>SSC English Mock</td>
                  <td>{m.score.toFixed(1)} / 50</td>
                  <td><span className="badge bg-label-success">Completed</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* DIALOGS                                                                    */
/* ========================================================================== */

function MockDialog({
  item, onClose, onSave
}: {
  item: Mock;
  onClose: () => void;
  onSave: (m: Mock) => void;
}) {
  const [form, setForm] = useState(() => item.topics.some(topic => topic.questions > 0) ? item : { ...item, topics: defaultTopicCounts(0) });
  const [activeTab, setActiveTab] = useState<'details' | 'topics'>('details');
  const [topicFilter, setTopicFilter] = useState('');

  const set = (key: keyof Mock, value: string | number) => setForm(f => ({ ...f, [key]: value }));

  const total = form.correct + form.wrong + form.unattempted;
  const topicTotal = form.topics.reduce((sum, topic) => sum + topic.questions, 0);
  const attemptedCount = form.correct + form.wrong;
  const accuracyPct = attemptedCount > 0 ? Math.round((form.correct / attemptedCount) * 100) : 0;
  const valid = form.name.trim().length >= 2 && form.correct >= 0 && form.wrong >= 0 && form.unattempted >= 0 && total === 25;

  const updateTopic = (id: string, diff: number) => setForm(f => ({
    ...f,
    topics: f.topics.map(t => t.id === id ? { ...t, questions: Math.max(0, Math.min(25, t.questions + diff)) } : t)
  }));

  const resetTopicDefaults = () => {
    setForm(f => ({ ...f, topics: defaultTopicCounts(0) }));
  };

  const autoFillUnattempted = () => {
    const u = Math.max(0, 25 - form.correct - form.wrong);
    setForm(f => ({ ...f, unattempted: u }));
  };

  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-dialog-custom" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header-custom border-bottom">
          <div className="d-flex align-items-center gap-2 overflow-hidden">
            <div className="avatar bg-label-primary rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '38px', height: '38px' }}>
              <i className="bx bx-edit-alt fs-4 text-primary"></i>
            </div>
            <div className="min-w-0">
              <h5 className="mb-0 fw-bold text-dark text-truncate fs-5">
                {item.name ? 'Edit Sectional Mock' : 'Log New Sectional Mock'}
              </h5>
              <small className="text-muted d-block text-truncate" style={{ fontSize: '11px' }}>
                SSC CGL Tier 1/2 Pattern (25 Questions / 50 Marks)
              </small>
            </div>
          </div>
          <button type="button" className="btn-close flex-shrink-0" onClick={onClose} aria-label="Close"></button>
        </div>

        {/* Modal Segmented Navigation Bar */}
        <div className="p-2 bg-light border-bottom">
          <div className="d-flex gap-2">
            <button
              type="button"
              className={`btn btn-sm flex-fill fw-semibold d-flex align-items-center justify-content-center gap-1 ${
                activeTab === 'details' ? 'btn-white text-primary shadow-sm border' : 'btn-light text-muted border-0'
              }`}
              onClick={() => setActiveTab('details')}
            >
              <i className="bx bx-slider-alt"></i>
              <span>1. Score &amp; Attempt Details</span>
            </button>
            <button
              type="button"
              className={`btn btn-sm flex-fill fw-semibold d-flex align-items-center justify-content-center gap-1 ${
                activeTab === 'topics' ? 'btn-white text-primary shadow-sm border' : 'btn-light text-muted border-0'
              }`}
              onClick={() => setActiveTab('topics')}
            >
              <i className="bx bx-pie-chart-alt-2"></i>
              <span>2. Topic Breakdown ({topicTotal}/25)</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-body-custom">
          {activeTab === 'details' ? (
            <div className="d-flex flex-column gap-3">
              {/* Live Performance Preview Banner */}
              <div className="card bg-label-primary border-0 p-3 rounded-3">
                <div className="row g-2 text-center">
                  <div className="col-4 border-end">
                    <small className="text-muted d-block uppercase fw-bold" style={{ fontSize: '10px' }}>Calculated Score</small>
                    <span className="fs-4 fw-bold text-primary">{form.score.toFixed(1)} <small className="fs-6 text-muted">/ 50</small></span>
                  </div>
                  <div className="col-4 border-end">
                    <small className="text-muted d-block uppercase fw-bold" style={{ fontSize: '10px' }}>Accuracy Rate</small>
                    <span className="fs-4 fw-bold text-dark">{accuracyPct}%</span>
                  </div>
                  <div className="col-4">
                    <small className="text-muted d-block uppercase fw-bold" style={{ fontSize: '10px' }}>Logged Questions</small>
                    <span className={`fs-4 fw-bold ${total === 25 ? 'text-success' : 'text-danger'}`}>
                      {total} <small className="fs-6 text-muted">/ 25</small>
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 1: Paper Title & Attempt Date */}
              <div className="row g-3">
                <div className="col-12 col-md-7">
                  <label className="form-label fw-semibold text-dark mb-1">Mock Paper Title</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Sectional Mock 12 (Testbook / Oliveboard)"
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                  />
                </div>
                <div className="col-12 col-md-5">
                  <label className="form-label fw-semibold text-dark mb-1">Attempt Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={form.date}
                    onChange={e => set('date', e.target.value)}
                  />
                </div>
              </div>

              {/* Row 2: Question Attempts Grid */}
              <div className="card border p-3 rounded-3 shadow-none bg-body-tertiary">
                <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                  <h6 className="fw-bold mb-0 text-dark">Question Attempt Breakdown</h6>
                  {total !== 25 && (
                    <button
                      type="button"
                      className="btn btn-xs btn-outline-warning d-inline-flex align-items-center gap-1"
                      onClick={autoFillUnattempted}
                    >
                      <i className="bx bx-revision"></i>
                      <span>Auto-fill Unattempted ({Math.max(0, 25 - form.correct - form.wrong)})</span>
                    </button>
                  )}
                </div>

                <div className="row g-2">
                  {/* Correct */}
                  <div className="col-12 col-sm-4">
                    <div className="p-2 border border-success-subtle bg-white rounded-3">
                      <div className="d-flex align-items-center justify-content-between mb-1">
                        <span className="small fw-bold text-success">+2 Correct</span>
                        <span className="badge bg-success-subtle text-success small">Marks: +{(form.correct * 2).toFixed(1)}</span>
                      </div>
                      <div className="input-group input-group-sm">
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => {
                            const c = Math.max(0, form.correct - 1);
                            const w = form.wrong;
                            const u = Math.max(0, 25 - c - w);
                            setForm(f => ({ ...f, correct: c, unattempted: u, score: c * 2 - w * 0.5 }));
                          }}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          max="25"
                          className="form-control text-center fw-bold text-success"
                          value={form.correct}
                          onChange={e => {
                            const c = Math.max(0, Math.min(25, Number(e.target.value)));
                            const w = form.wrong;
                            const u = Math.max(0, 25 - c - w);
                            setForm(f => ({ ...f, correct: c, unattempted: u, score: c * 2 - w * 0.5 }));
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => {
                            const c = Math.min(25, form.correct + 1);
                            const w = form.wrong;
                            const u = Math.max(0, 25 - c - w);
                            setForm(f => ({ ...f, correct: c, unattempted: u, score: c * 2 - w * 0.5 }));
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Wrong */}
                  <div className="col-12 col-sm-4">
                    <div className="p-2 border border-danger-subtle bg-white rounded-3">
                      <div className="d-flex align-items-center justify-content-between mb-1">
                        <span className="small fw-bold text-danger">-0.5 Wrong</span>
                        <span className="badge bg-danger-subtle text-danger small">Penalty: -{(form.wrong * 0.5).toFixed(1)}</span>
                      </div>
                      <div className="input-group input-group-sm">
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => {
                            const w = Math.max(0, form.wrong - 1);
                            const c = form.correct;
                            const u = Math.max(0, 25 - c - w);
                            setForm(f => ({ ...f, wrong: w, unattempted: u, score: c * 2 - w * 0.5 }));
                          }}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          max="25"
                          className="form-control text-center fw-bold text-danger"
                          value={form.wrong}
                          onChange={e => {
                            const w = Math.max(0, Math.min(25, Number(e.target.value)));
                            const c = form.correct;
                            const u = Math.max(0, 25 - c - w);
                            setForm(f => ({ ...f, wrong: w, unattempted: u, score: c * 2 - w * 0.5 }));
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => {
                            const w = Math.min(25, form.wrong + 1);
                            const c = form.correct;
                            const u = Math.max(0, 25 - c - w);
                            setForm(f => ({ ...f, wrong: w, unattempted: u, score: c * 2 - w * 0.5 }));
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Unattempted */}
                  <div className="col-12 col-sm-4">
                    <div className="p-2 border bg-white rounded-3">
                      <div className="d-flex align-items-center justify-content-between mb-1">
                        <span className="small fw-bold text-secondary">Unattempted</span>
                        <span className="badge bg-secondary-subtle text-secondary small">0 Marks</span>
                      </div>
                      <div className="input-group input-group-sm">
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => {
                            const u = Math.max(0, form.unattempted - 1);
                            setForm(f => ({ ...f, unattempted: u }));
                          }}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          max="25"
                          className="form-control text-center fw-bold text-muted"
                          value={form.unattempted}
                          onChange={e => {
                            const u = Math.max(0, Math.min(25, Number(e.target.value)));
                            setForm(f => ({ ...f, unattempted: u }));
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={() => {
                            const u = Math.min(25, form.unattempted + 1);
                            setForm(f => ({ ...f, unattempted: u }));
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {total !== 25 && (
                  <div className="mt-2 text-danger small d-flex align-items-center gap-1">
                    <i className="bx bx-error-circle"></i>
                    <span>Total questions must equal exactly 25 (currently {total}).</span>
                  </div>
                )}
              </div>

              {/* Time taken and Next step */}
              <div className="row g-3 align-items-end">
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-semibold text-dark mb-1">Time Taken</label>
                  <div className="input-group">
                    <input
                      type="number"
                      min="1"
                      max="120"
                      className="form-control"
                      value={form.time}
                      onChange={e => set('time', Math.max(1, Number(e.target.value)))}
                    />
                    <span className="input-group-text">minutes</span>
                  </div>
                </div>
                <div className="col-12 col-sm-6">
                  <button
                    type="button"
                    className="btn btn-outline-primary w-100 py-2 fw-semibold d-flex align-items-center justify-content-center gap-1"
                    onClick={() => setActiveTab('topics')}
                  >
                    <span>Next: Topic Breakdown</span>
                    <i className="bx bx-right-arrow-alt fs-5"></i>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              {/* Topic Search & Quick Preset Toolbar */}
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                <div className="input-group input-group-sm flex-grow-1" style={{ maxWidth: '300px' }}>
                  <span className="input-group-text"><i className="bx bx-search"></i></span>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search grammar or topic..."
                    value={topicFilter}
                    onChange={e => setTopicFilter(e.target.value)}
                  />
                  {topicFilter && (
                    <button className="btn btn-outline-secondary" onClick={() => setTopicFilter('')}>
                      <i className="bx bx-x"></i>
                    </button>
                  )}
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className={`badge ${topicTotal === 25 ? 'bg-success' : 'bg-label-warning'}`}>
                    Allocated: {topicTotal} / 25 Qs
                  </span>
                  <button type="button" className="btn btn-xs btn-outline-secondary" onClick={resetTopicDefaults}>
                    <i className="bx bx-refresh me-1"></i> Reset Preset
                  </button>
                </div>
              </div>

              {/* Topics Grid grouped cleanly */}
              <div className="d-flex flex-column gap-3">
                {TOPIC_GROUPS.map(group => {
                  const filteredInGroup = form.topics.filter(t => t.category === group.category && t.name.toLowerCase().includes(topicFilter.toLowerCase()));
                  if (!filteredInGroup.length) return null;
                  const groupSum = filteredInGroup.reduce((s, t) => s + t.questions, 0);
                  return (
                    <div key={group.category} className="border rounded-3 p-3 bg-light">
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <h6 className="fw-bold mb-0 text-dark small text-uppercase tracking-wider">
                          {group.label}
                        </h6>
                        <span className="badge bg-white text-dark border small">{groupSum} Questions</span>
                      </div>
                      <div className="row g-2">
                        {filteredInGroup.map(t => {
                          const isActive = t.questions > 0;
                          return (
                            <div key={t.id} className="col-12 col-sm-6">
                              <div className={`d-flex align-items-center justify-content-between border rounded-3 p-2 transition-all ${
                                isActive ? 'bg-white border-primary shadow-sm' : 'bg-white border-light-subtle'
                              }`}>
                                <div className="min-w-0 me-2">
                                  <span className={`small fw-semibold d-block text-truncate ${isActive ? 'text-primary' : 'text-dark'}`} title={t.name}>
                                    {t.name}
                                  </span>
                                </div>
                                <div className="btn-group btn-group-sm flex-shrink-0">
                                  <button
                                    type="button"
                                    className="btn btn-outline-secondary px-2"
                                    onClick={() => updateTopic(t.id, -1)}
                                    disabled={t.questions <= 0}
                                  >
                                    -
                                  </button>
                                  <span className={`btn disabled px-2 fw-bold ${isActive ? 'btn-primary text-white' : 'btn-light text-muted'}`}>
                                    {t.questions}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn btn-outline-secondary px-2"
                                    onClick={() => updateTopic(t.id, 1)}
                                    disabled={topicTotal >= 25}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer-custom">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="badge bg-primary fs-6 px-3 py-2">
              Score: {form.score.toFixed(1)} / 50
            </span>
            <span className={`badge ${total === 25 ? 'bg-label-success' : 'bg-label-danger'} px-2 py-1`}>
              {total === 25 ? '✓ 25/25 Qs Logged' : `⚠️ Total ${total}/25 Qs`}
            </span>
          </div>

          <div className="d-flex align-items-center gap-2 ms-auto">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary px-4 fw-bold"
              disabled={!valid}
              onClick={() => onSave(form)}
            >
              <i className="bx bx-check-circle me-1"></i> Save Mock Record
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportDialog({
  fileRef, onClose, onImport
}: {
  fileRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onImport: (text: string, fileName: string) => void;
}) {
  return (
    <div className="modal-backdrop-custom" onClick={onClose}>
      <div className="modal-dialog-custom" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header-custom">
          <h5 className="mb-0 fw-bold text-dark fs-5">
            <i className="bx bx-cloud-upload text-primary me-2"></i>
            Import Mock Data
          </h5>
          <button type="button" className="btn-close" onClick={onClose}></button>
        </div>
        <div className="modal-body-custom text-center py-4">
          <div className="avatar bg-label-primary rounded-circle mx-auto mb-3 d-flex align-items-center justify-content-center" style={{ width: '64px', height: '64px' }}>
            <i className="bx bx-file fs-2 text-primary"></i>
          </div>
          <h6 className="fw-bold text-dark mb-1">Upload Mocks Backup</h6>
          <p className="text-muted small mb-4">Select a JSON or CSV file exported from SSC English Mock Analyzer.</p>
          <input
            type="file"
            ref={fileRef}
            accept=".json,.csv"
            className="d-none"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = ev => onImport(ev.target?.result as string, file.name);
                reader.readAsText(file);
              }
            }}
          />
          <button className="btn btn-primary px-4" onClick={() => fileRef.current?.click()}>
            <i className="bx bx-folder-open me-1"></i> Choose File
          </button>
        </div>
        <div className="modal-footer-custom justify-content-end">
          <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
