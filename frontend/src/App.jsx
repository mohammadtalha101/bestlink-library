import React, { useState, useRef, useEffect, useCallback, createContext, useContext } from "react";
import {
  LayoutDashboard, Library, PlusCircle, ScanLine, ClipboardList, Search, ChevronRight,
  AlertTriangle, Check, Download, X, UploadCloud, FileUp, ArrowLeftRight, UserCircle2,
  ShieldCheck, Bell, Wallet, RotateCcw, Undo2, BookMarked, BookOpenCheck, Truck, Eye,
  Sparkles, CalendarClock, HelpCircle, AlertOctagon, ArrowLeft, Loader2,
} from "lucide-react";

// =============================================================================
// API layer — every call here hits the real Flask backend. Change API_BASE if
// you deploy the backend somewhere other than your own machine.
// =============================================================================
// In local development this defaults to your own machine's backend.
// Once you deploy the backend (e.g. to Render), set VITE_API_BASE in your
// hosting provider's environment variables to that backend's real URL
// plus "/api" — e.g. https://bestlink-library-api.onrender.com/api
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function apiFetch(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError(
      "Can't reach the backend. Is 'python3 app.py' running on your machine? (Looking for it at " + API_BASE + ")",
      0
    );
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status);
  return data;
}

const DDC_CLASSES = [
  { code: "000", range: "000\u2013099", label: "Computer Science, Information & General Works" },
  { code: "100", range: "100\u2013199", label: "Philosophy & Psychology" },
  { code: "200", range: "200\u2013299", label: "Religion" },
  { code: "300", range: "300\u2013399", label: "Social Sciences" },
  { code: "400", range: "400\u2013499", label: "Language" },
  { code: "500", range: "500\u2013599", label: "Science" },
  { code: "600", range: "600\u2013699", label: "Technology" },
  { code: "700", range: "700\u2013799", label: "Arts & Recreation" },
  { code: "800", range: "800\u2013899", label: "Literature" },
  { code: "900", range: "900\u2013999", label: "History & Geography" },
];

function initialsFor(name) {
  return (name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function fmtDate(iso) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}
function daysBetween(a, b) { return Math.floor((b - a) / 86400000); }
function authorMarkFor(author) {
  if (!author) return "";
  const last = author.includes(",") ? author.split(",")[0] : author.trim().split(" ").pop();
  return last.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase();
}

// =============================================================================
// Auth context
// =============================================================================
const AuthCtx = createContext(null);
const useAuth = () => useContext(AuthCtx);

// =============================================================================
export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [view, setView] = useState("dashboard");
  const [connError, setConnError] = useState(false);

  useEffect(() => {
    apiFetch("/health").then(() => setConnError(false)).catch(() => setConnError(true));
  }, []);

  const login = (t, u) => {
    setToken(t); setUser(u);
    setView(u.role === "faculty" || u.role === "student" ? "myaccount" : "dashboard");
  };
  const logout = () => { setToken(null); setUser(null); setView("dashboard"); };

  if (connError) {
    return (
      <div className="app">
        <style>{CSS}</style>
        <ConnectionError onRetry={() => apiFetch("/health").then(() => setConnError(false)).catch(() => setConnError(true))} />
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div className="app">
        <style>{CSS}</style>
        <LoginScreen onLogin={login} />
      </div>
    );
  }

  return (
    <AuthCtx.Provider value={{ token, user }}>
      <div className="app">
        <style>{CSS}</style>
        <Sidebar view={view} setView={setView} role={user.role} />
        <main className="main">
          <TopBar user={user} setView={setView} onLogout={logout} />
          <div className="main-body">
            {view === "dashboard" && <Dashboard setView={setView} />}
            {view === "catalog" && <Catalog />}
            {view === "add" && <AddBook />}
            {view === "bulk" && <BulkUpload />}
            {view === "circulation" && <Circulation />}
            {view === "myaccount" && <SelfService />}
            {view === "entrance" && <Entrance />}
            {view === "log" && <AttendanceLog />}
            {view === "digital" && <DigitalResources />}
            {view === "transfers" && <InterBranchTransfers />}
            {view === "daily" && <DailyServices />}
            {view === "admin" && <Admin />}
            {view === "profile" && <Profile onLogout={logout} />}
          </div>
        </main>
      </div>
    </AuthCtx.Provider>
  );
}

function ConnectionError({ onRetry }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <AlertTriangle size={28} color="var(--brick)" />
        <h1 style={{ marginTop: 10 }}>Can't reach the backend</h1>
        <p className="page-sub">
          This app needs the Flask API running on your own computer. In the backend folder, run:
        </p>
        <pre className="code-block">pip install -r requirements.txt{"\n"}python3 app.py</pre>
        <p className="page-sub">Then it should be reachable at {API_BASE}.</p>
        <button className="primary-btn" style={{ width: "100%" }} onClick={onRetry} type="button">Try again</button>
      </div>
    </div>
  );
}

