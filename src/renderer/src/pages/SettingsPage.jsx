import { t, LANGUAGES } from '../i18n.js';
import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Field, PLATFORM_LABEL, useToast } from '../components/ui.jsx';
export default function SettingsPage({
  settings,
  refresh
}) {
  const toast = useToast();
  const [s, setS] = useState(null);
  useEffect(() => {
    if (settings && !s) setS(settings);
  }, [settings, s]);
  if (!s) return null;
  const set = (k, v) => setS(prev => ({
    ...prev,
    [k]: v
  }));
  const dirty = s.kernelPath !== settings.kernelPath || s.kernelType !== settings.kernelType;
  const pick = async () => {
    const p = await window.api.pickKernel();
    if (p) set('kernelPath', p);
  };
  const save = async () => {
    try {
      await window.api.updateSettings({
        kernelPath: s.kernelPath.trim(),
        kernelType: s.kernelType
      });
      await refresh();
      toast(t("設定已儲存"), 'success');
    } catch (e) {
      toast(t(e.message), 'error');
    }
  };
  const usingBundled = !s.kernelPath && s.bundledKernel;
  // Language and search engine apply immediately (no "save" needed).
  const applyNow = async patch => {
    setS(prev => ({ ...prev, ...patch }));
    try {
      await window.api.updateSettings(patch);
      await refresh();
    } catch (e) {
      toast(t(e.message), 'error');
    }
  };
  return <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("系統設定")}</h1>
          <p className="page-sub">{t("瀏覽器核心與執行環境")}</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" disabled={!dirty} onClick={save}>{t("儲存設定")}</button>
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <div className="card-icon">
            <Icon name="globe" size={18} />
          </div>
          <div>
            <h3>{t("介面與瀏覽器")}</h3>
            <p>{t("變更會立即生效；搜尋引擎在下次開啟環境時套用")}</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label={t("介面語言")}>
            <select value={s.language || ''} onChange={e => applyNow({ language: e.target.value })}>
              <option value="">{t("跟隨系統")}</option>
              {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </Field>
          <Field label={t("預設搜尋引擎")} hint={t("核心（ungoogled-chromium）預設沒有搜尋引擎，網址列輸入文字不會搜尋")}>
            <select value={s.defaultSearch || 'google'} onChange={e => applyNow({ defaultSearch: e.target.value })}>
              <option value="google">Google</option>
              <option value="kernel">{t("核心預設（不搜尋）")}</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-icon">
            <Icon name="cpu" size={18} />
          </div>
          <div>
            <h3>{t("瀏覽器核心")}</h3>
            <p>{t("所有環境共用同一個核心，指紋偽裝由核心在 C++ 層實作")}</p>
          </div>
        </div>

        {s.bundledKernel && <div className={`kernel-card ${usingBundled ? 'active' : ''}`}>
            <div>
              <div className="kernel-name">fingerprint-chromium {s.bundledKernel.version}</div>
              <div className="sub">{t("內建核心 · Chromium {0} · arm64", {
              0: s.bundledKernel.version.split('.')[0]
            })}</div>
            </div>
            {usingBundled ? <span className="pill green">{t("使用中")}</span> : <button className="btn sm" onClick={() => set('kernelPath', '')}>{t("改用內建")}</button>}
          </div>}

        <div className="form-grid">
          <Field label={t("自訂核心路徑")} hint={t("留空使用內建核心。macOS 可直接選 .app")} span={2}>
            <div className="input-row">
              <input className="mono" value={s.kernelPath} onChange={e => set('kernelPath', e.target.value)} placeholder="/Applications/Chromium.app" />
              <button className="btn" onClick={pick}>{t("選擇…")}</button>
            </div>
          </Field>
          {s.kernelPath && <Field label={t("自訂核心類型")} span={2}>
              <select value={s.kernelType} onChange={e => set('kernelType', e.target.value)}>
                <option value="fingerprint-chromium">{t("fingerprint-chromium（支援指紋偽裝）")}</option>
                <option value="chrome">{t("一般 Chrome / Chromium（只有隔離與代理）")}</option>
              </select>
            </Field>}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-icon">
            <Icon name="monitor" size={18} />
          </div>
          <div>
            <h3>{t("執行環境")}</h3>
            <p>{t("新建環境時會預設使用主機的系統，以獲得最一致的指紋")}</p>
          </div>
        </div>
        <div className="kv wide">
          <span>{t("主機系統")}</span>
          <b>{PLATFORM_LABEL[s.hostPlatform]}</b>
          <span>{t("新環境預設系統")}</span>
          <b>{PLATFORM_LABEL[s.hostPlatform]}</b>
        </div>
      </section>
    </div>;
}