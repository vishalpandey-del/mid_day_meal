import { STATUS_TONE } from '../utils/format.js';

/** Page title with optional right-aligned actions, used at the top of a screen. */
export const PageHead = ({ title, subtitle, children }) => (
  <div
    className="row"
    style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}
  >
    <div>
      <h2 style={{ margin: 0 }}>{title}</h2>
      {subtitle && <div className="small muted" style={{ marginTop: 2 }}>{subtitle}</div>}
    </div>
    {children && <div className="row">{children}</div>}
  </div>
);

export const Badge = ({ children, tone }) => (
  <span className={`badge ${tone || STATUS_TONE[children] || 'grey'}`}>{children}</span>
);

export const Tile = ({ label, value, sub, tone }) => (
  <div className={`tile ${tone || ''}`}>
    <div className="label">{label}</div>
    <div className="value">{value}</div>
    {sub && <div className="sub">{sub}</div>}
  </div>
);

export const Card = ({ title, actions, children, padded = true }) => (
  <div className="card">
    {(title || actions) && (
      <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span>{title}</span>
        {actions}
      </h3>
    )}
    {padded ? <div className="body">{children}</div> : children}
  </div>
);

export const Alert = ({ kind = 'info', children }) =>
  children ? <div className={`alert ${kind}`}>{children}</div> : null;

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const Spinner = ({ children = 'Loading…' }) => (
  <div className="empty">{children}</div>
);

export const Field = ({ label, hint, children }) => (
  <div className="field">
    {label && <label>{label}</label>}
    {children}
    {hint && <div className="hint">{hint}</div>}
  </div>
);

/** Confirmation prompt shown inline, so nothing destructive happens on one click. */
export const Confirm = ({ open, title, children, onCancel, onConfirm, confirmLabel = 'Confirm', busy }) => {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)',
      display: 'grid', placeItems: 'center', zIndex: 50, padding: 20,
    }}>
      <div className="card" style={{ maxWidth: 460, width: '100%', margin: 0 }}>
        <h3>{title}</h3>
        <div className="body">
          {children}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={onConfirm} disabled={busy}>
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * One search box, used on every list screen so they all behave the same.
 *
 * Typing filters as you go — there is no button to find and no Enter to
 * remember. `onSearch` is called with the trimmed text; debouncing, if the
 * screen needs it, belongs to the caller.
 */
export const SearchBox = ({ value, onSearch, placeholder = 'Search…', children }) => (
  <div className="searchbar">
    <input
      className="search-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onSearch(e.target.value)}
    />
    {children}
    {value && (
      <button className="btn sm" onClick={() => onSearch('')}>Clear</button>
    )}
  </div>
);
