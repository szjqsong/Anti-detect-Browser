import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Field, PLATFORM_LABEL, useToast } from '../components/ui.jsx';

export default function SettingsPage({ settings, refresh }) {
  const toast = useToast();
  const [s, setS] = useState(null);

  useEffect(() => {
    if (settings && !s) setS(settings);
  }, [settings, s]);
  if (!s) return null;

  const set = (k, v) => setS((prev) => ({ ...prev, [k]: v }));
  const dirty = s.kernelPath !== settings.kernelPath || s.kernelType !== settings.kernelType;

  const pick = async () => {
    const p = await window.api.pickKernel();
    if (p) set('kernelPath', p);
  };

  const save = async () => {
    try {
      await window.api.updateSettings({ kernelPath: s.kernelPath.trim(), kernelType: s.kernelType });
      await refresh();
      toast('設定已儲存', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const usingBundled = !s.kernelPath && s.bundledKernel;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>系統設定</h1>
          <p className="page-sub">瀏覽器核心與執行環境</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" disabled={!dirty} onClick={save}>儲存設定</button>
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <div className="card-icon">
            <Icon name="cpu" size={18} />
          </div>
          <div>
            <h3>瀏覽器核心</h3>
            <p>所有環境共用同一個核心，指紋偽裝由核心在 C++ 層實作</p>
          </div>
        </div>

        {s.bundledKernel && (
          <div className={`kernel-card ${usingBundled ? 'active' : ''}`}>
            <div>
              <div className="kernel-name">fingerprint-chromium {s.bundledKernel.version}</div>
              <div className="sub">內建核心 · Chromium {s.bundledKernel.version.split('.')[0]} · arm64</div>
            </div>
            {usingBundled ? (
              <span className="pill green">使用中</span>
            ) : (
              <button className="btn sm" onClick={() => set('kernelPath', '')}>改用內建</button>
            )}
          </div>
        )}

        <div className="form-grid">
          <Field label="自訂核心路徑" hint="留空使用內建核心。macOS 可直接選 .app" span={2}>
            <div className="input-row">
              <input className="mono" value={s.kernelPath} onChange={(e) => set('kernelPath', e.target.value)} placeholder="/Applications/Chromium.app" />
              <button className="btn" onClick={pick}>選擇…</button>
            </div>
          </Field>
          {s.kernelPath && (
            <Field label="自訂核心類型" span={2}>
              <select value={s.kernelType} onChange={(e) => set('kernelType', e.target.value)}>
                <option value="fingerprint-chromium">fingerprint-chromium（支援指紋偽裝）</option>
                <option value="chrome">一般 Chrome / Chromium（只有隔離與代理）</option>
              </select>
            </Field>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-icon">
            <Icon name="monitor" size={18} />
          </div>
          <div>
            <h3>執行環境</h3>
            <p>新建環境時會預設使用主機的系統，以獲得最一致的指紋</p>
          </div>
        </div>
        <div className="kv wide">
          <span>主機系統</span>
          <b>{PLATFORM_LABEL[s.hostPlatform]}</b>
          <span>新環境預設系統</span>
          <b>{PLATFORM_LABEL[s.hostPlatform]}</b>
        </div>
      </section>
    </div>
  );
}
