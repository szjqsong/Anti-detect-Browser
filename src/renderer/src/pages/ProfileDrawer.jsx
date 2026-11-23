import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Field, OsBadge, PLATFORM_LABEL, Segmented, Switch } from '../components/ui.jsx';

const PLATFORM_VERSIONS = {
  windows: [['10.0.0', 'Windows 10'], ['15.0.0', 'Windows 11 23H2'], ['19.0.0', 'Windows 11 24H2']],
  macos: [['13.6.0', 'macOS 13 Ventura'], ['14.6.1', 'macOS 14 Sonoma'], ['15.2.0', 'macOS 15 Sequoia']],
  linux: [['', '預設']],
};
const LANGUAGES = ['en-US', 'en-GB', 'zh-TW', 'zh-CN', 'zh-HK', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU', 'it-IT', 'nl-NL'];
const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney'];
const SPOOFING = [
  ['canvas', 'Canvas', '每個環境的 Canvas 指紋不同，避免帳號被關聯。部分檢測站（如 Pixelscan）能察覺雜訊並判定為「偽裝」；關閉後可通過，但同一台電腦上所有環境的 Canvas 指紋會相同。'],
  ['gpu', 'WebGL / GPU', '隱藏真實顯示卡型號。建議保持開啟，關閉會暴露真實硬體（虛擬機會顯示 Paravirtual device）。'],
  ['audio', 'Audio', 'AudioContext 指紋雜訊。'],
  ['font', '字型', '字型列表與度量雜訊。'],
  ['clientrects', 'ClientRects', '元素尺寸量測雜訊。'],
];
const TABS = [['basic', '基本資訊'], ['proxy', '代理'], ['fingerprint', '指紋'], ['advanced', '進階']];

const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

export default function ProfileDrawer({ profile, groups, defaultGroup, hostPlatform, onClose, onSaved }) {
  const [tab, setTab] = useState('basic');
  const [form, setForm] = useState(null);
  const [proxyResult, setProxyResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const fingerprint = profile ? profile.fingerprint : await window.api.generateFingerprint();
      setForm({
        name: profile?.name || '',
        group: profile?.group ?? defaultGroup ?? '',
        notes: profile?.notes || '',
        proxy: profile?.proxy || '',
        startUrls: (profile?.startUrls || []).join('\n'),
        extraArgs: (profile?.extraArgs || []).join('\n'),
        fingerprint: { disableSpoofing: [], ...fingerprint },
      });
    })();
  }, [profile, defaultGroup]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!form) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFp = (k, v) => setForm((f) => ({ ...f, fingerprint: { ...f.fingerprint, [k]: v } }));
  const fp = form.fingerprint;
  const mismatch = hostPlatform && fp.platform !== hostPlatform;

  const changePlatform = (platform) =>
    setForm((f) => ({ ...f, fingerprint: { ...f.fingerprint, platform, platformVersion: PLATFORM_VERSIONS[platform][0][0] } }));

  const regenerate = async () => {
    const next = await window.api.generateFingerprint(fp.platform);
    setForm((f) => ({ ...f, fingerprint: { ...next, language: fp.language, timezone: fp.timezone, disableSpoofing: fp.disableSpoofing } }));
  };

  const testProxy = async () => {
    setChecking(true);
    setProxyResult(null);
    try {
      setProxyResult({ ok: true, ...(await window.api.checkProxy(form.proxy)) });
    } catch (e) {
      setProxyResult({ ok: false, error: e.message });
    } finally {
      setChecking(false);
    }
  };

  const spoofOn = (k) => !(fp.disableSpoofing || []).includes(k);
  const setSpoof = (k, on) => {
    const cur = new Set(fp.disableSpoofing || []);
    on ? cur.delete(k) : cur.add(k);
    setFp('disableSpoofing', [...cur]);
  };

  const save = async () => {
    setError('');
    const seed = Number(fp.seed);
    if (!Number.isInteger(seed) || seed <= 0 || seed > 2147483647) {
      setTab('fingerprint');
      return setError('種子必須是 1 到 2147483647 之間的整數');
    }
    const payload = {
      name: form.name.trim(),
      group: form.group.trim(),
      notes: form.notes.trim(),
      proxy: form.proxy.trim(),
      startUrls: lines(form.startUrls),
      extraArgs: lines(form.extraArgs),
      fingerprint: { ...fp, seed, hardwareConcurrency: Number(fp.hardwareConcurrency) },
    };
    setSaving(true);
    try {
      if (profile) await window.api.updateProfile(profile.id, payload);
      else await window.api.createProfile(payload);
      onSaved(profile ? '已儲存變更' : '已建立環境');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const versionLabel = (PLATFORM_VERSIONS[fp.platform].find(([v]) => v === fp.platformVersion) || [, '預設'])[1];

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <h2>{profile ? '編輯環境' : '新建環境'}</h2>
            {profile && <div className="sub mono">{profile.id}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="tabs">
          {TABS.map(([k, l]) => (
            <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              {l}
              {k === 'fingerprint' && mismatch && <span className="tab-dot" />}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          <div className="drawer-main">
            {tab === 'basic' && (
              <div className="form-grid">
                <Field label="環境名稱" span={2}>
                  <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="留空自動命名" />
                </Field>
                <Field label="分組">
                  <input list="group-list" value={form.group} onChange={(e) => set('group', e.target.value)} placeholder="選擇或輸入新分組" />
                  <datalist id="group-list">
                    {groups.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </Field>
                <Field label="備註">
                  <input value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="帳號、用途…" />
                </Field>
                <Field label="啟動網址" hint="一行一個，開啟環境時自動載入" span={2}>
                  <textarea rows={3} value={form.startUrls} onChange={(e) => set('startUrls', e.target.value)} placeholder="https://www.example.com" />
                </Field>
              </div>
            )}

            {tab === 'proxy' && (
              <div className="form-grid">
                <Field label="代理地址" hint="留空為直連。支援 http / https / socks4 / socks5，可帶帳號密碼" span={2}>
                  <div className="input-row">
                    <input
                      className="mono"
                      value={form.proxy}
                      onChange={(e) => {
                        set('proxy', e.target.value);
                        setProxyResult(null);
                      }}
                      placeholder="socks5://user:pass@host:port 或 host:port:user:pass"
                    />
                    <button className="btn" onClick={testProxy} disabled={checking}>
                      {checking ? <span className="spinner dark" /> : <Icon name="shield" size={15} />}
                      {checking ? '檢測中' : '檢測代理'}
                    </button>
                  </div>
                </Field>
                {proxyResult && (
                  <div className={`result-card span-2 ${proxyResult.ok ? 'ok' : 'bad'}`}>
                    {proxyResult.ok ? (
                      <>
                        <div className="result-title">
                          <Icon name="check" size={16} /> 連線成功 · {proxyResult.latencyMs} ms
                        </div>
                        <div className="kv">
                          <span>出口 IP</span>
                          <b className="mono">{proxyResult.ip}</b>
                          <span>位置</span>
                          <b>
                            {proxyResult.country} {proxyResult.city}
                          </b>
                          <span>時區</span>
                          <b>{proxyResult.timezone}</b>
                          <span>建議語言</span>
                          <b>{proxyResult.language}</b>
                        </div>
                      </>
                    ) : (
                      <div className="result-title">
                        <Icon name="warning" size={16} /> 連線失敗：{proxyResult.error}
                      </div>
                    )}
                  </div>
                )}
                <div className="note span-2">
                  <Icon name="globe" size={15} />
                  指紋的時區與語言設為「自動」時，會在啟動時依代理出口 IP 自動對應。WebRTC 一律禁止非代理的 UDP 連線，避免洩漏真實 IP。
                </div>
              </div>
            )}

            {tab === 'fingerprint' && (
              <div className="form-grid">
                <Field label="作業系統" span={2}>
                  <Segmented value={fp.platform} onChange={changePlatform} options={[['windows', 'Windows'], ['macos', 'macOS'], ['linux', 'Linux']]} />
                </Field>
                {mismatch && (
                  <div className="alert warn span-2">
                    <Icon name="warning" size={16} />
                    <div>
                      <b>與主機系統不同（主機是 {PLATFORM_LABEL[hostPlatform]}）</b>
                      <div>
                        實測在 {PLATFORM_LABEL[hostPlatform]} 上偽裝成 {PLATFORM_LABEL[fp.platform]} 時，系統專有字型、螢幕解析度與像素比會露出破綻。建議使用與主機相同的系統。
                      </div>
                      <button className="link-btn" onClick={() => changePlatform(hostPlatform)}>
                        改用 {PLATFORM_LABEL[hostPlatform]}
                      </button>
                    </div>
                  </div>
                )}
                <Field label="系統版本">
                  <select value={fp.platformVersion} onChange={(e) => setFp('platformVersion', e.target.value)}>
                    {PLATFORM_VERSIONS[fp.platform].map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="CPU 核心數">
                  <select value={fp.hardwareConcurrency} onChange={(e) => setFp('hardwareConcurrency', e.target.value)}>
                    {[2, 4, 6, 8, 12, 16, 20, 24].map((n) => (
                      <option key={n} value={n}>{n} 核</option>
                    ))}
                  </select>
                </Field>
                <Field label="瀏覽器品牌">
                  <select value={fp.brand} onChange={(e) => setFp('brand', e.target.value)}>
                    {['Chrome', 'Edge', 'Opera', 'Vivaldi'].map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </Field>
                <Field label="品牌版本" hint="留空跟核心版本一致（建議）">
                  <input className="mono" value={fp.brandVersion} onChange={(e) => setFp('brandVersion', e.target.value)} placeholder="自動" />
                </Field>
                <Field label="語言">
                  <select value={fp.language} onChange={(e) => setFp('language', e.target.value)}>
                    <option value="auto">依 IP 自動</option>
                    {LANGUAGES.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="時區">
                  <select value={fp.timezone} onChange={(e) => setFp('timezone', e.target.value)}>
                    <option value="auto">依 IP 自動</option>
                    {!TIMEZONES.includes(fp.timezone) && fp.timezone !== 'auto' && fp.timezone && <option>{fp.timezone}</option>}
                    {TIMEZONES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="指紋種子" hint="Canvas、WebGL、Audio 等雜訊都由種子決定" span={2}>
                  <div className="input-row">
                    <input className="mono" value={fp.seed} onChange={(e) => setFp('seed', e.target.value)} />
                    <button className="btn" onClick={async () => setFp('seed', await window.api.randomSeed())}>
                      <Icon name="refresh" size={15} /> 換一個
                    </button>
                  </div>
                </Field>
              </div>
            )}

            {tab === 'advanced' && (
              <div className="form-grid">
                <div className="span-2">
                  <div className="section-title">指紋偽裝項目</div>
                  <div className="toggle-list">
                    {SPOOFING.map(([k, l, desc]) => (
                      <div key={k} className="toggle-row">
                        <div>
                          <div className="toggle-name">{l}</div>
                          <div className="toggle-desc">{desc}</div>
                        </div>
                        <Switch checked={spoofOn(k)} onChange={(v) => setSpoof(k, v)} />
                      </div>
                    ))}
                  </div>
                </div>
                <Field label="額外啟動參數" hint="一行一個，直接傳給核心" span={2}>
                  <textarea rows={3} className="mono" value={form.extraArgs} onChange={(e) => set('extraArgs', e.target.value)} placeholder="--window-size=1440,900" />
                </Field>
              </div>
            )}
          </div>

          <aside className="drawer-side">
            <div className="summary">
              <div className="summary-head">
                <OsBadge platform={fp.platform} />
                <div>
                  <div className="summary-title">指紋概覽</div>
                  <div className="sub">{PLATFORM_LABEL[fp.platform]} · {versionLabel}</div>
                </div>
              </div>
              <dl>
                <dt>瀏覽器</dt>
                <dd>{fp.brand} {fp.brandVersion || '（跟核心）'}</dd>
                <dt>CPU</dt>
                <dd>{fp.hardwareConcurrency} 核</dd>
                <dt>語言</dt>
                <dd>{fp.language === 'auto' ? '依 IP 自動' : fp.language}</dd>
                <dt>時區</dt>
                <dd>{fp.timezone === 'auto' ? '依 IP 自動' : fp.timezone}</dd>
                <dt>代理</dt>
                <dd className="mono ellipsis">{form.proxy ? form.proxy.replace(/:[^:@/]+@/, ':***@') : '直連'}</dd>
                <dt>種子</dt>
                <dd className="mono">{fp.seed}</dd>
                <dt>偽裝</dt>
                <dd>
                  {SPOOFING.length - (fp.disableSpoofing || []).length}/{SPOOFING.length} 項開啟
                </dd>
              </dl>
              <button className="btn block" onClick={regenerate}>
                <Icon name="refresh" size={15} /> 一鍵隨機指紋
              </button>
            </div>
          </aside>
        </div>

        <div className="drawer-foot">
          {error ? <span className="form-error">{error}</span> : <span />}
          <div className="foot-actions">
            <button className="btn" onClick={onClose}>取消</button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving && <span className="spinner" />}
              {profile ? '儲存' : '建立環境'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
