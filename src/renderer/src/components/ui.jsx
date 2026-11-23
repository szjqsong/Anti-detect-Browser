import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, message, type }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), type === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}>
            <Icon name={t.type === 'error' ? 'warning' : 'check'} size={15} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Dialog ----------
export function Dialog({ title, children, onClose, footer, width = 420 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width }}>
        <div className="dialog-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Promise-based confirm dialog (window.confirm is ugly; window.prompt is unsupported in Electron).
const ConfirmCtx = createContext(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback(
    (opts) => new Promise((resolve) => setState({ ...opts, resolve })),
    []
  );
  const close = (v) => {
    state.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Dialog
          title={state.title}
          onClose={() => close(false)}
          footer={
            <>
              <button className="btn" onClick={() => close(false)}>取消</button>
              <button className={`btn ${state.danger ? 'danger-solid' : 'primary'}`} onClick={() => close(true)}>
                {state.confirmText || '確定'}
              </button>
            </>
          }
        >
          <p className="dialog-text">{state.message}</p>
        </Dialog>
      )}
    </ConfirmCtx.Provider>
  );
}

// ---------- Dropdown menu ----------
export function Menu({ items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="更多">
        <Icon name="more" />
      </button>
      {open && (
        <div className={`menu ${align}`}>
          {items.map((it) => (
            <button
              key={it.label}
              className={`menu-item ${it.danger ? 'danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <Icon name={it.icon} size={15} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Small pieces ----------
export function Switch({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, span }) {
  return (
    <label className={`field ${span ? `span-${span}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export const PLATFORM_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export function OsBadge({ platform }) {
  const short = { windows: 'WIN', macos: 'MAC', linux: 'LNX' }[platform] || '?';
  return <span className={`os-badge ${platform}`}>{short}</span>;
}

export function proxyParts(proxy) {
  if (!proxy) return null;
  const four = proxy.match(/^([^:@/]+):(\d+):[^:]+:.+$/);
  if (four) return { scheme: 'http', host: four[1], port: four[2] };
  const m = proxy.match(/^(?:(\w+):\/\/)?(?:[^@]*@)?([^:/@]+):(\d+)/);
  return m ? { scheme: (m[1] || 'http').toLowerCase(), host: m[2], port: m[3] } : { scheme: '?', host: proxy, port: '' };
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '剛剛';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return new Date(iso).toLocaleDateString();
}
