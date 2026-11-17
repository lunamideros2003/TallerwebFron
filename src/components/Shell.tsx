import { NavLink, Outlet } from 'react-router-dom';
import { API_URL } from '../lib/config';

const LINKS = [
  { to: '/', label: 'Results', end: true },
  { to: '/jury', label: 'Jury', end: false },
  { to: '/verify', label: 'Verification', end: false },
  { to: '/ops', label: 'Operations', end: false },
];

export const Shell = () => (
  <div className="app-shell">
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          PC
        </span>
        <span className="brand-text">
          <strong>Preconteo</strong>
          <span className="brand-sub">realtime election count</span>
        </span>
      </div>

      <nav className="nav" aria-label="Main">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="topbar-meta">
        <span className="api-chip mono" title="Backend base URL (VITE_API_URL)">
          {API_URL.replace(/^https?:\/\//, '')}
        </span>
      </div>
    </header>

    <main className="page">
      <Outlet />
    </main>

    <footer className="footer">
      <span>
        Informational preconteo. The official count is manual and happens on the physical actas.
      </span>
      <span className="mono tiny">
        SSE + WebSocket + HTTP · Redis backplane · 8 stateless instances
      </span>
    </footer>
  </div>
);
