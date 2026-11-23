import { t } from '../i18n.js';
import React, { useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Dialog, Field, Menu, OsBadge, PLATFORM_LABEL, proxyParts, timeAgo, useConfirm, useToast } from '../components/ui.jsx';
import ProfileDrawer from './ProfileDrawer.jsx';
const NONE = '__none__';
export default function ProfilesPage({
  profiles,
  status,
  settings,
  refresh
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null); // null | 'new' | profile
  const [moving, setMoving] = useState(false);
  const groups = useMemo(() => {
    const m = new Map();
    for (const p of profiles) if (p.group) m.set(p.group, (m.get(p.group) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [profiles]);
  const ungrouped = profiles.filter(p => !p.group).length;

  // Audio noise has only ~6 variants on this kernel; flag duplicates and no-noise seeds.
  const audioCount = useMemo(() => {
    const m = new Map();
    for (const p of profiles) {
      const h = p.fingerprint?.probe?.audioHash;
      if (h) m.set(h, (m.get(h) || 0) + 1);
    }
    return m;
  }, [profiles]);
  const audioIssue = p => {
    const pr = p.fingerprint?.probe;
    if (!pr) return null;
    if (pr.audioNoNoise) return {
      bad: true,
      text: t("無 Audio 雜訊")
    };
    const n = audioCount.get(pr.audioHash) || 0;
    return n > 1 ? {
      bad: false,
      text: t("Audio 重複 ×{0}", {
        0: n
      })
    } : null;
  };
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter(p => {
      if (group === NONE && p.group) return false;
      if (group !== 'all' && group !== NONE && p.group !== group) return false;
      if (!q) return true;
      return `${p.name} ${p.group} ${p.notes} ${p.proxy}`.toLowerCase().includes(q);
    });
  }, [profiles, query, group]);
  const st = id => status[id] || {
    state: 'stopped'
  };
  const allChecked = rows.length > 0 && rows.every(p => selected.has(p.id));
  const toggle = id => setSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map(p => p.id)));
  const selectedIds = [...selected].filter(id => profiles.some(p => p.id === id));
  const run = async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) toast(okMsg, 'success');
    } catch (e) {
      toast(t(e.message), 'error');
    }
  };
  const start = p => run(() => window.api.startProfile(p.id));
  const stop = p => run(() => window.api.stopProfile(p.id));
  const batch = async action => {
    const ids = selectedIds;
    if (action === 'delete') {
      const ok = await confirm({
        title: t("刪除 {0} 個環境", {
          0: ids.length
        }),
        message: t("環境的 Cookie、快取與瀏覽紀錄會一併刪除，無法復原。"),
        confirmText: t("刪除"),
        danger: true
      });
      if (!ok) return;
    }
    const errors = [];
    for (const id of ids) {
      try {
        if (action === 'start' && st(id).state === 'stopped') await window.api.startProfile(id);
        if (action === 'stop' && st(id).state === 'running') await window.api.stopProfile(id);
        if (action === 'delete') await window.api.deleteProfile(id);
      } catch (e) {
        errors.push(t(e.message));
      }
    }
    if (action === 'delete') setSelected(new Set());
    await refresh();
    if (errors.length) toast(t("{0} 個失敗：{1}", {
      0: errors.length,
      1: errors[0]
    }), 'error');else toast({
      start: t("已開啟"),
      stop: t("已關閉"),
      delete: t("已刪除")
    }[action] + t(" {0} 個環境", {
      0: ids.length
    }), 'success');
  };
  const checkFingerprints = async () => {
    const ids = selectedIds;
    toast(t("正在檢測 {0} 個環境…", {
      0: ids.length
    }));
    let failed = 0;
    for (const id of ids) {
      const p = profiles.find(x => x.id === id);
      try {
        const probe = await window.api.probeFingerprint(p.fingerprint, id);
        await window.api.updateProfile(id, {
          fingerprint: {
            probe
          }
        });
      } catch {
        failed += 1;
      }
    }
    await refresh();
    failed ? toast(t("{0} 個環境檢測失敗", {
      0: failed
    }), 'error') : toast(t("已檢測 {0} 個環境", {
      0: ids.length
    }), 'success');
  };
  const fixAudio = async () => {
    const targets = selectedIds.map(id => profiles.find(x => x.id === id)).filter(p => audioIssue(p));
    if (!targets.length) return toast(t("選取的環境沒有 Audio 問題（未檢測的請先「指紋體檢」）"));
    const ok = await confirm({
      title: t("為 {0} 個環境更換種子", {
        0: targets.length
      }),
      message: t("更換種子會讓 Canvas、WebGL、GPU、Audio 等指紋全部改變。已經登入帳號的環境，指紋突然改變可能觸發風控，建議只用在新環境或尚未登入的環境。"),
      confirmText: t("更換"),
      danger: true
    });
    if (!ok) return;
    let fixed = 0;
    for (const p of targets) {
      if (st(p.id).state !== 'stopped') continue;
      try {
        const {
          seed,
          probe
        } = await window.api.smartSeed(p.fingerprint, p.id);
        await window.api.updateProfile(p.id, {
          fingerprint: {
            seed,
            probe
          }
        });
        fixed += 1;
      } catch (e) {
        toast(t(e.message), 'error');
      }
    }
    await refresh();
    toast(t("已為 {0} 個環境更換種子", {
      0: fixed
    }), 'success');
  };
  const clone = p => run(async () => {
    const {
      id,
      createdAt,
      updatedAt,
      lastOpenedAt,
      ...rest
    } = p;
    // Omitting the seed lets the main process pick an audio-checked one.
    const {
      seed: _old,
      probe: _probe,
      ...fpRest
    } = p.fingerprint;
    await window.api.createProfile({
      ...rest,
      name: t("{0} 副本", {
        0: p.name
      }),
      fingerprint: fpRest
    });
    await refresh();
  }, t("已複製環境（使用新的指紋種子）"));
  const remove = async p => {
    const ok = await confirm({
      title: t("刪除「{0}」", {
        0: p.name
      }),
      message: t("這個環境的 Cookie、快取與瀏覽紀錄會一併刪除，無法復原。"),
      confirmText: t("刪除"),
      danger: true
    });
    if (!ok) return;
    await run(async () => {
      await window.api.deleteProfile(p.id);
      selected.delete(p.id);
      await refresh();
    }, t("已刪除"));
  };
  const noKernel = settings && !settings.kernelPath && !settings.bundledKernel;
  return <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("環境管理")}</h1>
          <p className="page-sub">{t("每個環境擁有獨立的指紋、代理與 Cookie")}</p>
        </div>
        <div className="head-actions">
          <div className="search">
            <Icon name="search" size={15} />
            <input placeholder={t("搜尋名稱、備註、代理")} value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> {t("新建環境")}</button>
        </div>
      </header>

      {noKernel && <div className="alert warn">
          <Icon name="warning" size={16} /> {t("找不到瀏覽器核心，請到「系統設定」選擇 fingerprint-chromium。")}</div>}

      <div className="toolbar">
        <div className="chips">
          <button className={`chip ${group === 'all' ? 'active' : ''}`} onClick={() => setGroup('all')}>{t("全部")} <span>{profiles.length}</span>
          </button>
          {groups.map(([g, n]) => <button key={g} className={`chip ${group === g ? 'active' : ''}`} onClick={() => setGroup(g)}>
              {g} <span>{n}</span>
            </button>)}
          {ungrouped > 0 && groups.length > 0 && <button className={`chip ${group === NONE ? 'active' : ''}`} onClick={() => setGroup(NONE)}>{t("未分組")} <span>{ungrouped}</span>
            </button>}
        </div>
        <button className="icon-btn" title={t("重新整理")} onClick={refresh}>
          <Icon name="refresh" />
        </button>
      </div>

      {selectedIds.length > 0 && <div className="batch-bar">
          <span className="batch-count">{t("已選 {0} 個", {
          0: selectedIds.length
        })}</span>
          <button className="btn sm" onClick={() => batch('start')}>
            <Icon name="play" size={12} /> {t("批次開啟")}</button>
          <button className="btn sm" onClick={() => batch('stop')}>
            <Icon name="stop" size={12} /> {t("批次關閉")}</button>
          <button className="btn sm" onClick={() => setMoving(true)}>
            <Icon name="move" size={14} /> {t("移動分組")}</button>
          <button className="btn sm" onClick={checkFingerprints}>
            <Icon name="cpu" size={14} /> {t("指紋體檢")}</button>
          <button className="btn sm" onClick={fixAudio}>
            <Icon name="refresh" size={14} /> {t("修復 Audio")}</button>
          <button className="btn sm danger" onClick={() => batch('delete')}>
            <Icon name="trash" size={14} /> {t("刪除")}</button>
          <button className="link-btn" onClick={() => setSelected(new Set())}>{t("取消選取")}</button>
        </div>}

      <div className="table-card">
        {rows.length === 0 ? <div className="empty">
            <div className="empty-icon">
              <Icon name="profiles" size={28} />
            </div>
            <h3>{profiles.length === 0 ? t("還沒有任何環境") : t("沒有符合條件的環境")}</h3>
            <p>{profiles.length === 0 ? t("建立第一個環境，系統會自動產生一組完整的指紋。") : t("換個關鍵字或分組試試。")}</p>
            {profiles.length === 0 && <button className="btn primary" onClick={() => setEditing('new')}>
                <Icon name="plus" size={16} /> {t("新建環境")}</button>}
          </div> : <table className="table">
            <thead>
              <tr>
                <th className="col-check">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </th>
                <th className="col-idx">#</th>
                <th>{t("環境")}</th>
                <th>{t("分組")}</th>
                <th>{t("代理 / 出口")}</th>
                <th>{t("指紋")}</th>
                <th>{t("最後開啟")}</th>
                <th className="col-actions">{t("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
            const s = st(p.id);
            const px = proxyParts(p.proxy);
            const fp = p.fingerprint || {};
            return <tr key={p.id} className={selected.has(p.id) ? 'selected' : ''}>
                    <td className="col-check">
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    </td>
                    <td className="col-idx muted">{i + 1}</td>
                    <td>
                      <div className="cell-name">
                        <span className={`status-dot ${s.state}`} title={s.state} />
                        <div>
                          <div className="name">{p.name}</div>
                          {p.notes && <div className="sub">{p.notes}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{p.group ? <span className="tag">{p.group}</span> : <span className="muted">—</span>}</td>
                    <td>
                      {px ? <div>
                          <span className="tag mono">{px.scheme}</span>{' '}
                          <span className="mono">
                            {px.host}:{px.port}
                          </span>
                        </div> : <span className="muted">{t("直連")}</span>}
                      {s.geo && <div className="sub">
                          <Icon name="globe" size={12} /> {s.geo.ip} · {s.geo.countryCode} · {s.geo.timezone}
                        </div>}
                    </td>
                    <td>
                      <div className="fp-cell">
                        <OsBadge platform={fp.platform} />
                        <div>
                          <div>
                            {PLATFORM_LABEL[fp.platform]} · {fp.brand}
                          </div>
                          <div className="sub mono">
                            #{fp.seed}
                            {audioIssue(p) && <span className={`audio-flag ${audioIssue(p).bad ? 'bad' : ''}`} title={t("點「指紋體檢 / 修復 Audio」處理")}>
                                <Icon name="warning" size={11} /> {audioIssue(p).text}
                              </span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{timeAgo(p.lastOpenedAt)}</td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {s.state === 'running' ? <button className="btn sm stop-btn" onClick={() => stop(p)}>
                            <Icon name="stop" size={11} /> {t("關閉")}</button> : <button className="btn sm primary" disabled={s.state === 'starting'} onClick={() => start(p)}>
                            {s.state === 'starting' ? <span className="spinner" /> : <Icon name="play" size={11} />}
                            {s.state === 'starting' ? t("啟動中") : t("開啟")}
                          </button>}
                        <button className="icon-btn" title={t("編輯")} disabled={s.state !== 'stopped'} onClick={() => setEditing(p)}>
                          <Icon name="edit" />
                        </button>
                        <Menu items={[{
                    label: t("複製環境"),
                    icon: 'copy',
                    onClick: () => clone(p)
                  }, {
                    label: t("刪除"),
                    icon: 'trash',
                    danger: true,
                    onClick: () => remove(p)
                  }]} />
                      </div>
                    </td>
                  </tr>;
          })}
            </tbody>
          </table>}
      </div>

      {editing && <ProfileDrawer profile={editing === 'new' ? null : editing} groups={groups.map(([g]) => g)} defaultGroup={group !== 'all' && group !== NONE ? group : ''} hostPlatform={settings?.hostPlatform} onClose={() => setEditing(null)} onSaved={async msg => {
      setEditing(null);
      await refresh();
      toast(msg, 'success');
    }} />}

      {moving && <MoveDialog count={selectedIds.length} groups={groups.map(([g]) => g)} onClose={() => setMoving(false)} onMove={async target => {
      setMoving(false);
      await run(async () => {
        for (const id of selectedIds) await window.api.updateProfile(id, {
          group: target
        });
        await refresh();
      }, t("已移動 {0} 個環境", {
        0: selectedIds.length
      }));
    }} />}
    </div>;
}
function MoveDialog({
  count,
  groups,
  onClose,
  onMove
}) {
  const [value, setValue] = useState(groups[0] || '');
  const [custom, setCustom] = useState(groups.length === 0);
  return <Dialog title={t("移動 {0} 個環境到分組", {
    0: count
  })} onClose={onClose} footer={<>
          <button className="btn" onClick={onClose}>{t("取消")}</button>
          <button className="btn primary" onClick={() => onMove(value.trim())}>{t("移動")}</button>
        </>}>
      {!custom ? <Field label={t("目標分組")}>
          <select value={value} onChange={e => e.target.value === '__new' ? (setCustom(true), setValue('')) : setValue(e.target.value)}>
            {groups.map(g => <option key={g}>{g}</option>)}
            <option value="">{t("（未分組）")}</option>
            <option value="__new">{t("＋ 新分組…")}</option>
          </select>
        </Field> : <Field label={t("新分組名稱")}>
          <input autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder={t("例如：美國站")} />
        </Field>}
    </Dialog>;
}