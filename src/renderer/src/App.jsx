import React, { useCallback, useEffect, useState } from 'react';
import Icon from './components/Icon.jsx';
import { ConfirmProvider, ToastProvider } from './components/ui.jsx';
import ProfilesPage from './pages/ProfilesPage.jsx';
import GroupsPage from './pages/GroupsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ApiPage from './pages/ApiPage.jsx';

const NAV = [
  ['profiles', 'profiles', '環境管理'],
  ['groups', 'folder', '分組管理'],
  ['api', 'code', 'API 與自動化'],
  ['settings', 'settings', '系統設定'],
];

function Shell() {
  const [page, setPage] = useState('profiles');
  const [profiles, setProfiles] = useState([]);
  const [status, setStatus] = useState({});
  const [settings, setSettings] = useState(null);

  const refresh = useCallback(async () => {
    const [res, s] = await Promise.all([window.api.listProfiles(), window.api.getSettings()]);
    setProfiles(res.profiles);
    setStatus(res.status);
    setSettings(s);
  }, []);

  useEffect(() => {
    refresh();
    return window.api.onStatus((id, s) => setStatus((prev) => ({ ...prev, [id]: s })));
  }, [refresh]);

  const running = Object.values(status).filter((s) => s.state === 'running').length;
  const ctx = { profiles, status, settings, refresh, setPage };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            {/* Same artwork as build/icon.svg */}
            <svg width="24" height="24" viewBox="280 280 464 480" fill="none" stroke="#fff" strokeWidth="40" strokeLinecap="round">
              <path d="M512 300 a212 212 0 0 1 212 212 v40" />
              <path d="M300 512 a212 212 0 0 1 120 -191" />
              <path d="M300 590 v-78" />
              <path d="M512 380 a132 132 0 0 1 132 132 v70 a120 120 0 0 1 -30 80" />
              <path d="M380 512 a132 132 0 0 1 72 -118" />
              <path d="M380 512 v80 a170 170 0 0 0 52 122" />
              <path d="M512 460 a52 52 0 0 1 52 52 v80 a190 190 0 0 1 -60 140" />
              <path d="M460 512 v80 a110 110 0 0 1 -24 70" />
            </svg>
          </div>
          <div>
            <div className="brand-name">Anti-detect</div>
            <div className="brand-sub">Browser Manager</div>
          </div>
        </div>
        <nav>
          {NAV.map(([key, icon, label]) => (
            <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} onClick={() => setPage(key)}>
              <Icon name={icon} size={18} />
              <span>{label}</span>
              {key === 'profiles' && <span className="nav-count">{profiles.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="foot-row">
            <span className={`dot ${running ? 'green' : ''}`} />
            {running ? `${running} 個環境執行中` : '沒有執行中的環境'}
          </div>
          <div className="foot-row">
            <Icon name="cpu" size={14} />
            {settings?.kernelPath
              ? '自訂核心'
              : settings?.bundledKernel
                ? `核心 ${settings.bundledKernel.version.split('.')[0]}`
                : '未設定核心'}
          </div>
          <div className="foot-row">
            <span className={`dot ${settings?.apiError ? 'red' : 'green'}`} />
            API {settings?.apiError ? '異常' : `:${settings?.apiPort ?? ''}`}
          </div>
        </div>
      </aside>

      <main className="content">
        {page === 'profiles' && <ProfilesPage {...ctx} />}
        {page === 'groups' && <GroupsPage {...ctx} />}
        {page === 'api' && <ApiPage {...ctx} />}
        {page === 'settings' && <SettingsPage {...ctx} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </ToastProvider>
  );
}
