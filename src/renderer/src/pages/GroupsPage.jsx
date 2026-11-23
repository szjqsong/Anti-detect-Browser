import React, { useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Dialog, Field, Menu, useConfirm, useToast } from '../components/ui.jsx';

export default function GroupsPage({ profiles, status, refresh, setPage }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(null);

  const groups = useMemo(() => {
    const m = new Map();
    for (const p of profiles) {
      const key = p.group || '';
      const g = m.get(key) || { name: key, count: 0, running: 0 };
      g.count += 1;
      if (status[p.id]?.state === 'running') g.running += 1;
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => (a.name === '' ? 1 : b.name === '' ? -1 : a.name.localeCompare(b.name)));
  }, [profiles, status]);

  const moveAll = async (from, to) => {
    for (const p of profiles.filter((x) => (x.group || '') === from)) await window.api.updateProfile(p.id, { group: to });
    await refresh();
  };

  const dissolve = async (g) => {
    const ok = await confirm({
      title: `解散分組「${g.name}」`,
      message: `分組內的 ${g.count} 個環境不會被刪除，會移到「未分組」。`,
      confirmText: '解散',
      danger: true,
    });
    if (!ok) return;
    await moveAll(g.name, '');
    toast('已解散分組', 'success');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>分組管理</h1>
          <p className="page-sub">用分組整理不同平台、店舖或用途的環境</p>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="table-card">
          <div className="empty">
            <div className="empty-icon">
              <Icon name="folder" size={28} />
            </div>
            <h3>還沒有分組</h3>
            <p>在新建或編輯環境時填入分組名稱，就會自動出現在這裡。</p>
            <button className="btn primary" onClick={() => setPage('profiles')}>前往環境管理</button>
          </div>
        </div>
      ) : (
        <div className="group-grid">
          {groups.map((g) => (
            <div key={g.name || '__none'} className="group-card">
              <div className="group-top">
                <div className="group-icon">
                  <Icon name="folder" size={20} />
                </div>
                {g.name && (
                  <Menu
                    items={[
                      { label: '重新命名', icon: 'edit', onClick: () => setRenaming(g) },
                      { label: '解散分組', icon: 'trash', danger: true, onClick: () => dissolve(g) },
                    ]}
                  />
                )}
              </div>
              <div className="group-name">{g.name || '未分組'}</div>
              <div className="group-stats">
                <span>
                  <b>{g.count}</b> 個環境
                </span>
                <span>
                  <span className={`dot ${g.running ? 'green' : ''}`} /> {g.running} 執行中
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {renaming && (
        <RenameDialog
          group={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            setRenaming(null);
            await moveAll(renaming.name, name);
            toast('已重新命名', 'success');
          }}
        />
      )}
    </div>
  );
}

function RenameDialog({ group, onClose, onSave }) {
  const [name, setName] = useState(group.name);
  return (
    <Dialog
      title="重新命名分組"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>儲存</button>
        </>
      }
    >
      <Field label="分組名稱">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Dialog>
  );
}