// =============================================================================
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(""); setBusy(true);
    try {
      const data = await apiFetch("/auth/login", { method: "POST", body: { username, password } });
      onLogin(data.token, data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand" style={{ borderBottom: "none", padding: 0, margin: "0 0 18px" }}>
          <div className="brand-mark">BC</div>
          <div>
            <div className="brand-name" style={{ color: "var(--ink)" }}>Bestlink Library</div>
            <div className="brand-sub" style={{ color: "var(--ink-dim)" }}>College of the Philippines</div>
          </div>
        </div>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Sign in</h1>
        <p className="page-sub">Connected to your real library database.</p>
        <Field label="Username">
          <input className="text-input" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus />
        </Field>
        <Field label="Password">
          <input className="text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>
        {error && <p className="form-error"><AlertTriangle size={14} /> {error}</p>}
        <button className="primary-btn" style={{ width: "100%" }} onClick={submit} disabled={busy} type="button">
          {busy ? <Loader2 size={15} className="spin" /> : "Sign in"}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
function TopBar({ user, setView, onLogout }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="topbar-global">
      <div className="user-chip-wrap">
        <button className="user-chip" onClick={() => setOpen((o) => !o)} type="button">
          <span className="mini-avatar">{initialsFor(user.name)}</span>
          <span className="user-chip-text">
            <span className="user-chip-name">{user.name}</span>
            <span className="user-chip-role">{user.role}</span>
          </span>
        </button>
        {open && (
          <div className="user-menu">
            <button onClick={() => { setView("profile"); setOpen(false); }} type="button">My profile</button>
            <button onClick={onLogout} type="button">Log out</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Profile({ onLogout }) {
  const { user } = useAuth();
  return (
    <div className="page">
      <h1>My profile</h1>
      <div className="panel" style={{ maxWidth: 460 }}>
        <div className="id-card" style={{ background: "transparent", padding: 0, marginBottom: 18 }}>
          <div className="id-avatar" style={{ width: 64, height: 64, fontSize: 20 }}>{initialsFor(user.name)}</div>
          <div className="id-info">
            <div className="id-name" style={{ fontSize: 17 }}>{user.name}</div>
            <div className="id-meta" style={{ textTransform: "capitalize" }}>{user.role}</div>
          </div>
        </div>
        <div className="profile-row"><span>Username</span><span>{user.username}</span></div>
        {user.email && <div className="profile-row"><span>Email</span><span>{user.email}</span></div>}
        {user.course && <div className="profile-row"><span>Course</span><span>{user.course}</span></div>}
        <button className="ghost-btn" style={{ marginTop: 16 }} onClick={onLogout} type="button">Log out</button>
      </div>
    </div>
  );
}

// =============================================================================
const ROLE_NAV_ACCESS = {
  admin: ["dashboard", "catalog", "add", "bulk", "circulation", "myaccount", "entrance", "log", "digital", "transfers", "daily", "admin"],
  librarian: ["dashboard", "catalog", "add", "bulk", "circulation", "entrance", "log", "digital", "transfers", "daily"],
  faculty: ["myaccount", "catalog", "digital"],
  student: ["myaccount", "catalog", "digital"],
};

function Sidebar({ view, setView, role }) {
  const allowed = ROLE_NAV_ACCESS[role] || [];
  const nav = [
    { group: "Overview", items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }] },
    { group: "Cataloging", items: [
      { id: "catalog", label: "Browse catalog", icon: Library },
      { id: "add", label: "Add a book", icon: PlusCircle },
      { id: "bulk", label: "Bulk upload", icon: UploadCloud },
    ]},
    { group: "Circulation", items: [{ id: "circulation", label: "Borrow, return & fines", icon: ArrowLeftRight }] },
    { group: "Self-service", items: [{ id: "myaccount", label: "My library account", icon: UserCircle2 }] },
    { group: "Entrance", items: [
      { id: "entrance", label: "Check students in", icon: ScanLine },
      { id: "log", label: "Attendance records", icon: ClipboardList },
    ]},
    { group: "Digital resources", items: [{ id: "digital", label: "E-library", icon: BookOpenCheck }] },
    { group: "Branches", items: [{ id: "transfers", label: "Inter-branch transfers", icon: Truck }] },
    { group: "Daily services", items: [{ id: "daily", label: "Rooms, reference & reports", icon: CalendarClock }] },
    { group: "Admin", items: [{ id: "admin", label: "Users, reports & alerts", icon: ShieldCheck }] },
  ].map((g) => ({ ...g, items: g.items.filter((i) => allowed.includes(i.id)) })).filter((g) => g.items.length > 0);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">BC</div>
        <div>
          <div className="brand-name">Bestlink Library</div>
          <div className="brand-sub">College of the Philippines</div>
        </div>
      </div>
      {nav.map((g) => (
        <div className="nav-group" key={g.group}>
          <div className="nav-group-label">{g.group}</div>
          {g.items.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button key={item.id} className={`nav-item ${active ? "active" : ""}`} onClick={() => setView(item.id)} type="button">
                <span className="nav-pull" />
                <Icon size={16} strokeWidth={1.8} />
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

function Field({ label, children }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

function SpineTag({ ddc, author, size = "md" }) {
  return (
    <div className={`spine-tag ${size}`}>
      <div className="spine-ddc">{ddc || "\u2014"}</div>
      <div className="spine-mark">{authorMarkFor(author) || "\u2014"}</div>
    </div>
  );
}

function Loading({ label = "Loading\u2026" }) {
  return <p className="empty-note"><Loader2 size={13} className="spin" style={{ verticalAlign: -2, marginRight: 6 }} />{label}</p>;
}

// =============================================================================
function Dashboard({ setView }) {
  const { token } = useAuth();
  const [stats, setStats] = useState(null);
  const [byClass, setByClass] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiFetch("/dashboard", { token }).then(setStats).catch((e) => setErr(e.message));
    apiFetch("/books/stats-by-class").then(setByClass).catch(() => {});
  }, [token]);

  if (err) return <div className="page"><p className="form-error"><AlertTriangle size={14} /> {err}</p></div>;
  if (!stats) return <div className="page"><Loading /></div>;

  const maxCount = Math.max(1, ...DDC_CLASSES.map((c) => (byClass && byClass[c.code]) || 0));

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <p className="page-sub">Live data from your real library database.</p>
      <div className="stat-row">
        <div className="stat-card"><div className="stat-num">{stats.titles}</div><div className="stat-label">Titles cataloged</div></div>
        <div className="stat-card"><div className="stat-num">{stats.copies_available}<span className="stat-of">/{stats.copies_total}</span></div><div className="stat-label">Copies available</div></div>
        <div className="stat-card"><div className="stat-num">{stats.active_loans}</div><div className="stat-label">Books out on loan</div></div>
        <div className="stat-card"><div className="stat-num" style={stats.overdue > 0 ? { color: "var(--brick)" } : undefined}>{stats.overdue}</div><div className="stat-label">Overdue right now</div></div>
        <div className="stat-card"><div className="stat-num">{stats.checked_in_today}</div><div className="stat-label">Checked in today</div></div>
      </div>
      <div className="panel">
        <h2>Collection by classification</h2>
        {!byClass ? <Loading /> : (
          <div className="class-bars">
            {DDC_CLASSES.map((c) => (
              <div className="class-bar-row" key={c.code} onClick={() => setView("catalog")}>
                <div className="class-bar-code">{c.code}</div>
                <div className="class-bar-track"><div className="class-bar-fill" style={{ width: `${((byClass[c.code] || 0) / maxCount) * 100}%` }} /></div>
                <div className="class-bar-count">{byClass[c.code] || 0}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
function Catalog() {
  const [search, setSearch] = useState("");
  const [classCode, setClassCode] = useState(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (classCode) params.set("class", classCode);
    params.set("page", page);
    apiFetch(`/books?${params}`).then(setResult).finally(() => setBusy(false));
  }, [search, classCode, page]);

  const currentClass = DDC_CLASSES.find((c) => c.code === classCode);
  const totalPages = result ? Math.ceil(result.total / result.per_page) : 1;

  return (
    <div className="page">
      <h1>Catalog</h1>
      <p className="page-sub">Search or browse {result ? result.total.toLocaleString() : "\u2026"} real titles by Dewey Decimal Classification.</p>
      <div className="search-bar">
        <Search size={16} />
        <input placeholder="Search by title, author, ISBN, or call number\u2026" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {search && <button className="icon-btn" onClick={() => setSearch("")} type="button"><X size={14} /></button>}
      </div>

      {!search && (
        <div className="breadcrumb">
          <button className="crumb" onClick={() => { setClassCode(null); setPage(1); }} type="button">All classes</button>
          {currentClass && <><ChevronRight size={13} /><span className="crumb current">{currentClass.code} \u00b7 {currentClass.label}</span></>}
        </div>
      )}

      {!search && !classCode && (
        <div className="drawer-grid">
          {DDC_CLASSES.map((c) => (
            <button className="drawer" key={c.code} onClick={() => { setClassCode(c.code); setPage(1); }} type="button">
              <span className="drawer-pull" />
              <div className="drawer-range">{c.range}</div>
              <div className="drawer-label">{c.label}</div>
            </button>
          ))}
        </div>
      )}

      {(search || classCode) && (
        <>
          {busy ? <Loading /> : <BookTable books={result?.results || []} emptyText="No titles found." />}
          {result && result.total > result.per_page && (
            <div className="pager">
              <button className="ghost-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} type="button">Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button className="ghost-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} type="button">Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BookTable({ books, emptyText, title }) {
  if (books.length === 0) return <p className="empty-note">{emptyText}</p>;
  return (
    <div className="book-table-wrap">
      {title && <div className="book-table-title">{title}</div>}
      <table className="book-table">
        <thead><tr><th></th><th>Title</th><th>Author</th><th>Call no.</th><th>Shelf</th><th>Copies</th></tr></thead>
        <tbody>
          {books.map((b) => (
            <tr key={b.id}>
              <td><SpineTag ddc={b.ddc} author={b.author} size="sm" /></td>
              <td className="book-title-cell">{b.title}<div className="book-year">{b.publisher}{b.publisher && b.year ? ", " : ""}{b.year}</div></td>
              <td>{b.author}</td>
              <td className="mono">{b.ddc}</td>
              <td>{b.shelf_location}</td>
              <td><span className={`avail-pill ${b.copies_available === 0 ? "none" : ""}`}>{b.copies_available}/{b.copies_total}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
function AddBook() {
  const { token } = useAuth();
  const blank = { title: "", author: "", isbn: "", publisher: "", year: "", ddc: "", copies: "1" };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(0);

  const ddcValid = form.ddc === "" || /^\d{3}(\.\d+)?$/.test(form.ddc);

  const submit = async () => {
    if (!form.title.trim()) return setError("Enter a title before saving.");
    if (!/^\d{3}(\.\d+)?$/.test(form.ddc)) return setError("Enter a valid DDC call number, e.g. 512.5 or 370.");
    try {
      await apiFetch("/books", { method: "POST", token, body: { ...form, copies: parseInt(form.copies, 10) || 1 } });
      setForm(blank); setError(""); setFlash((n) => n + 1);
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="page">
      <h1>Add a book</h1>
      <p className="page-sub">Saved directly to the real database.</p>
      <div className="panel" style={{ maxWidth: 520, position: "relative" }}>
        <Field label="Title"><input className="text-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <div className="field-pair">
          <Field label="Author"><input className="text-input" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="Last, First" /></Field>
          <Field label="Year"><input className="text-input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></Field>
        </div>
        <div className="field-pair">
          <Field label="ISBN"><input className="text-input" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} /></Field>
          <Field label="Publisher"><input className="text-input" value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} /></Field>
        </div>
        <div className="field-pair">
          <Field label="DDC call number"><input className={`text-input mono ${!ddcValid ? "invalid" : ""}`} value={form.ddc} onChange={(e) => setForm({ ...form, ddc: e.target.value })} placeholder="e.g. 512.5" /></Field>
          <Field label="Copies"><input className="text-input" type="number" min="1" value={form.copies} onChange={(e) => setForm({ ...form, copies: e.target.value })} /></Field>
        </div>
        {error && <p className="form-error"><AlertTriangle size={14} /> {error}</p>}
        <button className="primary-btn" onClick={submit} type="button">Add to catalog</button>
        {flash > 0 && <div className="stamp" key={flash}><Check size={13} strokeWidth={3} /> SAVED</div>}
      </div>
    </div>
  );
}

// =============================================================================
function BulkUpload() {
  const { token } = useAuth();
  const [tab, setTab] = useState("books");
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_").replace(/"/g, ""));
    return lines.slice(1).map((line) => {
      const cells = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^$)/g) || [];
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cells[i] || "").replace(/^"|"$/g, "").trim(); });
      return obj;
    });
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name); setResult(null); setError("");
    const reader = new FileReader();
    reader.onload = (ev) => setRows(parseCSV(ev.target.result));
    reader.readAsText(file);
    e.target.value = "";
  };

  const doImport = async () => {
    try {
      const endpoint = tab === "books" ? "/bulk/books" : "/bulk/students";
      const payload = tab === "books"
        ? rows.map((r) => ({ title: r.title, author: r.author, isbn: r.isbn, publisher: r.publisher, year: r.year, ddc: r.ddc, copies: r.copies }))
        : rows.map((r) => ({ student_number: r.student_number, name: r.name, course: r.course, year: r.year, section: r.section, type: r.type, status: r.status, reason: r.reason }));
      const res = await apiFetch(endpoint, { method: "POST", token, body: payload });
      setResult(res); setRows([]); setFileName("");
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="page">
      <h1>Bulk upload</h1>
      <p className="page-sub">Import a CSV of books or students directly into the real database.</p>
      <div className="tab-switch">
        <button className={tab === "books" ? "active" : ""} onClick={() => { setTab("books"); setRows([]); setResult(null); }} type="button">Books</button>
        <button className={tab === "students" ? "active" : ""} onClick={() => { setTab("students"); setRows([]); setResult(null); }} type="button">Students</button>
      </div>
      <div className="panel">
        <label className="upload-dropzone">
          <UploadCloud size={22} />
          <div>
            <div className="upload-title">{fileName || `Choose a ${tab} CSV file`}</div>
            <div className="upload-sub">Headers: {tab === "books" ? "title,author,isbn,publisher,year,ddc,copies" : "student_number,name,course,year,section,type,status,reason"}</div>
          </div>
          <input type="file" accept=".csv" onChange={handleFile} hidden />
        </label>
        {error && <p className="form-error"><AlertTriangle size={14} /> {error}</p>}
        {result && <p className="success-note"><Check size={14} /> Imported {result.imported}, skipped {result.skipped}.</p>}
        {rows.length > 0 && (
          <>
            <p className="preview-summary">{rows.length} row(s) parsed and ready.</p>
            <button className="primary-btn" onClick={doImport} type="button">Import {rows.length} {tab}</button>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
function Circulation() {
  const [tab, setTab] = useState("issue");
  return (
    <div className="page">
      <h1>Borrow, return & fines</h1>
      <p className="page-sub">Every action here writes to the real database.</p>
      <div className="tab-switch">
        <button className={tab === "issue" ? "active" : ""} onClick={() => setTab("issue")} type="button">Issue &amp; return</button>
        <button className={tab === "reservations" ? "active" : ""} onClick={() => setTab("reservations")} type="button">Reservations</button>
        <button className={tab === "fines" ? "active" : ""} onClick={() => setTab("fines")} type="button">Fines</button>
      </div>
      {tab === "issue" && <IssueReturn />}
      {tab === "reservations" && <ReservationsPanel />}
      {tab === "fines" && <FinesPanel />}
    </div>
  );
}

function IssueReturn() {
  const { token } = useAuth();
  const [bookQuery, setBookQuery] = useState("");
  const [bookOptions, setBookOptions] = useState([]);
  const [bookId, setBookId] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState({ n: 0, text: "" });
  const [loans, setLoans] = useState(null);

  const refreshLoans = useCallback(() => {
    apiFetch("/loans?status=active", { token }).then(setLoans);
  }, [token]);
  useEffect(refreshLoans, [refreshLoans]);

  useEffect(() => {
    if (!bookQuery.trim()) { setBookOptions([]); return; }
    const t = setTimeout(() => {
      apiFetch(`/books?q=${encodeURIComponent(bookQuery)}&per_page=8`).then((r) => setBookOptions(r.results.filter((b) => b.copies_available > 0)));
    }, 250);
    return () => clearTimeout(t);
  }, [bookQuery]);

  const issue = async () => {
    try {
      await apiFetch("/loans/issue", { method: "POST", token, body: { book_id: Number(bookId), student_number: studentNumber } });
      setBookId(""); setBookQuery(""); setStudentNumber(""); setError("");
      setFlash({ n: flash.n + 1, text: "ISSUED" });
      refreshLoans();
    } catch (e) { setError(e.message); }
  };
  const returnLoan = async (id) => { await apiFetch(`/loans/${id}/return`, { method: "POST", token }); setFlash({ n: flash.n + 1, text: "RETURNED" }); refreshLoans(); };
  const renew = async (id) => { try { await apiFetch(`/loans/${id}/renew`, { method: "POST", token }); refreshLoans(); } catch (e) { setError(e.message); } };

  return (
    <>
      <div className="panel" style={{ marginBottom: 18, position: "relative" }}>
        <div className="field-pair">
          <Field label="Book (search by title)">
            <input className="text-input" value={bookQuery} onChange={(e) => { setBookQuery(e.target.value); setBookId(""); }} placeholder="Start typing a title\u2026" />
            {bookOptions.length > 0 && !bookId && (
              <div className="autocomplete">
                {bookOptions.map((b) => (
                  <button key={b.id} type="button" onClick={() => { setBookId(String(b.id)); setBookQuery(`${b.title} \u2014 ${b.ddc}`); setBookOptions([]); }}>
                    {b.title} \u2014 {b.ddc} ({b.copies_available} left)
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field label="Student / faculty number">
            <input className="text-input mono" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} onKeyDown={(e) => e.key === "Enter" && issue()} />
          </Field>
        </div>
        {error && <p className="form-error"><AlertTriangle size={14} /> {error}</p>}
        <button className="primary-btn" onClick={issue} disabled={!bookId || !studentNumber} type="button">Issue loan</button>
        {flash.n > 0 && <div className="stamp" key={flash.n}><Check size={13} strokeWidth={3} /> {flash.text}</div>}
      </div>

      <h2>Active loans</h2>
      {!loans ? <Loading /> : loans.length === 0 ? <p className="empty-note">No books currently on loan.</p> : (
        <div className="book-table-wrap">
          <table className="book-table">
            <thead><tr><th>Title</th><th>Borrower</th><th>Due</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {loans.map((l) => {
                const late = daysBetween(new Date(l.due_date).getTime(), Date.now());
                return (
                  <tr key={l.id}>
                    <td className="book-title-cell">{l.book_title}<div className="book-year mono">{l.ddc}</div></td>
                    <td>{l.student_name}<div className="book-year mono">{l.student_number}</div></td>
                    <td>{fmtDate(l.due_date)}</td>
                    <td>{late > 0 ? <span className="pill pill-red">{late}d overdue</span> : <span className="pill pill-green">On time</span>}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="ghost-btn" onClick={() => renew(l.id)} disabled={l.renewals >= 2} type="button"><RotateCcw size={13} /> Renew</button>
                      <button className="ghost-btn accent" onClick={() => returnLoan(l.id)} type="button"><Undo2 size={13} /> Return</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ReservationsPanel() {
  const { token } = useAuth();
  const [reservations, setReservations] = useState(null);
  const [bookQuery, setBookQuery] = useState(""); const [bookId, setBookId] = useState(""); const [bookOptions, setBookOptions] = useState([]);
  const [studentNumber, setStudentNumber] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => apiFetch("/reservations", { token }).then(setReservations), [token]);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (!bookQuery.trim()) { setBookOptions([]); return; }
    const t = setTimeout(() => apiFetch(`/books?q=${encodeURIComponent(bookQuery)}&per_page=8`).then((r) => setBookOptions(r.results)), 250);
    return () => clearTimeout(t);
  }, [bookQuery]);

  const reserve = async () => {
    try {
      await apiFetch("/reservations", { method: "POST", token, body: { book_id: Number(bookId), student_number: studentNumber } });
      setBookId(""); setBookQuery(""); setStudentNumber(""); setError(""); refresh();
    } catch (e) { setError(e.message); }
  };
  const cancel = async (id) => { await apiFetch(`/reservations/${id}`, { method: "DELETE", token }); refresh(); };

  return (
    <>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="field-pair">
          <Field label="Book">
            <input className="text-input" value={bookQuery} onChange={(e) => { setBookQuery(e.target.value); setBookId(""); }} placeholder="Search a title\u2026" />
            {bookOptions.length > 0 && !bookId && (
              <div className="autocomplete">
                {bookOptions.map((b) => <button key={b.id} type="button" onClick={() => { setBookId(String(b.id)); setBookQuery(b.title); setBookOptions([]); }}>{b.title} \u2014 {b.ddc}</button>)}
              </div>
            )}
          </Field>
          <Field label="Student / faculty number"><input className="text-input mono" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} /></Field>
        </div>
        {error && <p className="form-error"><AlertTriangle size={14} /> {error}</p>}
        <button className="primary-btn" onClick={reserve} disabled={!bookId || !studentNumber} type="button">Place reservation</button>
      </div>
      {!reservations ? <Loading /> : reservations.length === 0 ? <p className="empty-note">No reservations yet.</p> : (
        <div className="book-table-wrap">
          <table className="book-table">
            <thead><tr><th>Title</th><th>Requested by</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id}>
                  <td className="book-title-cell">{r.book_title}</td>
                  <td>{r.student_name}<div className="book-year mono">{r.student_number}</div></td>
                  <td>{r.status === "ready" ? <span className="pill pill-green">Ready for pickup</span> : r.status === "waiting" ? <span className="pill pill-amber">Waiting</span> : <span className="pill">Cancelled</span>}</td>
                  <td><button className="icon-btn danger" onClick={() => cancel(r.id)} type="button"><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FinesPanel() {
  const { token } = useAuth();
  const [loans, setLoans] = useState(null);
  const refresh = useCallback(() => apiFetch("/loans", { token }).then((all) => setLoans(all.filter((l) => l.fine_amount > 0))), [token]);
  useEffect(refresh, [refresh]);
  const markPaid = async (id) => { await apiFetch(`/loans/${id}/fine`, { method: "PUT", token, body: { paid: true } }); refresh(); };
  const waive = async (id) => { await apiFetch(`/loans/${id}/fine`, { method: "PUT", token, body: { waive: true } }); refresh(); };

  if (!loans) return <Loading />;
  const outstanding = loans.filter((l) => !l.fine_paid).reduce((s, l) => s + l.fine_amount, 0);
  const collected = loans.filter((l) => l.fine_paid).reduce((s, l) => s + l.fine_amount, 0);
  return (
    <>
      <div className="stat-row" style={{ gridTemplateColumns: "repeat(2,1fr)", marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--brick)" }}>\u20b1{outstanding.toFixed(2)}</div><div className="stat-label">Outstanding fines</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--lamp)" }}>\u20b1{collected.toFixed(2)}</div><div className="stat-label">Collected fines</div></div>
      </div>
      {loans.length === 0 ? <p className="empty-note">No fines on record.</p> : (
        <div className="book-table-wrap">
          <table className="book-table">
            <thead><tr><th>Title</th><th>Borrower</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td className="book-title-cell">{l.book_title}</td>
                  <td>{l.student_name}</td>
                  <td className="mono">\u20b1{l.fine_amount.toFixed(2)}</td>
                  <td>{l.fine_paid ? <span className="pill pill-green">Paid</span> : <span className="pill pill-red">Unpaid</span>}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {!l.fine_paid && <button className="ghost-btn accent" onClick={() => markPaid(l.id)} type="button">Mark paid</button>}
                    {!l.fine_paid && <button className="ghost-btn" onClick={() => waive(l.id)} type="button">Waive</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// =============================================================================
function SelfService() {
  const { token, user } = useAuth();
  const [input, setInput] = useState(user.linkedNumber || "");
  const [student, setStudent] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loans, setLoans] = useState([]);
  const [reservations, setReservations] = useState([]);

  const lookup = useCallback(async (num) => {
    try {
      const s = await apiFetch(`/students/${num}`, { token });
      setStudent(s); setNotFound(false);
      const allLoans = await apiFetch(`/loans?student_number=${num}`, { token });
      setLoans(allLoans);
      const allRes = await apiFetch("/reservations", { token });
      setReservations(allRes.filter((r) => r.student_number === num));
    } catch { setStudent(null); setNotFound(true); }
  }, [token]);

  useEffect(() => { if (user.linkedNumber) lookup(user.linkedNumber); }, [user.linkedNumber, lookup]);

  const active = loans.filter((l) => l.status === "active");
  const history = loans.filter((l) => l.status === "returned");
  const outstandingFines = loans.filter((l) => l.fine_amount > 0 && !l.fine_paid).reduce((s, l) => s + l.fine_amount, 0);

  return (
    <div className="page">
      <h1>My library account</h1>
      {!user.linkedNumber && (
        <div className="panel" style={{ maxWidth: 480, marginBottom: 20 }}>
          <Field label="Student / faculty number"><input className="text-input big mono" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookup(input)} /></Field>
          <button className="primary-btn" onClick={() => lookup(input)} type="button">View account</button>
          {notFound && <p className="form-error"><AlertTriangle size={14} /> No record found.</p>}
        </div>
      )}
      {student && (
        <>
          <div className={`id-card ${student.status === "blocked" ? "blocked" : ""}`} style={{ marginBottom: 24 }}>
            <div className="id-avatar">{initialsFor(student.name)}</div>
            <div className="id-info">
              <div className="id-name">{student.name}</div>
              <div className="id-meta">{student.student_number} \u00b7 {student.course}</div>
              {outstandingFines > 0 && <div className="id-alert"><Wallet size={13} /> \u20b1{outstandingFines.toFixed(2)} in outstanding fines</div>}
            </div>
          </div>
          <h2>Currently borrowed ({active.length})</h2>
          {active.length === 0 ? <p className="empty-note">Nothing borrowed right now.</p> : (
            <div className="book-table-wrap" style={{ marginBottom: 22 }}>
              <table className="book-table"><thead><tr><th>Title</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>{active.map((l) => {
                  const late = daysBetween(new Date(l.due_date).getTime(), Date.now());
                  return <tr key={l.id}><td className="book-title-cell">{l.book_title}</td><td>{fmtDate(l.due_date)}</td><td>{late > 0 ? <span className="pill pill-red">{late}d overdue</span> : <span className="pill pill-green">On time</span>}</td></tr>;
                })}</tbody>
              </table>
            </div>
          )}
          <h2>Reservations</h2>
          {reservations.length === 0 ? <p className="empty-note">No active reservations.</p> : (
            <div className="mini-list" style={{ marginBottom: 22 }}>
              {reservations.map((r) => (
                <div className="mini-row" key={r.id}>
                  <span className="mini-avatar"><BookMarked size={14} /></span>
                  <div className="mini-info"><div className="mini-name">{r.book_title}</div></div>
                  {r.status === "ready" ? <span className="pill pill-green">Ready</span> : <span className="pill pill-amber">Waiting</span>}
                </div>
              ))}
            </div>
          )}
          <h2>Borrowing history</h2>
          {history.length === 0 ? <p className="empty-note">No past loans yet.</p> : (
            <div className="book-table-wrap"><table className="book-table"><thead><tr><th>Title</th><th>Returned</th><th>Fine</th></tr></thead>
              <tbody>{history.map((l) => <tr key={l.id}><td className="book-title-cell">{l.book_title}</td><td>{fmtDate(l.return_date)}</td><td>{l.fine_amount > 0 ? `\u20b1${l.fine_amount.toFixed(2)}${l.fine_paid ? " (paid)" : ""}` : "\u2014"}</td></tr>)}</tbody>
            </table></div>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
function Entrance() {
  const { token } = useAuth();
  const [input, setInput] = useState("");
  const [found, setFound] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [flash, setFlash] = useState(0);
  const [recent, setRecent] = useState([]);
  const inputRef = useRef(null);

  const refreshRecent = useCallback(() => apiFetch("/attendance", { token }).then((r) => setRecent(r.slice(0, 8))), [token]);
  useEffect(refreshRecent, [refreshRecent]);

  const lookup = async () => {
    if (!input.trim()) return;
    try { setFound(await apiFetch(`/students/${input.trim()}`, { token })); setNotFound(false); }
    catch { setFound(null); setNotFound(true); }
  };
  const logEntry = async () => {
    await apiFetch("/attendance/checkin", { method: "POST", token, body: { student_number: found.student_number } });
    setFlash((n) => n + 1); setFound(null); setInput(""); refreshRecent();
    inputRef.current?.focus();
  };

  return (
    <div className="page">
      <h1>Check students in</h1>
      <div className="entrance-layout">
        <div className="panel">
          <Field label="Student number">
            <input ref={inputRef} className="text-input big mono" value={input} autoFocus
              onChange={(e) => { setInput(e.target.value); setNotFound(false); }} onKeyDown={(e) => e.key === "Enter" && lookup()} />
          </Field>
          <button className="primary-btn" onClick={lookup} type="button">Look up</button>
          {notFound && <p className="form-error"><AlertTriangle size={14} /> No record found.</p>}
          {found && (
            <div className={`id-card ${found.status === "blocked" ? "blocked" : ""}`}>
              <div className="id-avatar">{initialsFor(found.name)}</div>
              <div className="id-info">
                <div className="id-name">{found.name}</div>
                <div className="id-meta">{found.course} \u00b7 {found.year} - {found.section}</div>
                {found.status === "blocked" && <div className="id-alert"><AlertTriangle size={13} /> {found.reason}</div>}
              </div>
              <button className="primary-btn" onClick={logEntry} type="button">Log entry</button>
            </div>
          )}
          {flash > 0 && <div className="stamp" key={flash}><Check size={13} strokeWidth={3} /> LOGGED</div>}
        </div>
        <div className="panel">
          <h2>Recent check-ins</h2>
          {recent.length === 0 ? <p className="empty-note">Nobody checked in yet.</p> : (
            <div className="mini-list">
              {recent.map((l) => (
                <div className="mini-row" key={l.id}>
                  <span className={`mini-avatar ${l.alert ? "alert" : ""}`}>{initialsFor(l.name)}</span>
                  <div className="mini-info"><div className="mini-name">{l.name}</div><div className="mini-meta">{l.student_number}</div></div>
                  <div className="mini-time">{new Date(l.time_in).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttendanceLog() {
  const { token } = useAuth();
  const [date, setDate] = useState("");
  const [rows, setRows] = useState(null);
  useEffect(() => { apiFetch(`/attendance${date ? `?date=${date}` : ""}`, { token }).then(setRows); }, [date, token]);
  return (
    <div className="page">
      <h1>Attendance records</h1>
      <input type="date" className="text-input" style={{ marginBottom: 16, maxWidth: 200 }} value={date} onChange={(e) => setDate(e.target.value)} />
      {!rows ? <Loading /> : rows.length === 0 ? <p className="empty-note">No visits match.</p> : (
        <div className="book-table-wrap">
          <table className="book-table">
            <thead><tr><th>Student no.</th><th>Name</th><th>Course</th><th>Time in</th></tr></thead>
            <tbody>{rows.map((l) => <tr key={l.id}><td className="mono">{l.student_number}</td><td>{l.name}</td><td>{l.course}</td><td>{new Date(l.time_in).toLocaleString("en-PH")}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =============================================================================
function DigitalResources() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [resources, setResources] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const blank = { title: "", author: "", type: "E-book", subject: "", year: "", sizeLabel: "" };
  const [form, setForm] = useState(blank);

  const refresh = useCallback(() => apiFetch(`/resources${search ? `?q=${encodeURIComponent(search)}` : ""}`).then(setResources), [search]);
  useEffect(refresh, [refresh]);

  const submitAdd = async () => {
    if (!form.title.trim()) return;
    await apiFetch("/resources", { method: "POST", token, body: form });
    setForm(blank); setShowAdd(false); refresh();
  };
  const download = async (r) => { await apiFetch(`/resources/${r.id}/download`, { method: "POST" }); refresh(); };

  return (
    <div className="page">
      <h1>E-library</h1>
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div className="search-bar" style={{ marginBottom: 0, flex: 1 }}>
          <Search size={16} /><input placeholder="Search\u2026" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="ghost-btn accent" onClick={() => setShowAdd((s) => !s)} type="button"><PlusCircle size={14} /> Add resource</button>
      </div>
      {showAdd && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="field-pair">
            <Field label="Title"><input className="text-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Author"><input className="text-input" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} /></Field>
          </div>
          <div className="field-pair">
            <Field label="Type"><select className="text-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>E-book</option><option>Thesis</option><option>Research Paper</option></select></Field>
            <Field label="Subject"><input className="text-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          </div>
          <button className="primary-btn" onClick={submitAdd} type="button">Add to e-library</button>
        </div>
      )}
      {!resources ? <Loading /> : resources.length === 0 ? <p className="empty-note">No resources found.</p> : (
        <div className="resource-list">
          {resources.map((r) => (
            <div className="panel resource-card" key={r.id}>
              <div className="resource-top">
                <div><span className="pill pill-amber">{r.type}</span><div className="resource-title">{r.title}</div><div className="resource-meta">{r.author} \u00b7 {r.subject} \u00b7 {r.year}</div></div>
                <button className="ghost-btn accent" onClick={() => download(r)} type="button"><Download size={13} /> Download ({r.downloads})</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
function InterBranchTransfers() {
  const { token } = useAuth();
  const [branches, setBranches] = useState([]);
  const [transfers, setTransfers] = useState(null);
  const [bookQuery, setBookQuery] = useState(""); const [bookId, setBookId] = useState(""); const [bookOptions, setBookOptions] = useState([]);
  const [fromB, setFromB] = useState(""); const [toB, setToB] = useState(""); const [qty, setQty] = useState("1");
  const [error, setError] = useState("");

  const refresh = useCallback(() => apiFetch("/transfers", { token }).then(setTransfers), [token]);
  useEffect(() => { apiFetch("/branches").then((b) => { setBranches(b); setFromB(b[0]); setToB(b[1]); }); refresh(); }, [refresh]);
  useEffect(() => {
    if (!bookQuery.trim()) { setBookOptions([]); return; }
    const t = setTimeout(() => apiFetch(`/books?q=${encodeURIComponent(bookQuery)}&per_page=8`).then((r) => setBookOptions(r.results)), 250);
    return () => clearTimeout(t);
  }, [bookQuery]);

  const request = async () => {
    try { await apiFetch("/transfers", { method: "POST", token, body: { book_id: Number(bookId), from_branch: fromB, to_branch: toB, quantity: Number(qty) } }); setBookId(""); setBookQuery(""); refresh(); }
    catch (e) { setError(e.message); }
  };
  const advance = async (id) => { await apiFetch(`/transfers/${id}/advance`, { method: "PUT", token }); refresh(); };

  return (
    <div className="page">
      <h1>Inter-branch transfers</h1>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="field-pair">
          <Field label="Book">
            <input className="text-input" value={bookQuery} onChange={(e) => { setBookQuery(e.target.value); setBookId(""); }} />
            {bookOptions.length > 0 && !bookId && <div className="autocomplete">{bookOptions.map((b) => <button key={b.id} type="button" onClick={() => { setBookId(String(b.id)); setBookQuery(b.title); setBookOptions([]); }}>{b.title}</button>)}</div>}
          </Field>
          <Field label="Quantity"><input className="text-input" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        </div>
        <div className="field-pair">
          <Field label="From"><select className="text-input" value={fromB} onChange={(e) => setFromB(e.target.value)}>{branches.map((b) => <option key={b}>{b}</option>)}</select></Field>
          <Field label="To"><select className="text-input" value={toB} onChange={(e) => setToB(e.target.value)}>{branches.map((b) => <option key={b}>{b}</option>)}</select></Field>
        </div>
        {error && <p className="form-error"><AlertTriangle size={14} /> {error}</p>}
        <button className="primary-btn" onClick={request} disabled={!bookId} type="button">Request transfer</button>
      </div>
      {!transfers ? <Loading /> : transfers.length === 0 ? <p className="empty-note">No transfers yet.</p> : (
        <div className="book-table-wrap">
          <table className="book-table"><thead><tr><th>Title</th><th>Route</th><th>Status</th><th></th></tr></thead>
            <tbody>{transfers.map((t) => (
              <tr key={t.id}>
                <td className="book-title-cell">{t.book_title}</td>
                <td>{t.from_branch} <ChevronRight size={12} /> {t.to_branch}</td>
                <td>{t.status === "completed" ? <span className="pill pill-green">Completed</span> : t.status === "in-transit" ? <span className="pill pill-amber">In transit</span> : <span className="pill">Requested</span>}</td>
                <td>{t.status !== "completed" && <button className="ghost-btn" onClick={() => advance(t.id)} type="button">Advance</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =============================================================================
function DailyServices() {
  const [tab, setTab] = useState("rooms");
  return (
    <div className="page">
      <h1>Rooms, reference &amp; reports</h1>
      <div className="tab-switch">
        <button className={tab === "rooms" ? "active" : ""} onClick={() => setTab("rooms")} type="button">Room bookings</button>
        <button className={tab === "reference" ? "active" : ""} onClick={() => setTab("reference")} type="button">Reference desk</button>
        <button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")} type="button">Lost &amp; damaged</button>
      </div>
      {tab === "rooms" && <RoomsAdmin />}
      {tab === "reference" && <ReferenceAdmin />}
      {tab === "reports" && <LostDamagedAdmin />}
    </div>
  );
}
function RoomsAdmin() {
  const { token } = useAuth();
  const [rows, setRows] = useState(null);
  const refresh = useCallback(() => apiFetch("/rooms/bookings", { token }).then(setRows), [token]);
  useEffect(refresh, [refresh]);
  const setStatus = async (id, status) => { await apiFetch(`/rooms/bookings/${id}/status`, { method: "PUT", token, body: { status } }); refresh(); };
  if (!rows) return <Loading />;
  if (rows.length === 0) return <p className="empty-note">No room bookings yet.</p>;
  return (
    <div className="book-table-wrap"><table className="book-table"><thead><tr><th>Room</th><th>Date</th><th>Slot</th><th>By</th><th>Status</th><th></th></tr></thead>
      <tbody>{rows.map((b) => (
        <tr key={b.id}>
          <td>{b.room}</td><td>{b.date}</td><td>{b.slot}</td><td>{b.student_name}</td>
          <td>{b.status === "approved" ? <span className="pill pill-green">Approved</span> : b.status === "cancelled" ? <span className="pill pill-red">Cancelled</span> : <span className="pill pill-amber">Pending</span>}</td>
          <td style={{ display: "flex", gap: 6 }}>
            {b.status === "pending" && <button className="ghost-btn accent" onClick={() => setStatus(b.id, "approved")} type="button">Approve</button>}
            {b.status !== "cancelled" && <button className="ghost-btn" onClick={() => setStatus(b.id, "cancelled")} type="button">Cancel</button>}
          </td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
function ReferenceAdmin() {
  const { token } = useAuth();
  const [rows, setRows] = useState(null);
  const [answering, setAnswering] = useState(null); const [text, setText] = useState("");
  const refresh = useCallback(() => apiFetch("/reference", { token }).then(setRows), [token]);
  useEffect(refresh, [refresh]);
  const submit = async (id) => { await apiFetch(`/reference/${id}/answer`, { method: "PUT", token, body: { answer: text } }); setAnswering(null); setText(""); refresh(); };
  if (!rows) return <Loading />;
  if (rows.length === 0) return <p className="empty-note">No questions yet.</p>;
  return (
    <div className="mini-list">{rows.map((q) => (
      <div className="panel" key={q.id} style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div><div className="mini-name">{q.question}</div><div className="mini-meta">{q.student_name}</div></div>
          {q.status === "answered" ? <span className="pill pill-green">Answered</span> : <span className="pill pill-amber">Open</span>}
        </div>
        {q.status === "answered" && <p className="resource-preview">{q.answer}</p>}
        {q.status === "open" && (answering === q.id
          ? <div style={{ marginTop: 10 }}><textarea className="text-input" style={{ width: "100%", minHeight: 60 }} value={text} onChange={(e) => setText(e.target.value)} /><button className="primary-btn" style={{ marginTop: 8 }} onClick={() => submit(q.id)} type="button">Send</button></div>
          : <button className="ghost-btn accent" style={{ marginTop: 10 }} onClick={() => setAnswering(q.id)} type="button">Answer</button>)}
      </div>
    ))}</div>
  );
}
function LostDamagedAdmin() {
  const { token } = useAuth();
  const [rows, setRows] = useState(null);
  const refresh = useCallback(() => apiFetch("/lost-damaged", { token }).then(setRows), [token]);
  useEffect(refresh, [refresh]);
  const resolve = async (id) => { await apiFetch(`/lost-damaged/${id}/resolve`, { method: "PUT", token }); refresh(); };
  if (!rows) return <Loading />;
  if (rows.length === 0) return <p className="empty-note">No reports yet.</p>;
  return (
    <div className="book-table-wrap"><table className="book-table"><thead><tr><th>Type</th><th>Title</th><th>By</th><th>Status</th><th></th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}>
          <td>{r.type === "lost" ? <span className="pill pill-red">Lost</span> : <span className="pill pill-amber">Damaged</span>}</td>
          <td className="book-title-cell">{r.book_title}</td><td>{r.student_name}</td>
          <td>{r.status === "resolved" ? <span className="pill pill-green">Resolved</span> : <span className="pill">Reported</span>}</td>
          <td>{r.status !== "resolved" && <button className="ghost-btn accent" onClick={() => resolve(r.id)} type="button">Resolve</button>}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

// =============================================================================
function Admin() {
  const [tab, setTab] = useState("users");
  return (
    <div className="page">
      <h1>Users, reports &amp; alerts</h1>
      <div className="tab-switch">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")} type="button">Students</button>
        <button className={tab === "staff" ? "active" : ""} onClick={() => setTab("staff")} type="button">Staff accounts</button>
        <button className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")} type="button">Notifications</button>
      </div>
      {tab === "users" && <UsersPanel />}
      {tab === "staff" && <StaffPanel />}
      {tab === "notifications" && <NotificationsPanel />}
    </div>
  );
}
function UsersPanel() {
  const { token } = useAuth();
  const [q, setQ] = useState(""); const [result, setResult] = useState(null); const [page, setPage] = useState(1);
  const refresh = useCallback(() => apiFetch(`/students?q=${encodeURIComponent(q)}&page=${page}`, { token }).then(setResult), [q, page, token]);
  useEffect(refresh, [refresh]);
  const toggle = async (num, status) => { await apiFetch(`/students/${num}/status`, { method: "PUT", token, body: { status: status === "active" ? "blocked" : "active" } }); refresh(); };
  return (
    <>
      <div className="search-bar" style={{ marginBottom: 16, maxWidth: 320 }}><Search size={16} /><input placeholder="Search 34,895 students\u2026" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      {!result ? <Loading /> : (
        <>
          <div className="book-table-wrap">
            <table className="book-table"><thead><tr><th>Number</th><th>Name</th><th>Course</th><th>Status</th><th></th></tr></thead>
              <tbody>{result.results.map((s) => (
                <tr key={s.student_number}>
                  <td className="mono">{s.student_number}</td><td>{s.name}</td><td>{s.course}</td>
                  <td>{s.status === "blocked" ? <span className="pill pill-red">Blocked</span> : <span className="pill pill-green">Active</span>}</td>
                  <td><button className="ghost-btn" onClick={() => toggle(s.student_number, s.status)} type="button">{s.status === "blocked" ? "Unblock" : "Block"}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="pager"><button className="ghost-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} type="button">Previous</button><span>Page {page} of {Math.ceil(result.total / result.per_page)} ({result.total.toLocaleString()} total)</span><button className="ghost-btn" disabled={page * result.per_page >= result.total} onClick={() => setPage((p) => p + 1)} type="button">Next</button></div>
        </>
      )}
    </>
  );
}
function StaffPanel() {
  const { token } = useAuth();
  const [staff, setStaff] = useState(null);
  const blank = { name: "", username: "", password: "", email: "" };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const refresh = useCallback(() => apiFetch("/staff", { token }).then(setStaff), [token]);
  useEffect(refresh, [refresh]);
  const create = async () => {
    try { await apiFetch("/auth/staff", { method: "POST", token, body: form }); setForm(blank); setError(""); refresh(); }
    catch (e) { setError(e.message); }
  };
  const remove = async (id) => { await apiFetch(`/staff/${id}`, { method: "DELETE", token }); refresh(); };
  return (
    <>
      <p className="page-sub" style={{ marginTop: -6 }}>Only the admin account can create librarian logins.</p>
      <div className="panel" style={{ marginBottom: 18, maxWidth: 480 }}>
        <Field label="Full name"><input className="text-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="field-pair">
          <Field label="Username"><input className="text-input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="Password"><input className="text-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        </div>
        {error && <p className="form-error"><AlertTriangle size={14} /> {error}</p>}
        <button className="primary-btn" onClick={create} type="button">Create librarian account</button>
      </div>
      {!staff ? <Loading /> : (
        <div className="book-table-wrap"><table className="book-table"><thead><tr><th>Name</th><th>Username</th><th></th></tr></thead>
          <tbody>{staff.map((s) => <tr key={s.id}><td>{s.name}</td><td className="mono">{s.username}</td><td><button className="icon-btn danger" onClick={() => remove(s.id)} type="button"><X size={14} /></button></td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}
function NotificationsPanel() {
  const { token } = useAuth();
  const [items, setItems] = useState(null);
  useEffect(() => { apiFetch("/notifications", { token }).then(setItems); }, [token]);
  if (!items) return <Loading />;
  if (items.length === 0) return <p className="empty-note">No alerts right now.</p>;
  return (
    <div className="mini-list">{items.map((n, i) => (
      <div className="mini-row" key={i}>
        <span className={`mini-avatar ${n.type === "overdue" || n.type === "fine" ? "alert" : ""}`}><Bell size={13} /></span>
        <div className="mini-info"><div className="mini-name" style={{ fontWeight: 500 }}>{n.text}</div></div>
      </div>
    ))}</div>
  );
}

// =============================================================================
const CSS = `
:root{
  --navy:#14213B; --navy-mid:#1D2E4D; --paper:#F2F1EC; --card:#FFFFFF; --ink:#1B2233; --ink-dim:#656B78;
  --brass:#B4872F; --brass-dim:#8C6A24; --lamp:#2F6B4F; --brick:#B23A2E; --hairline:#DEDAD0; --hairline-dark:#2A3A5C;
  --font-serif: Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
  --font-sans: -apple-system, "Inter", "Segoe UI", sans-serif;
}
*{box-sizing:border-box;}
.app{display:flex; min-height:100vh; background:var(--paper); color:var(--ink); font-family:var(--font-sans);}
button{font-family:inherit; cursor:pointer;} input,select,textarea{font-family:inherit;}
h1{font-family:var(--font-serif); font-size:26px; font-weight:600; margin:0 0 4px;}
h2{font-family:var(--font-serif); font-size:17px; font-weight:600; margin:0 0 14px;}
.spin{animation:spin 1s linear infinite;} @keyframes spin{to{transform:rotate(360deg);}}
.code-block{background:var(--paper); border:1px solid var(--hairline); border-radius:6px; padding:10px 12px; font-size:12.5px; text-align:left; margin:10px 0;}

.sidebar{width:236px; flex-shrink:0; background:var(--navy); color:#EDEFF5; padding:22px 14px; display:flex; flex-direction:column; gap:22px; position:sticky; top:0; align-self:flex-start; height:100vh; overflow-y:auto;}
.brand{display:flex; gap:10px; align-items:center; padding:0 6px 16px; border-bottom:1px solid var(--hairline-dark);}
.brand-mark{width:38px; height:38px; border-radius:4px; background:var(--brass); color:#1a1400; font-family:var(--font-serif); font-weight:700; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0;}
.brand-name{font-family:var(--font-serif); font-size:14.5px; font-weight:700; line-height:1.25;}
.brand-sub{font-size:10.5px; color:#9FA9C2; margin-top:1px;}
.nav-group-label{font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:#7C88A6; padding:0 10px; margin-bottom:6px;}
.nav-group{display:flex; flex-direction:column; gap:2px;}
.nav-item{position:relative; display:flex; align-items:center; gap:10px; background:transparent; border:none; color:#C7CEDD; padding:9px 10px 9px 16px; border-radius:6px; font-size:13.5px; text-align:left; transition:background .15s, color .15s;}
.nav-item:hover{background:var(--navy-mid); color:#fff;} .nav-item.active{background:var(--navy-mid); color:#fff;}
.nav-pull{position:absolute; left:0; top:50%; transform:translateY(-50%); width:3px; height:0; background:var(--brass); border-radius:2px; transition:height .15s;}
.nav-item.active .nav-pull{height:60%;}

.main{flex:1; overflow-y:auto;} .main-body{max-width:1080px; margin:0 auto; padding:0 40px 60px;} .page{padding:36px 0 0;} .page-sub{color:var(--ink-dim); font-size:13.5px; margin:0 0 26px;}
.topbar-global{position:sticky; top:0; z-index:5; display:flex; justify-content:flex-end; align-items:center; padding:12px 40px; background:var(--paper); border-bottom:1px solid var(--hairline);}
.user-chip-wrap{position:relative;} .user-chip{display:flex; align-items:center; gap:9px; background:var(--card); border:1px solid var(--hairline); border-radius:20px; padding:5px 12px 5px 5px;}
.user-chip-text{display:flex; flex-direction:column; align-items:flex-start; line-height:1.2;} .user-chip-name{font-size:12.5px; font-weight:600;} .user-chip-role{font-size:10.5px; color:var(--ink-dim); text-transform:capitalize;}
.user-menu{position:absolute; right:0; top:calc(100% + 6px); background:var(--card); border:1px solid var(--hairline); border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.12); overflow:hidden; min-width:150px; z-index:10;}
.user-menu button{display:block; width:100%; text-align:left; padding:10px 14px; background:transparent; border:none; font-size:13px;} .user-menu button:hover{background:var(--paper);}

.login-screen{flex:1; display:flex; align-items:center; justify-content:center; min-height:100vh; width:100%;}
.login-card{background:var(--card); border:1px solid var(--hairline); border-radius:12px; padding:32px; width:100%; max-width:380px; text-align:left;}
.demo-hint{margin-top:18px; font-size:12px; color:var(--ink-dim);} .demo-hint summary{cursor:pointer; color:var(--brass-dim); font-weight:600;} .demo-hint ul{margin:8px 0 0; padding-left:18px; line-height:1.8;}

.stat-row{display:grid; grid-template-columns:repeat(5,1fr); gap:14px; margin-bottom:26px;}
.stat-card{background:var(--card); border:1px solid var(--hairline); border-radius:8px; padding:16px 18px;}
.stat-num{font-family:var(--font-serif); font-size:26px; font-weight:700; color:var(--navy);} .stat-of{font-size:15px; color:var(--ink-dim); font-weight:400;} .stat-label{font-size:12px; color:var(--ink-dim); margin-top:2px;}
.panel{background:var(--card); border:1px solid var(--hairline); border-radius:8px; padding:20px; position:relative;}
.class-bars{display:flex; flex-direction:column; gap:9px;} .class-bar-row{display:flex; align-items:center; gap:10px; cursor:pointer;}
.class-bar-code{font-family:var(--font-serif); font-size:12.5px; color:var(--ink-dim); width:32px; flex-shrink:0;}
.class-bar-track{flex:1; height:8px; background:var(--paper); border-radius:4px; overflow:hidden;} .class-bar-fill{height:100%; background:var(--brass); border-radius:4px;}
.class-bar-count{font-size:12px; color:var(--ink-dim); width:32px; text-align:right;}
.mini-list{display:flex; flex-direction:column; gap:10px;} .mini-row{display:flex; align-items:center; gap:10px;}
.mini-avatar{width:32px; height:32px; border-radius:50%; background:var(--navy); color:#fff; font-size:11.5px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.mini-avatar.alert{background:var(--brick);} .mini-info{flex:1; min-width:0;} .mini-name{font-size:13px; font-weight:600;} .mini-meta{font-size:11.5px; color:var(--ink-dim);} .mini-time{font-size:11.5px; color:var(--ink-dim);}
.empty-note{color:var(--ink-dim); font-size:13px;}

.search-bar{display:flex; align-items:center; gap:8px; background:var(--card); border:1px solid var(--hairline); border-radius:8px; padding:10px 14px; margin-bottom:20px; color:var(--ink-dim);}
.search-bar input{background:transparent; border:none; outline:none; color:var(--ink); font-size:14px; flex:1;}
.icon-btn{background:transparent; border:none; color:var(--ink-dim); padding:3px;} .icon-btn:hover{color:var(--ink);} .icon-btn.danger:hover{color:var(--brick);}
.breadcrumb{display:flex; align-items:center; gap:6px; margin-bottom:18px; font-size:12.5px; color:var(--ink-dim);}
.crumb{background:transparent; border:none; color:var(--brass-dim); font-size:12.5px; padding:0;} .crumb.current{color:var(--ink);}
.drawer-grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(190px,1fr)); gap:12px;}
.drawer{position:relative; background:var(--card); border:1px solid var(--hairline); border-radius:6px; padding:22px 14px 14px; text-align:left;}
.drawer:hover{border-color:var(--brass);} .drawer-pull{position:absolute; top:8px; left:50%; transform:translateX(-50%); width:26px; height:5px; border-radius:3px; background:var(--brass);}
.drawer-range{font-family:var(--font-serif); font-size:15px; font-weight:700; color:var(--navy);} .drawer-label{font-size:12px; color:var(--ink-dim); margin-top:4px;}
.book-table-wrap{background:var(--card); border:1px solid var(--hairline); border-radius:8px; overflow-x:auto; overflow-y:hidden; margin-top:14px; -webkit-overflow-scrolling:touch;}
.book-table{min-width:560px;}
.book-table-title{font-size:12px; color:var(--ink-dim); padding:12px 16px 0;}
.book-table{width:100%; border-collapse:collapse; font-size:13.5px;}
.book-table thead th{text-align:left; font-size:11px; color:var(--ink-dim); padding:12px 14px; border-bottom:1px solid var(--hairline); background:var(--paper);}
.book-table tbody td{padding:10px 14px; border-bottom:1px solid var(--hairline);} .book-table tbody tr:last-child td{border-bottom:none;}
.book-title-cell{font-weight:600;} .book-year{font-weight:400; font-size:11.5px; color:var(--ink-dim); margin-top:1px;}
.mono{font-family:var(--font-serif);}
.avail-pill{display:inline-block; background:rgba(47,107,79,0.12); color:var(--lamp); font-size:12px; font-weight:600; padding:2px 9px; border-radius:20px;} .avail-pill.none{background:rgba(178,58,46,0.12); color:var(--brick);}
.pager{display:flex; align-items:center; gap:14px; margin-top:16px; font-size:13px; color:var(--ink-dim);}
.spine-tag{display:flex; flex-direction:column; align-items:center; justify-content:center; background:#fff; border:1.4px solid var(--ink); border-radius:2px; font-family:var(--font-serif); font-weight:700; color:var(--ink);}
.spine-tag.sm{width:38px; height:30px; font-size:9px;} .spine-tag .spine-mark{font-size:0.65em; color:var(--brass-dim); margin-top:2px;}

.field{display:flex; flex-direction:column; gap:6px; margin-bottom:14px; position:relative;}
.field-label{font-size:11.5px; color:var(--ink-dim);} .field-pair{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
.text-input{background:var(--card); border:1px solid var(--hairline); color:var(--ink); border-radius:6px; padding:10px 12px; font-size:14px; outline:none; width:100%;}
.text-input:focus{border-color:var(--brass); box-shadow:0 0 0 3px rgba(180,135,47,0.15);} .text-input.invalid{border-color:var(--brick);} .text-input.big{font-size:17px; padding:13px 14px;}
.form-error{display:flex; align-items:center; gap:6px; color:var(--brick); font-size:12.5px; margin:4px 0 12px;}
.primary-btn{background:var(--navy); color:#fff; border:none; border-radius:7px; padding:11px 18px; font-weight:600; font-size:13.5px;} .primary-btn:hover{background:var(--navy-mid);} .primary-btn:disabled{opacity:.4;}
.ghost-btn{display:flex; align-items:center; gap:6px; background:var(--card); border:1px solid var(--hairline); color:var(--ink); padding:9px 14px; border-radius:7px; font-size:13px;} .ghost-btn:disabled{opacity:.4;} .ghost-btn.accent{color:var(--brass-dim); border-color:var(--brass-dim);}
.stamp{position:absolute; top:-10px; right:16px; background:var(--lamp); color:#fff; font-family:var(--font-serif); font-weight:700; font-size:11px; padding:5px 11px; border-radius:5px; display:flex; align-items:center; gap:5px; transform:rotate(-3deg); box-shadow:0 4px 14px rgba(0,0,0,.25); animation:stampIn .6s ease-out;}
@keyframes stampIn{0%{opacity:0; transform:rotate(-3deg) scale(1.5);} 30%{opacity:1; transform:rotate(-3deg) scale(.95);} 70%{transform:rotate(-3deg) scale(1);} 100%{opacity:0; transform:rotate(-3deg) scale(1) translateY(-6px);}}
.autocomplete{position:absolute; top:100%; left:0; right:0; background:var(--card); border:1px solid var(--hairline); border-radius:6px; margin-top:4px; z-index:20; max-height:220px; overflow-y:auto; box-shadow:0 8px 20px rgba(0,0,0,.12);}
.autocomplete button{display:block; width:100%; text-align:left; padding:8px 12px; background:transparent; border:none; font-size:12.5px; border-bottom:1px solid var(--hairline);} .autocomplete button:hover{background:var(--paper);}

.entrance-layout{display:grid; grid-template-columns:1.2fr 1fr; gap:16px;}
.id-card{display:flex; align-items:center; gap:14px; margin-top:18px; padding:16px; border-radius:8px; background:var(--paper); border-left:4px solid var(--lamp);}
.id-card.blocked{border-left-color:var(--brick);} .id-avatar{width:52px; height:52px; border-radius:50%; background:var(--navy); color:#fff; font-family:var(--font-serif); font-weight:700; font-size:17px; display:flex; align-items:center; justify-content:center;}
.id-info{flex:1;} .id-name{font-size:15px; font-weight:700;} .id-meta{font-size:12.5px; color:var(--ink-dim);} .id-alert{display:flex; align-items:center; gap:5px; color:var(--brick); font-size:12px; margin-top:5px; font-weight:600;}
.profile-row{display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--hairline); font-size:13.5px;} .profile-row span:first-child{color:var(--ink-dim);}
.upload-dropzone{display:flex; align-items:center; gap:14px; background:var(--paper); border:1.5px dashed var(--hairline); border-radius:8px; padding:18px; cursor:pointer; color:var(--brass-dim);}
.upload-title{font-size:13.5px; font-weight:600; color:var(--ink);} .upload-sub{font-size:11.5px; color:var(--ink-dim); margin-top:2px;}
.preview-summary{font-size:13px; color:var(--ink-dim); margin:16px 0 8px;} .success-note{display:flex; align-items:center; gap:7px; color:var(--lamp); font-size:13px; font-weight:600; margin-top:14px;}
.tab-switch{display:flex; gap:6px; margin-bottom:16px;} .tab-switch button{background:var(--card); border:1px solid var(--hairline); color:var(--ink-dim); padding:8px 16px; border-radius:20px; font-size:13px; font-weight:600;} .tab-switch button.active{background:var(--navy); color:#fff; border-color:var(--navy);}
.pill{display:inline-block; font-size:11.5px; font-weight:600; padding:3px 10px; border-radius:20px; background:var(--paper); color:var(--ink-dim);}
.pill-green{background:rgba(47,107,79,0.12); color:var(--lamp);} .pill-red{background:rgba(178,58,46,0.12); color:var(--brick);} .pill-amber{background:rgba(180,135,47,0.14); color:var(--brass-dim);}
.resource-list{display:flex; flex-direction:column; gap:10px;} .resource-card{padding:16px 18px;} .resource-top{display:flex; justify-content:space-between; align-items:flex-start; gap:14px;}
.resource-title{font-family:var(--font-serif); font-size:15px; font-weight:700; margin-top:6px;} .resource-meta{font-size:12px; color:var(--ink-dim); margin-top:3px;}
.resource-preview{font-size:13px; color:var(--ink-dim); margin-top:12px; padding-top:12px; border-top:1px solid var(--hairline);}
@media (max-width:860px){
  .app{flex-direction:column;}
  .sidebar{width:100%; flex-direction:row; overflow-x:auto; position:static; height:auto; -webkit-overflow-scrolling:touch;}
  .nav-group{flex-direction:row; flex-shrink:0;}
  .nav-group-label{display:none;}
  .brand{flex-shrink:0;}
  .stat-row{grid-template-columns:repeat(2,1fr);}
  .entrance-layout{grid-template-columns:1fr;}
  .main-body{padding:0 16px 40px;}
  .topbar-global{padding:12px 16px;}
  .page{padding:20px 0 0;}
  .field-pair{grid-template-columns:1fr;}
  .drawer-grid{grid-template-columns:repeat(auto-fill, minmax(140px,1fr));}
  h1{font-size:21px;}
  .search-bar, .upload-row, .log-toolbar{flex-wrap:wrap;}
  .resource-top{flex-direction:column;}
  .id-card{flex-wrap:wrap;}
  .mini-row{flex-wrap:wrap;}
}
@media (max-width:480px){
  .stat-row{grid-template-columns:1fr;}
  .login-card{padding:22px;}
}
`;
