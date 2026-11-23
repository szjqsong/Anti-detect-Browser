import { t } from '../i18n.js';
import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Field, OsBadge, PLATFORM_LABEL, Segmented, Switch } from '../components/ui.jsx';
const PLATFORM_VERSIONS = {
  windows: [['10.0.0', 'Windows 10'], ['15.0.0', 'Windows 11 23H2'], ['19.0.0', 'Windows 11 24H2']],
  macos: [['13.6.0', 'macOS 13 Ventura'], ['14.6.1', 'macOS 14 Sonoma'], ['15.2.0', 'macOS 15 Sequoia']],
  linux: [['', '預設']]
};
const LANGUAGES = ['en-US', 'en-GB', 'zh-TW', 'zh-CN', 'zh-HK', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU', 'it-IT', 'nl-NL'];
const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney'];
const SPOOFING = [['canvas', 'Canvas', '每個環境的 Canvas 指紋不同，避免帳號被關聯。實測開啟後 Cloudflare Turnstile 與 Pixelscan 會判定異常，因此新環境預設關閉；關閉時，同一台電腦上所有環境的 Canvas 指紋相同。'], ['gpu', 'WebGL / GPU', '隱藏真實顯示卡型號。建議保持開啟，關閉會暴露真實硬體（虛擬機會顯示 Paravirtual device）。'], ['audio', 'Audio', 'AudioContext 指紋雜訊。'], ['font', '字型', '字型列表與度量雜訊。'], ['clientrects', 'ClientRects', '元素尺寸量測雜訊。']];
const TABS = [['basic', '基本資訊'], ['proxy', '代理'], ['fingerprint', '指紋'], ['device', '裝置與硬體'], ['advanced', '進階']];
const SCREEN_PRESETS = {
  windows: [[1920, 1080, 1], [1536, 864, 1.25], [1366, 768, 1], [2560, 1440, 1], [1440, 900, 1], [1280, 720, 1.5]],
  macos: [[1440, 900, 2], [1512, 982, 2], [1728, 1117, 2], [1470, 956, 2], [1920, 1080, 1], [2560, 1440, 1]],
  linux: [[1920, 1080, 1], [1366, 768, 1], [2560, 1440, 1], [1600, 900, 1]]
};
const GEO_DEFAULT = {
  permission: 'ask',
  source: 'auto',
  latitude: null,
  longitude: null,
  accuracy: 50
};

// Same field order as probeSignature() in src/main/seeds.js (minus the kernel id).
const probeKey = fp => [fp.seed, fp.platform, fp.platformVersion, fp.brand, fp.brandVersion, fp.hardwareConcurrency, (fp.disableSpoofing || []).slice().sort().join('+')].join('|');
const probeFresh = fp => !!fp.probe?.signature && fp.probe.signature.split('|').slice(1).join('|') === probeKey(fp);
const lines = s => s.split('\n').map(l => l.trim()).filter(Boolean);
export default function ProfileDrawer({
  profile,
  groups,
  defaultGroup,
  hostPlatform,
  onClose,
  onSaved
}) {
  const [tab, setTab] = useState('basic');
  const [form, setForm] = useState(null);
  const [proxyResult, setProxyResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(''); // '' | 'seed' | 'probe'

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
        fingerprint: {
          disableSpoofing: [],
          screen: {
            mode: 'real'
          },
          ...fingerprint,
          geolocation: {
            ...GEO_DEFAULT,
            ...(fingerprint.geolocation || {})
          }
        }
      });
      // New profile: replace the plain random seed with an audio-checked one.
      if (!profile) {
        setBusy('seed');
        try {
          const {
            seed,
            probe
          } = await window.api.smartSeed(fingerprint);
          setForm(f => f && {
            ...f,
            fingerprint: {
              ...f.fingerprint,
              seed,
              probe
            }
          });
        } catch {
          // Non-fingerprint kernel: keep the random seed.
        } finally {
          setBusy('');
        }
      }
    })();
  }, [profile, defaultGroup]);
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!form) return null;
  const set = (k, v) => setForm(f => ({
    ...f,
    [k]: v
  }));
  const setFp = (k, v) => setForm(f => ({
    ...f,
    fingerprint: {
      ...f.fingerprint,
      [k]: v
    }
  }));
  const fp = form.fingerprint;
  const mismatch = hostPlatform && fp.platform !== hostPlatform;
  const changePlatform = platform => setForm(f => {
    const [width, height, dpr] = SCREEN_PRESETS[platform][0];
    // Real screen only makes sense on the host OS; other OSes get a matching preset.
    const screen = platform === hostPlatform ? {
      mode: 'real'
    } : {
      mode: 'custom',
      width,
      height,
      dpr
    };
    return {
      ...f,
      fingerprint: {
        ...f.fingerprint,
        platform,
        platformVersion: PLATFORM_VERSIONS[platform][0][0],
        screen
      }
    };
  });

  // Seed picked by the main process: adds audio noise and avoids audio buckets that
  // other profiles already use (fingerprint-chromium has only ~6 audio variants).
  const pickSeed = async base => {
    setBusy('seed');
    setError('');
    try {
      const {
        seed,
        probe
      } = await window.api.smartSeed(base, profile?.id);
      setForm(f => ({
        ...f,
        fingerprint: {
          ...base,
          seed,
          probe
        }
      }));
    } catch (e) {
      // Non-fingerprint kernel: plain random seed.
      setForm(f => ({
        ...f,
        fingerprint: {
          ...base,
          seed: Math.floor(Math.random() * 2147483646) + 1,
          probe: null
        }
      }));
      setError(t(e.message));
    } finally {
      setBusy('');
    }
  };
  const runProbe = async (target = fp) => {
    setBusy('probe');
    try {
      const probe = await window.api.probeFingerprint(target, profile?.id);
      setForm(f => ({
        ...f,
        fingerprint: {
          ...f.fingerprint,
          probe
        }
      }));
      return probe;
    } catch (e) {
      setError(t(e.message));
      return null;
    } finally {
      setBusy('');
    }
  };
  const regenerate = async () => {
    const next = await window.api.generateFingerprint(fp.platform);
    await pickSeed({
      ...next,
      language: fp.language,
      timezone: fp.timezone,
      disableSpoofing: fp.disableSpoofing,
      geolocation: fp.geolocation
    });
  };
  const setScreen = patch => setFp('screen', {
    ...fp.screen,
    ...patch
  });
  const setGeo = patch => setFp('geolocation', {
    ...fp.geolocation,
    ...patch
  });
  const fresh = probeFresh(fp);
  const pr = fresh ? fp.probe : null;
  const testProxy = async () => {
    setChecking(true);
    setProxyResult(null);
    try {
      setProxyResult({
        ok: true,
        ...(await window.api.checkProxy(form.proxy))
      });
    } catch (e) {
      setProxyResult({
        ok: false,
        error: t(e.message)
      });
    } finally {
      setChecking(false);
    }
  };
  const spoofOn = k => !(fp.disableSpoofing || []).includes(k);
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
      return setError(t("種子必須是 1 到 2147483647 之間的整數"));
    }
    const payload = {
      name: form.name.trim(),
      group: form.group.trim(),
      notes: form.notes.trim(),
      proxy: form.proxy.trim(),
      startUrls: lines(form.startUrls),
      extraArgs: lines(form.extraArgs),
      fingerprint: {
        ...fp,
        seed,
        hardwareConcurrency: Number(fp.hardwareConcurrency),
        screen: fp.screen.mode === 'custom' ? {
          mode: 'custom',
          width: Number(fp.screen.width),
          height: Number(fp.screen.height),
          dpr: Number(fp.screen.dpr)
        } : {
          mode: 'real'
        },
        geolocation: {
          ...fp.geolocation,
          latitude: fp.geolocation.latitude === null || fp.geolocation.latitude === '' ? null : Number(fp.geolocation.latitude),
          longitude: fp.geolocation.longitude === null || fp.geolocation.longitude === '' ? null : Number(fp.geolocation.longitude),
          accuracy: Number(fp.geolocation.accuracy) || 50
        }
      }
    };
    if (payload.fingerprint.screen.mode === 'custom') {
      const {
        width,
        height,
        dpr
      } = payload.fingerprint.screen;
      if (!(width >= 320 && height >= 240 && dpr > 0)) {
        setTab('device');
        return setError(t("自訂螢幕的寬、高、像素比不正確"));
      }
    }
    setSaving(true);
    try {
      // Keep the stored kernel-derived values in sync with what will actually launch.
      if (!probeFresh(payload.fingerprint)) {
        try {
          payload.fingerprint.probe = await window.api.probeFingerprint(payload.fingerprint, profile?.id);
        } catch {
          payload.fingerprint.probe = null;
        }
      }
      if (profile) await window.api.updateProfile(profile.id, payload);else await window.api.createProfile(payload);
      onSaved(profile ? t("已儲存變更") : t("已建立環境"));
    } catch (e) {
      setError(t(e.message));
    } finally {
      setSaving(false);
    }
  };
  const versionLabel = t((PLATFORM_VERSIONS[fp.platform].find(([v]) => v === fp.platformVersion) || [, '預設'])[1]);
  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <h2>{profile ? t("編輯環境") : t("新建環境")}</h2>
            {profile && <div className="sub mono">{profile.id}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t("關閉")}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="tabs">
          {TABS.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              {t(l)}
              {k === 'fingerprint' && mismatch && <span className="tab-dot" />}
              {k === 'device' && pr && (pr.audioNoNoise || pr.audioSharedWith > 0) && <span className="tab-dot" />}
            </button>)}
        </div>

        <div className="drawer-body">
          <div className="drawer-main">
            {tab === 'basic' && <div className="form-grid">
                <Field label={t("環境名稱")} span={2}>
                  <input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder={t("留空自動命名")} />
                </Field>
                <Field label={t("分組")}>
                  <input list="group-list" value={form.group} onChange={e => set('group', e.target.value)} placeholder={t("選擇或輸入新分組")} />
                  <datalist id="group-list">
                    {groups.map(g => <option key={g} value={g} />)}
                  </datalist>
                </Field>
                <Field label={t("備註")}>
                  <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder={t("帳號、用途…")} />
                </Field>
                <Field label={t("啟動網址")} hint={t("一行一個，開啟環境時自動載入")} span={2}>
                  <textarea rows={3} value={form.startUrls} onChange={e => set('startUrls', e.target.value)} placeholder="https://www.example.com" />
                </Field>
              </div>}

            {tab === 'proxy' && <div className="form-grid">
                <Field label={t("代理地址")} hint={t("留空為直連。支援 http / https / socks4 / socks5，可帶帳號密碼")} span={2}>
                  <div className="input-row">
                    <input className="mono" value={form.proxy} onChange={e => {
                  set('proxy', e.target.value);
                  setProxyResult(null);
                }} placeholder={t("socks5://user:pass@host:port 或 host:port:user:pass")} />
                    <button className="btn" onClick={testProxy} disabled={checking}>
                      {checking ? <span className="spinner dark" /> : <Icon name="shield" size={15} />}
                      {checking ? t("檢測中") : t("檢測代理")}
                    </button>
                  </div>
                </Field>
                {proxyResult && <div className={`result-card span-2 ${proxyResult.ok ? 'ok' : 'bad'}`}>
                    {proxyResult.ok ? <>
                        <div className="result-title">
                          <Icon name="check" size={16} /> {t("連線成功 · {0} ms", {
                    0: proxyResult.latencyMs
                  })}</div>
                        <div className="kv">
                          <span>{t("出口 IP")}</span>
                          <b className="mono">{proxyResult.ip}</b>
                          <span>{t("位置")}</span>
                          <b>
                            {proxyResult.country} {proxyResult.city}
                          </b>
                          <span>{t("時區")}</span>
                          <b>{proxyResult.timezone}</b>
                          <span>{t("建議語言")}</span>
                          <b>{proxyResult.language}</b>
                        </div>
                      </> : <div className="result-title">
                        <Icon name="warning" size={16} /> {t("連線失敗：{0}", {
                  0: proxyResult.error
                })}</div>}
                  </div>}
                <div className="note span-2">
                  <Icon name="globe" size={15} /> {t("指紋的時區與語言設為「自動」時，會在啟動時依代理出口 IP 自動對應。WebRTC 一律禁止非代理的 UDP 連線，避免洩漏真實 IP。")}</div>
              </div>}

            {tab === 'fingerprint' && <div className="form-grid">
                <Field label={t("作業系統")} span={2}>
                  <Segmented value={fp.platform} onChange={changePlatform} options={[['windows', 'Windows'], ['macos', 'macOS'], ['linux', 'Linux']]} />
                </Field>
                {mismatch && <div className="alert warn span-2">
                    <Icon name="warning" size={16} />
                    <div>
                      <b>{t("與主機系統不同（主機是 {0}）", {
                    0: PLATFORM_LABEL[hostPlatform]
                  })}</b>
                      <div>{t("實測在 {0} 上偽裝成 {1} 時，系統專有字型、螢幕解析度與像素比會露出破綻。建議使用與主機相同的系統。", {
                    0: PLATFORM_LABEL[hostPlatform],
                    1: PLATFORM_LABEL[fp.platform]
                  })}</div>
                      <button className="link-btn" onClick={() => changePlatform(hostPlatform)}>{t("改用 {0}", {
                    0: PLATFORM_LABEL[hostPlatform]
                  })}</button>
                    </div>
                  </div>}
                <Field label={t("系統版本")}>
                  <select value={fp.platformVersion} onChange={e => setFp('platformVersion', e.target.value)}>
                    {PLATFORM_VERSIONS[fp.platform].map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                  </select>
                </Field>
                <Field label={t("CPU 核心數")}>
                  <select value={fp.hardwareConcurrency} onChange={e => setFp('hardwareConcurrency', e.target.value)}>
                    {[2, 4, 6, 8, 12, 16, 20, 24].map(n => <option key={n} value={n}>{t("{0} 核", {
                    0: n
                  })}</option>)}
                  </select>
                </Field>
                <Field label={t("瀏覽器品牌")}>
                  <select value={fp.brand} onChange={e => setFp('brand', e.target.value)}>
                    {['Chrome', 'Edge', 'Opera', 'Vivaldi'].map(b => <option key={b}>{b}</option>)}
                  </select>
                </Field>
                <Field label={t("品牌版本")} hint={t("留空跟核心版本一致（建議）")}>
                  <input className="mono" value={fp.brandVersion} onChange={e => setFp('brandVersion', e.target.value)} placeholder={t("自動")} />
                </Field>
                <Field label={t("語言")}>
                  <select value={fp.language} onChange={e => setFp('language', e.target.value)}>
                    <option value="auto">{t("依 IP 自動")}</option>
                    {LANGUAGES.map(l => <option key={l}>{l}</option>)}
                  </select>
                </Field>
                <Field label={t("時區")}>
                  <select value={fp.timezone} onChange={e => setFp('timezone', e.target.value)}>
                    <option value="auto">{t("依 IP 自動")}</option>
                    {!TIMEZONES.includes(fp.timezone) && fp.timezone !== 'auto' && fp.timezone && <option>{fp.timezone}</option>}
                    {TIMEZONES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label={t("指紋種子")} hint={t("Canvas、WebGL、GPU、記憶體、Audio 都由種子決定。「換一個」會自動避開沒有 Audio 雜訊、或與其他環境 Audio 相同的種子")} span={2}>
                  <div className="input-row">
                    <input className="mono" value={fp.seed} onChange={e => setFp('seed', e.target.value)} />
                    <button className="btn" disabled={!!busy} onClick={() => pickSeed(fp)}>
                      {busy === 'seed' ? <span className="spinner dark" /> : <Icon name="refresh" size={15} />} {t("換一個")}</button>
                  </div>
                </Field>
              </div>}

            {tab === 'device' && <div className="form-grid">
                <div className="span-2 section">
                  <div className="section-title">{t("螢幕")}</div>
                  <Segmented value={fp.screen.mode} onChange={mode => setFp('screen', mode === 'real' ? {
                mode: 'real'
              } : (() => {
                const [width, height, dpr] = SCREEN_PRESETS[fp.platform][0];
                return {
                  mode: 'custom',
                  width,
                  height,
                  dpr
                };
              })())} options={[['real', t("真實螢幕")], ['custom', t("自訂")]]} />
                  {fp.screen.mode === 'custom' ? <>
                      <div className="form-grid tight">
                        <Field label={t("常見解析度")} span={2}>
                          <select value={`${fp.screen.width}x${fp.screen.height}@${fp.screen.dpr}`} onChange={e => {
                      const [wh, dpr] = e.target.value.split('@');
                      const [width, height] = wh.split('x').map(Number);
                      if (width) setScreen({
                        width,
                        height,
                        dpr: Number(dpr)
                      });
                    }}>
                            {!SCREEN_PRESETS[fp.platform].some(([w, h, d]) => w === Number(fp.screen.width) && h === Number(fp.screen.height) && d === Number(fp.screen.dpr)) && <option value={`${fp.screen.width}x${fp.screen.height}@${fp.screen.dpr}`}>{t("自訂")}</option>}
                            {SCREEN_PRESETS[fp.platform].map(([w, h, d]) => <option key={`${w}x${h}@${d}`} value={`${w}x${h}@${d}`}>
                                {w} × {h}{d !== 1 ? t("（縮放 {0}%）", {
                          0: d * 100
                        }) : ''}
                              </option>)}
                          </select>
                        </Field>
                        <Field label={t("寬度")}>
                          <input className="mono" value={fp.screen.width} onChange={e => setScreen({
                      width: e.target.value
                    })} />
                        </Field>
                        <Field label={t("高度")}>
                          <input className="mono" value={fp.screen.height} onChange={e => setScreen({
                      height: e.target.value
                    })} />
                        </Field>
                        <Field label={t("像素比 (devicePixelRatio)")}>
                          <select value={fp.screen.dpr} onChange={e => setScreen({
                      dpr: Number(e.target.value)
                    })}>
                            {[1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </Field>
                      </div>
                      <div className="alert warn">
                        <Icon name="warning" size={16} />
                        <div>
                          <b>{t("自訂螢幕的限制")}</b>
                          <div>{t("螢幕覆寫只作用在主頁面與同站 iframe；跨站 iframe（例如嵌入的廣告或第三方登入框）仍會讀到真實螢幕。為了通過 Cloudflare 等人機驗證，不會關閉 Site Isolation（實測關閉後 Turnstile 會失敗）。")}</div>
                        </div>
                      </div>
                    </> : <div className="field-hint">{t("使用電腦的真實螢幕解析度與像素比，不做任何覆寫。")}</div>}
                </div>

                <div className="span-2 section">
                  <div className="section-title">{t("地理位置")}</div>
                  <div className="form-grid tight">
                    <Field label={t("網站要求定位時")}>
                      <Segmented value={fp.geolocation.permission} onChange={permission => setGeo({
                    permission
                  })} options={[['ask', t("詢問")], ['allow', t("允許")], ['block', t("禁止")]]} />
                    </Field>
                    {fp.geolocation.permission !== 'block' && <Field label={t("回報的座標")}>
                        <Segmented value={fp.geolocation.source} onChange={source => setGeo({
                    source
                  })} options={[['auto', t("依代理 IP")], ['custom', t("自訂")]]} />
                      </Field>}
                    {fp.geolocation.permission !== 'block' && fp.geolocation.source === 'custom' && <>
                        <Field label={t("緯度")}>
                          <input className="mono" value={fp.geolocation.latitude ?? ''} onChange={e => setGeo({
                      latitude: e.target.value
                    })} placeholder="40.7128" />
                        </Field>
                        <Field label={t("經度")}>
                          <input className="mono" value={fp.geolocation.longitude ?? ''} onChange={e => setGeo({
                      longitude: e.target.value
                    })} placeholder="-74.0060" />
                        </Field>
                        <Field label={t("精確度（公尺）")}>
                          <input className="mono" value={fp.geolocation.accuracy} onChange={e => setGeo({
                      accuracy: e.target.value
                    })} />
                        </Field>
                      </>}
                  </div>
                  <div className="field-hint">
                    {fp.geolocation.permission === 'block' ? t("所有網站的定位請求都會被拒絕。") : t("一律回報上面設定的座標，不會使用電腦的真實位置。依代理 IP 時，座標在啟動時由出口 IP 查得。")}
                  </div>
                </div>

                <div className="span-2 section">
                  <div className="section-title-row">
                    <div className="section-title">{t("由種子決定的硬體")}</div>
                    <button className="btn sm" disabled={!!busy} onClick={() => runProbe()}>
                      {busy === 'probe' ? <span className="spinner dark" /> : <Icon name="cpu" size={14} />} {t("檢測")}</button>
                  </div>
                  <div className="probe-card">
                    {busy === 'probe' || busy === 'seed' ? <div className="muted">{t("正在啟動核心檢測…")}</div> : pr ? <>
                        <div className="kv">
                          <span>GPU</span>
                          <b className="mono small-text">{pr.gpuRenderer || '—'}</b>
                          <span>{t("GPU 廠商")}</span>
                          <b>{pr.gpuVendor || '—'}</b>
                          <span>{t("記憶體")}</span>
                          <b>{pr.deviceMemory ? `${pr.deviceMemory} GB` : '—'}</b>
                          <span>Audio</span>
                          <b>
                            {pr.audioNoNoise ? <span className="bad-text">{t("沒有雜訊（會暴露真實 Audio 指紋）")}</span> : pr.audioSharedWith > 0 ? <span className="warn-text">{t("與 {0} 個環境相同", {
                          0: pr.audioSharedWith
                        })}</span> : <span className="ok-text">{t("獨立")}</span>}
                            <span className="mono muted"> #{pr.audioHash?.slice(0, 8)}</span>
                          </b>
                        </div>
                        {(pr.audioNoNoise || pr.audioSharedWith > 0) && <button className="btn sm" style={{
                    marginTop: 10
                  }} disabled={!!busy} onClick={() => pickSeed(fp)}>
                            <Icon name="refresh" size={14} /> {t("換一個種子修正")}</button>}
                      </> : <div className="muted">{t("尚未檢測，或指紋設定已變更。按「檢測」查看這個種子會產生的 GPU、記憶體與 Audio。")}</div>}
                  </div>
                  <div className="field-hint">{t("148 版核心不支援直接指定 GPU 型號與記憶體，只能由種子決定；不滿意可以到「指紋」分頁換一個種子。核心的 Audio 雜訊只有約 6 種，環境數量超過 6 個時無法完全避免重複。")}</div>
                </div>

                <div className="note span-2">
                  <Icon name="monitor" size={15} /> {t("媒體裝置列表（麥克風、喇叭、攝影機）無法自訂：核心與 DevTools 協定都沒有提供這項能力，網站會看到電腦真實的裝置數量；在使用者授權前，網站讀不到裝置名稱。")}</div>
              </div>}

            {tab === 'advanced' && <div className="form-grid">
                <div className="span-2">
                  <div className="section-title">{t("指紋偽裝項目")}</div>
                  <div className="toggle-list">
                    {SPOOFING.map(([k, l, desc]) => <div key={k} className="toggle-row">
                        <div>
                          <div className="toggle-name">{t(l)}</div>
                          <div className="toggle-desc">{t(desc)}</div>
                        </div>
                        <Switch checked={spoofOn(k)} onChange={v => setSpoof(k, v)} />
                      </div>)}
                  </div>
                </div>
                <Field label={t("額外啟動參數")} hint={t("一行一個，直接傳給核心")} span={2}>
                  <textarea rows={3} className="mono" value={form.extraArgs} onChange={e => set('extraArgs', e.target.value)} placeholder="--window-size=1440,900" />
                </Field>
              </div>}
          </div>

          <aside className="drawer-side">
            <div className="summary">
              <div className="summary-head">
                <OsBadge platform={fp.platform} />
                <div>
                  <div className="summary-title">{t("指紋概覽")}</div>
                  <div className="sub">{PLATFORM_LABEL[fp.platform]} · {versionLabel}</div>
                </div>
              </div>
              <dl>
                <dt>{t("瀏覽器")}</dt>
                <dd>{fp.brand} {fp.brandVersion || t("（跟核心）")}</dd>
                <dt>CPU</dt>
                <dd>{t("{0} 核", {
                  0: fp.hardwareConcurrency
                })}</dd>
                <dt>{t("語言")}</dt>
                <dd>{fp.language === 'auto' ? t("依 IP 自動") : fp.language}</dd>
                <dt>{t("時區")}</dt>
                <dd>{fp.timezone === 'auto' ? t("依 IP 自動") : fp.timezone}</dd>
                <dt>{t("代理")}</dt>
                <dd className="mono ellipsis">{form.proxy ? form.proxy.replace(/:[^:@/]+@/, ':***@') : t("直連")}</dd>
                <dt>{t("種子")}</dt>
                <dd className="mono">{fp.seed}</dd>
                <dt>{t("螢幕")}</dt>
                <dd>{fp.screen.mode === 'custom' ? `${fp.screen.width}×${fp.screen.height} @${fp.screen.dpr}x` : t("真實螢幕")}</dd>
                <dt>{t("定位")}</dt>
                <dd>
                  {fp.geolocation.permission === 'block' ? t("禁止") : fp.geolocation.source === 'auto' ? t("依 IP") : t("自訂座標")}
                </dd>
                <dt>Audio</dt>
                <dd>
                  {!pr ? <span className="muted">{t("未檢測")}</span> : pr.audioNoNoise ? <span className="bad-text">{t("無雜訊")}</span> : pr.audioSharedWith > 0 ? <span className="warn-text">{t("重複 {0}", {
                    0: pr.audioSharedWith
                  })}</span> : <span className="ok-text">{t("獨立")}</span>}
                </dd>
                <dt>{t("偽裝")}</dt>
                <dd>{t("{0}/{1} 項開啟", {
                  0: SPOOFING.length - (fp.disableSpoofing || []).length,
                  1: SPOOFING.length
                })}</dd>
              </dl>
              <button className="btn block" disabled={!!busy} onClick={regenerate}>
                {busy === 'seed' ? <span className="spinner dark" /> : <Icon name="refresh" size={15} />} {t("一鍵隨機指紋")}</button>
            </div>
          </aside>
        </div>

        <div className="drawer-foot">
          {error ? <span className="form-error">{error}</span> : <span />}
          <div className="foot-actions">
            <button className="btn" onClick={onClose}>{t("取消")}</button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving && <span className="spinner" />}
              {profile ? t("儲存") : t("建立環境")}
            </button>
          </div>
        </div>
      </div>
    </div>;
}