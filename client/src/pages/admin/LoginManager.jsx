import { useEffect, useState } from 'react';
import api, { errorText } from '../../api/client.js';
import { Alert, Badge, Card, Empty, Field, PageHead, SearchBox, Spinner, Tile } from '../../components/UI.jsx';
import { ROLE_LABEL } from '../../utils/format.js';

/**
 * Creates the logins the uploaded master data implies. The plan is shown
 * first, the admin ticks what to create, and the passwords come back once.
 */
export default function LoginManager() {
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [created, setCreated] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unique, setUnique] = useState(false);

  const load = () => {
    setPlan(null); setCreated(null); setError('');
    api.post('/admin/provision/preview', {})
      .then(({ data }) => {
        setPlan(data);
        setPicked(new Set(data.toCreate.map((c) => c.userId)));
      })
      .catch((e) => setError(errorText(e)));
  };

  useEffect(load, []);

  const toggle = (id) => setPicked((p) => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const commit = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/admin/provision/commit', {
        userIds: [...picked],
        uniquePasswords: unique,
      });
      setCreated(data);
      setPlan(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = () => {
    const rows = [['User ID', 'Name', 'Role', 'Assigned To', 'Password']]
      .concat(created.created.map((c) => [c.userId, c.name, c.role, c.scope, c.password]));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `vidyaposhan-logins-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error && !plan && !created) {
    return (
      <>
        <Alert kind="error">{error}</Alert>
        <button className="btn" onClick={load}>Retry</button>
      </>
    );
  }

  if (created) {
    return (
      <>
        <PageHead title="Logins created" subtitle="Hand these credentials out now — they cannot be read back later." />
        <Alert kind="warn">
          <strong>These passwords are shown only once.</strong> Download the list now —
          they are stored hashed and cannot be read back.
        </Alert>

        <Card
          title={`${created.created.length} login(s)`}
          actions={<button className="btn primary sm" onClick={downloadCsv}>Download CSV</button>}
          padded={false}
        >
          <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>User ID</th><th>Name</th><th>Role</th><th>Assigned To</th><th>Password</th></tr></thead>
              <tbody>
                {created.created.map((c) => (
                  <tr key={c.userId}>
                    <td><code>{c.userId}</code></td>
                    <td className="small">{c.name}</td>
                    <td className="small">{ROLE_LABEL[c.role]}</td>
                    <td className="small muted">{c.scope}</td>
                    <td><code>{c.password}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {created.failed?.length > 0 && (
          <Alert kind="error">{created.failed.length} could not be created.</Alert>
        )}
        <button className="btn" onClick={load}>Back to Login Manager</button>
      </>
    );
  }

  if (!plan) return <Spinner />;

  const s = plan.summary;

  /* The plan is already in hand, so the search narrows it here. */
  const needle = q.trim().toLowerCase();
  const visible = !needle ? plan.toCreate : plan.toCreate.filter((c) =>
    [c.userId, c.name, c.role, c.scope].some((v) => String(v || '').toLowerCase().includes(needle)));
  const visibleIds = new Set(visible.map((c) => c.userId));
  const allVisiblePicked = visible.length > 0 && visible.every((c) => picked.has(c.userId));

  return (
    <>
      <PageHead
        title="Login Manager"
        subtitle="Logins follow the master data, so a school's id survives a name change. State and administrator accounts are created by hand."
      />

      <Alert kind="error">{error}</Alert>

      <div className="tiles">
        <Tile label="Districts" value={s.districts} />
        <Tile label="Blocks" value={s.blocks} />
        <Tile label="Schools" value={s.schools} />
        <Tile label="Logins to create" value={s.toCreate} tone="green" />
        <Tile label="Already exist" value={s.alreadyExists} tone="amber" />
      </div>

      {s.toCreate === 0 ? (
        <Card title="Nothing to create">
          <Empty>Every login for the current master data already exists.</Empty>
        </Card>
      ) : (
        <>
          <Card title="Options">
            <Field hint="Otherwise each role gets a shared default (School@123, Block@123, District@123).">
              <label className="row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
                <span>Give every login its own random password</span>
              </label>
            </Field>
            <div className="row">
              {Object.entries(s.byRole).map(([r, n]) => (
                <Badge key={r} tone="blue">{ROLE_LABEL[r] || r}: {n}</Badge>
              ))}
            </div>
          </Card>

          <Card>
            <SearchBox value={q} onSearch={setQ} placeholder="Search user ID, name, role or place…" />
          </Card>

          <Card
            title={`Selected ${picked.size} of ${plan.toCreate.length}`
              + (needle && visible.length !== plan.toCreate.length ? ` · showing ${visible.length}` : '')}
            actions={
              <div className="row">
                {/* Select all means the rows on screen, not the ones a search hid. */}
                <button className="btn sm" onClick={() =>
                  setPicked(allVisiblePicked
                    ? new Set([...picked].filter((id) => !visibleIds.has(id)))
                    : new Set([...picked, ...visibleIds]))}>
                  {allVisiblePicked ? 'Clear all' : 'Select all'}
                </button>
                <button className="btn primary sm" disabled={busy || !picked.size} onClick={commit}>
                  {busy ? 'Creating…' : `Create ${picked.size} login(s)`}
                </button>
              </div>
            }
            padded={false}
          >
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr><th style={{ width: 34 }}></th><th>User ID</th><th>Name</th><th>Role</th><th>Assigned To</th></tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.userId}>
                      <td>
                        <input type="checkbox" checked={picked.has(c.userId)}
                               onChange={() => toggle(c.userId)} />
                      </td>
                      <td><code>{c.userId}</code></td>
                      <td className="small">{c.name}</td>
                      <td className="small">{ROLE_LABEL[c.role] || c.role}</td>
                      <td className="small muted">{c.scope}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {plan.alreadyExists?.length > 0 && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer', margin: '10px 0' }}>
            {plan.alreadyExists.length} login(s) already exist
          </summary>
          <Card padded={false}>
            <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>User ID</th><th>Role</th><th>Assigned To</th></tr></thead>
                <tbody>
                  {plan.alreadyExists.map((c) => (
                    <tr key={c.userId}>
                      <td><code>{c.userId}</code></td>
                      <td className="small">{ROLE_LABEL[c.role] || c.role}</td>
                      <td className="small muted">{c.scope}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </details>
      )}
    </>
  );
}
