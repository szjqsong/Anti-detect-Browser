import React, { useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Dialog, Field, Menu, OsBadge, PLATFORM_LABEL, proxyParts, timeAgo, useConfirm, useToast } from '../components/ui.jsx';
import ProfileDrawer from './ProfileDrawer.jsx';

const NONE = '__none__';

export default function ProfilesPage({ profiles, status, settings, refresh }) {
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
  const ungrouped = profiles.filter((p) => !p.group).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      if (group === NONE && p.group) return false;
      if (group !== 'all' && group !== NONE && p.group !== group) return false;
      if (!q) return true;
      return `${p.name} ${p.group} ${p.notes} ${p.proxy}`.toLowerCase().includes(q);
    });
  }, [profiles, query, group]);

  const st = (id) => status[id] || { state: 'stopped' };
  const allChecked = rows.length > 0 && rows.every((p) => selected.has(p.id));
  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((p) => p.id)));
  const selectedIds = [...selected].filter((id) => profiles.some((p) => p.id === id));

  const run = async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) toast(okMsg, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const start = (p) => run(() => window.api.startProfile(p.id));
  const stop = (p) => run(() => window.api.stopProfile(p.id));

  const batch = async (action) => {
    const ids = selectedIds;
    if (action === 'delete') {
      const ok = await confirm({
        title: `刪除 ${ids.length} 個環境`,
        message: '環境的 Cookie、快取與瀏覽紀錄會一併刪除，無法復原。',
        confirmText: '刪除',
        danger: true,
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
        errors.push(e.message);
      }
    }
    if (action === 'delete') setSelected(new Set());
    await refresh();
    if (errors.length) toast(`${errors.length} 個失敗：${errors[0]}`, 'error');
    else toast({ start: '已開啟', stop: '已關閉', delete: '已刪除' }[action] + ` ${ids.length} 個環境`, 'success');
  };

  const clone = (p) =>
    run(async () => {
      const seed = await window.api.randomSeed();
      const { id, createdAt, updatedAt, lastOpenedAt, ...rest } = p;
      await window.api.createProfile({ ...rest, name: `${p.name} 副本`, fingerprint: { ...p.fingerprint, seed } });
      await refresh();
    }, '已複製環境（使用新的指紋種子）');

  const remove = async (p) => {
    const ok = await confirm({
      title: `刪除「${p.name}」`,
      message: '這個環境的 Cookie、快取與瀏覽紀錄會一併刪除，無法復原。',
      confirmText: '刪除',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await window.api.deleteProfile(p.id);
      selected.delete(p.id);
      await refresh();
    }, '已刪除');
  };

  const noKernel = settings && !settings.kernelPath && !settings.bundledKernel;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>環境管理</h1>
          <p className="page-sub">每個環境擁有獨立的指紋、代理與 Cookie</p>
        </div>
        <div className="head-actions">
          <div className="search">
            <Icon name="search" size={15} />
            <input placeholder="搜尋名稱、備註、代理" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} />
            新建環境
          </button>
        </div>
      </header>

      {noKernel && (
        <div className="alert warn">
          <Icon name="warning" size={16} />
          找不到瀏覽器核心，請到「系統設定」選擇 fingerprint-chromium。
        </div>
      )}

      <div className="toolbar">
        <div className="chips">
          <button className={`chip ${group === 'all' ? 'active' : ''}`} onClick={() => setGroup('all')}>
            全部 <span>{profiles.length}</span>
          </button>
          {groups.map(([g, n]) => (
            <button key={g} className={`chip ${group === g ? 'active' : ''}`} onClick={() => setGroup(g)}>
              {g} <span>{n}</span>
            </button>
          ))}
          {ungrouped > 0 && groups.length > 0 && (
            <button className={`chip ${group === NONE ? 'active' : ''}`} onClick={() => setGroup(NONE)}>
              未分組 <span>{ungrouped}</span>
            </button>
          )}
        </div>
        <button className="icon-btn" title="重新整理" onClick={refresh}>
          <Icon name="refresh" />
        </button>
      </div>

      {selectedIds.length > 0 && (
        <div className="batch-bar">
          <span className="batch-count">已選 {selectedIds.length} 個</span>
          <button className="btn sm" onClick={() => batch('start')}>
            <Icon name="play" size={12} /> 批次開啟
          </button>
          <button className="btn sm" onClick={() => batch('stop')}>
            <Icon name="stop" size={12} /> 批次關閉
          </button>
          <button className="btn sm" onClick={() => setMoving(true)}>
            <Icon name="move" size={14} /> 移動分組
          </button>
          <button className="btn sm danger" onClick={() => batch('delete')}>
            <Icon name="trash" size={14} /> 刪除
          </button>
          <button className="link-btn" onClick={() => setSelected(new Set())}>
            取消選取
          </button>
        </div>
      )}

      <div className="table-card">
        {rows.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <Icon name="profiles" size={28} />
            </div>
            <h3>{profiles.length === 0 ? '還沒有任何環境' : '沒有符合條件的環境'}</h3>
            <p>{profiles.length === 0 ? '建立第一個環境，系統會自動產生一組完整的指紋。' : '換個關鍵字或分組試試。'}</p>
            {profiles.length === 0 && (
              <button className="btn primary" onClick={() => setEditing('new')}>
                <Icon name="plus" size={16} /> 新建環境
              </button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </th>
                <th className="col-idx">#</th>
                <th>環境</th>
                <th>分組</th>
                <th>代理 / 出口</th>
                <th>指紋</th>
                <th>最後開啟</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const s = st(p.id);
                const px = proxyParts(p.proxy);
                const fp = p.fingerprint || {};
                return (
                  <tr key={p.id} className={selected.has(p.id) ? 'selected' : ''}>
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
                      {px ? (
                        <div>
                          <span className="tag mono">{px.scheme}</span>{' '}
                          <span className="mono">
                            {px.host}:{px.port}
                          </span>
                        </div>
                      ) : (
                        <span className="muted">直連</span>
                      )}
                      {s.geo && (
                        <div className="sub">
                          <Icon name="globe" size={12} /> {s.geo.ip} · {s.geo.countryCode} · {s.geo.timezone}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="fp-cell">
                        <OsBadge platform={fp.platform} />
                        <div>
                          <div>
                            {PLATFORM_LABEL[fp.platform]} · {fp.brand}
                          </div>
                          <div className="sub mono">#{fp.seed}</div>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{timeAgo(p.lastOpenedAt)}</td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {s.state === 'running' ? (
                          <button className="btn sm stop-btn" onClick={() => stop(p)}>
                            <Icon name="stop" size={11} /> 關閉
                          </button>
                        ) : (
                          <button className="btn sm primary" disabled={s.state === 'starting'} onClick={() => start(p)}>
                            {s.state === 'starting' ? <span className="spinner" /> : <Icon name="play" size={11} />}
                            {s.state === 'starting' ? '啟動中' : '開啟'}
                          </button>
                        )}
                        <button className="icon-btn" title="編輯" disabled={s.state !== 'stopped'} onClick={() => setEditing(p)}>
                          <Icon name="edit" />
                        </button>
                        <Menu
                          items={[
                            { label: '複製環境', icon: 'copy', onClick: () => clone(p) },
                            { label: '刪除', icon: 'trash', danger: true, onClick: () => remove(p) },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <ProfileDrawer
          profile={editing === 'new' ? null : editing}
          groups={groups.map(([g]) => g)}
          defaultGroup={group !== 'all' && group !== NONE ? group : ''}
          hostPlatform={settings?.hostPlatform}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            await refresh();
            toast(msg, 'success');
          }}
        />
      )}

      {moving && (
        <MoveDialog
          count={selectedIds.length}
          groups={groups.map(([g]) => g)}
          onClose={() => setMoving(false)}
          onMove={async (target) => {
            setMoving(false);
            await run(async () => {
              for (const id of selectedIds) await window.api.updateProfile(id, { group: target });
              await refresh();
            }, `已移動 ${selectedIds.length} 個環境`);
          }}
        />
      )}
    </div>
  );
}

function MoveDialog({ count, groups, onClose, onMove }) {
  const [value, setValue] = useState(groups[0] || '');
  const [custom, setCustom] = useState(groups.length === 0);
  return (
    <Dialog
      title={`移動 ${count} 個環境到分組`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={() => onMove(value.trim())}>移動</button>
        </>
      }
    >
      {!custom ? (
        <Field label="目標分組">
          <select value={value} onChange={(e) => (e.target.value === '__new' ? (setCustom(true), setValue('')) : setValue(e.target.value))}>
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
            <option value="">（未分組）</option>
            <option value="__new">＋ 新分組…</option>
          </select>
        </Field>
      ) : (
        <Field label="新分組名稱">
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="例如：美國站" />
        </Field>
      )}
    </Dialog>
  );
}
