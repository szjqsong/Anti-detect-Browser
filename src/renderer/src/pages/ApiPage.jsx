import { t } from '../i18n.js';
import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Field, useToast } from '../components/ui.jsx';
const ENDPOINTS = [['GET', '/api/v1/status', '健康檢查'], ['GET', '/api/v1/profiles', '環境列表（代理密碼已遮蔽）'], ['POST', '/api/v1/profiles', '新建環境（JSON body）'], ['GET', '/api/v1/profiles/:id', '取得單一環境'], ['POST', '/api/v1/profiles/:id/start', '啟動，回傳 wsEndpoint'], ['POST', '/api/v1/profiles/:id/stop', '關閉']];
export default function ApiPage({
  settings,
  refresh
}) {
  const toast = useToast();
  const [port, setPort] = useState('');
  useEffect(() => {
    if (settings) setPort(String(settings.apiPort));
  }, [settings]);
  if (!settings) return null;
  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("已複製{0}", {
        0: label
      }), 'success');
    } catch {
      toast(t("複製失敗"), 'error');
    }
  };
  const savePort = async () => {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) return toast(t("埠號需介於 1024–65535"), 'error');
    const res = await window.api.updateSettings({
      apiPort: n
    });
    await refresh();
    res.apiError ? toast(t("API 無法啟動：{0}", {
      0: res.apiError
    }), 'error') : toast(t("API 已重新啟動"), 'success');
  };
  const base = `http://127.0.0.1:${settings.apiPort}`;
  const example = `const { chromium } = require('playwright');

const res = await fetch('${base}/api/v1/profiles/<id>/start', {
  method: 'POST',
  headers: { 'x-api-key': '${settings.apiKey}' },
}).then((r) => r.json());

const browser = await chromium.connectOverCDP(res.data.wsEndpoint);
const page = browser.contexts()[0].pages()[0];
await page.goto('https://example.com');`;
  return <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("API 與自動化")}</h1>
          <p className="page-sub">{t("透過本機 API 啟動環境，再用 Playwright / Puppeteer 連線操作")}</p>
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <div className="card-icon">
            <Icon name="key" size={18} />
          </div>
          <div>
            <h3>{t("連線資訊")}</h3>
            <p>{t("API 只監聽 127.0.0.1，每個請求都要帶")} <code>x-api-key</code> {t("標頭")}</p>
          </div>
          <span className={`pill ${settings.apiError ? 'red' : 'green'}`}>{settings.apiError ? t("異常") : t("運作中")}</span>
        </div>
        {settings.apiError && <div className="alert error">{t("API 啟動失敗：{0}", {
          0: settings.apiError
        })}</div>}
        <div className="form-grid">
          <Field label={t("埠號")}>
            <div className="input-row">
              <input className="mono" value={port} onChange={e => setPort(e.target.value)} />
              <button className="btn" disabled={port === String(settings.apiPort)} onClick={savePort}>{t("套用")}</button>
            </div>
          </Field>
          <Field label="API Key">
            <div className="input-row">
              <input className="mono" readOnly value={settings.apiKey} onFocus={e => e.target.select()} />
              <button className="btn" onClick={() => copy(settings.apiKey, ' API Key')}>
                <Icon name="copy" size={15} /> {t("複製")}</button>
            </div>
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-icon">
            <Icon name="code" size={18} />
          </div>
          <div>
            <h3>{t("端點")}</h3>
            <p>{t("回應格式：{0} 或 {1}", {
              0: '{ ok: true, data }',
              1: '{ ok: false, error }'
            })}</p>
          </div>
        </div>
        <div className="endpoint-list">
          {ENDPOINTS.map(([m, p, d]) => <div key={m + p} className="endpoint">
              <span className={`method ${m.toLowerCase()}`}>{m}</span>
              <code>{p}</code>
              <span className="muted">{t(d)}</span>
            </div>)}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-icon">
            <Icon name="play" size={16} />
          </div>
          <div>
            <h3>{t("Playwright 範例")}</h3>
            <p>{t("把 <id> 換成環境 ID（在編輯面板標題下方）")}</p>
          </div>
          <button className="btn sm" onClick={() => copy(example, t("範例程式碼"))}>
            <Icon name="copy" size={14} /> {t("複製")}</button>
        </div>
        <pre className="code">{example}</pre>
      </section>
    </div>;
}