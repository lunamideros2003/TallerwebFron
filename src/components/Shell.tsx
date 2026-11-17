import { NavLink, Outlet } from 'react-router-dom';
import { API_URL } from '../lib/config';

const LINKS = [
  { to: '/', label: 'Resultados', end: true },
  { to: '/jury', label: 'Jurados', end: false },
  { to: '/verify', label: 'Verificación', end: false },
  { to: '/ops', label: 'Operaciones', end: false },
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
          <span className="brand-sub">conteo electoral en vivo</span>
        </span>
      </div>

      <nav className="nav" aria-label="Principal">
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
        <span className="api-chip mono" title="URL base del backend (VITE_API_URL)">
          {API_URL.replace(/^https?:\/\//, '')}
        </span>
      </div>
    </header>

    <main className="page">
      <Outlet />
    </main>

    <footer className="footer">
      <span>
        Preconteo informativo. El conteo oficial es manual y se realiza sobre las actas físicas.
      </span>
      <span className="mono tiny">
        SSE + WebSocket + HTTP · Backplane Redis · 8 instancias sin estado
      </span>
    </footer>
  </div>
);
