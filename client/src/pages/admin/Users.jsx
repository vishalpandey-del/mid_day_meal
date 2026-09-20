import { useCallback, useEffect, useState } from 'react';
import api, { errorText } from '../../api/client.js';
import { Alert, Badge, Card, Confirm, Empty, Field, PageHead, Spinner } from '../../components/UI.jsx';
import { dateOf, ROLE_LABEL } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';

const ROLES = ['school_maker', 'school_checker', 'block', 'dc', 'state', 'admin'];

/** User administration: search, activate/deactivate, reset password, transfer. */
export default function Users() {
  const { user } = useAuth();
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [filters, setFilters] = useState({ role: '', q: '', page: 1 });
  const [busy, setBusy] = useState('');

  // The role decides which scope field an account needs, and a DC may only
  // hand out the roles below it.
  const canManage = user.role === 'admin'
    ? ROLES
    : ['school_maker', 'school_checker', 'block'];

  // Edit / create dialog state
  const [editing, setEditing] = useState(null);   // the user, or 'new'
  const [form, setForm] = useState({});

  // Transfer dialog state
  const [moving, setMoving] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dest, setDest] = useState({ kind: '', value: '', note: '' });
  const [options, setOptions] = useState({ schools: [], blocks: [], districts: [] });

  const load = useCallback(() => {
    setRes(null);
    const params = { page: filters.page, limit: 30 };
    if (filters.role) params.role = filters.role;
    if (filters.q) params.q = filters.q;
    api.get('/users', { params })
      .then(({ data }) => setRes(data))
      .catch((e) => setError(errorText(e)));
  }, [filters]);

  useEffect(load, [load]);

  useEffect(() => {
    Promise.all([
      api.get('/master/schools', { params: { limit: 200 } }).catch(() => ({ data: { schools: [] } })),
      api.get('/master/blocks').catch(() => ({ data: { blocks: [] } })),
      api.get('/master/dc-offices').catch(() => ({ data: { offices: [] } })),
    ]).then(([s, b, d]) => setOptions({
      schools: s.data.schools || [],
      blocks: b.data.blocks || [],
      districts: d.data.offices || [],
    }));
  }, []);

  const act = async (id, fn, ok) => {
    setBusy(id); setError(''); setNote('');
    try { await fn(); setNote(ok); load(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };

  const openEdit = (u) => {
    setError(''); setNote('');
    setEditing(u || 'new');
    setForm(u
      ? { name: u.name, designation: u.designation || '', mobile: u.mobile || '', email: u.email || '' }
      : { userId: '', name: '', password: '', role: canManage[0], designation: '', mobile: '', email: '',
          school: '', block: '', dcOffice: '' });
  };

  const saveEdit = async () => {
    const isNew = editing === 'new';
    setBusy(isNew ? 'new' : editing._id);
    setError('');
    try {
      if (isNew) {
        const body = { ...form };
        // Only the scope field the chosen role actually uses is sent.
        if (!['school_maker', 'school_checker'].includes(body.role)) delete body.school;
        if (body.role !== 'block') delete body.block;
        if (body.role !== 'dc') delete body.dcOffice;
        Object.keys(body).forEach((k) => { if (body[k] === '') delete body[k]; });
        await api.post('/users', body);
        setNote(`${form.userId} created.`);
      } else {
        await api.put(`/users/${editing._id}`, form);
        setNote(`${editing.userId} updated.`);
      }
      setEditing(null);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const openTransfer = async (u) => {
    setMoving(u);
    setPreview(null);
    setDest({
      kind: ['school_maker', 'school_checker'].includes(u.role) ? 'school'
          : u.role === 'block' ? 'block'
          : u.role === 'dc' ? 'district' : '',
      value: '', note: '',
    });
    try {
      const { data } = await api.get(`/users/${u._id}/transfer-preview`);
      setPreview(data);
    } catch (e) { setError(errorText(e)); }
  };

  const doTransfer = async () => {
    setBusy(moving._id);
    setError('');
    try {
      const body = { note: dest.note };
      if (dest.kind === 'school') body.schoolId = dest.value;
      if (dest.kind === 'block') body.blockId = dest.value;
      if (dest.kind === 'district') body.districtId = dest.value;
      const { data } = await api.post(`/users/${moving._id}/transfer`, body);
      setNote(data.message);
      setMoving(null);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const destList =
    dest.kind === 'school' ? options.schools.map((s) => ({ v: s.code, l: `${s.name} (${s.code})` }))
    : dest.kind === 'block' ? options.blocks.map((b) => ({ v: b.blockId, l: `${b.name} (${b.blockId})` }))
    : dest.kind === 'district' ? options.districts.map((d) => ({ v: d.districtId, l: `${d.district} (${d.districtId})` }))
    : [];

  const place = (u) =>
    u.school?.name || (u.block ? `${u.block.name} block` : '') ||
    (u.dcOffice ? u.dcOffice.district : '') || 'State-wide';

  return (
    <>
      <PageHead
        title="Users & Transfers"
        subtitle={user.role === 'dc'
          ? 'The block and school logins in your district. A transfer moves the posting; the login id and password stay the same.'
          : 'A transfer moves the posting; the login id and password stay the same.'}
      >
        <button className="btn primary sm" onClick={() => openEdit(null)}>Add User</button>
      </PageHead>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{note}</Alert>

      <Card>
        <div className="row">
          <input
            placeholder="Search name or user ID…"
            style={{ flex: 1, minWidth: 220, padding: '7px 10px', border: '1px solid var(--border-strong)', borderRadius: 3 }}
            onKeyDown={(e) => { if (e.key === 'Enter') setFilters({ ...filters, q: e.target.value, page: 1 }); }}
          />
          <select value={filters.role}
                  onChange={(e) => setFilters({ ...filters, role: e.target.value, page: 1 })}
                  style={{ padding: '7px 10px', border: '1px solid var(--border-strong)', borderRadius: 3 }}>
            <option value="">All roles</option>
            {canManage.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          {(filters.role || filters.q) && (
            <button className="btn sm" onClick={() => setFilters({ role: '', q: '', page: 1 })}>Clear</button>
          )}
        </div>
      </Card>

      <Card
        title={res ? `${res.total} user(s)` : 'Loading…'}
        padded={false}
        actions={res?.pages > 1 ? (
          <div className="row">
            <button className="btn sm" disabled={filters.page <= 1}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Prev</button>
            <span className="small muted">{res.page} / {res.pages}</span>
            <button className="btn sm" disabled={filters.page >= res.pages}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</button>
          </div>
        ) : null}
      >
        {!res ? <Spinner /> : res.users.length === 0 ? <Empty>No users match.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>User ID</th><th>Name</th><th>Role</th><th>Posted At</th><th>Status</th><th>Last Login</th><th></th></tr>
              </thead>
              <tbody>
                {res.users.map((u) => (
                  <tr key={u._id} style={{ opacity: u.isActive ? 1 : 0.55 }}>
                    <td><code>{u.userId}</code></td>
                    <td className="small">{u.name}</td>
                    <td className="small">{ROLE_LABEL[u.role] || u.role}</td>
                    <td className="small muted">{place(u)}</td>
                    <td>
                      <Badge tone={u.isActive ? 'green' : 'red'}>
                        {u.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                    </td>
                    <td className="small muted">{u.lastLoginAt ? dateOf(u.lastLoginAt) : 'Never'}</td>
                    <td>
                      <div className="row">
                        <button className="btn sm" disabled={busy === u._id}
                                onClick={() => openEdit(u)}>Edit</button>
                        {!['state', 'admin'].includes(u.role) && (
                          <button className="btn sm" disabled={busy === u._id}
                                  onClick={() => openTransfer(u)}>Transfer</button>
                        )}
                        <button className="btn sm" disabled={busy === u._id}
                                onClick={() => act(u._id,
                                  () => api.patch(`/users/${u._id}/status`, { isActive: !u.isActive }),
                                  `${u.userId} ${u.isActive ? 'disabled' : 'enabled'}.`)}>
                          {u.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button className="btn sm" disabled={busy === u._id}
                                onClick={() => {
                                  const p = prompt(`New password for ${u.userId} (min 6 chars)`);
                                  if (p) act(u._id,
                                    () => api.post(`/users/${u._id}/reset-password`, { newPassword: p }),
                                    `Password reset for ${u.userId}.`);
                                }}>
                          Reset
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Confirm
        open={Boolean(editing)}
        title={editing === 'new' ? 'Add a user' : `Edit ${editing?.userId || ''}`}
        onCancel={() => setEditing(null)}
        onConfirm={saveEdit}
        confirmLabel={editing === 'new' ? 'Create' : 'Save'}
        busy={busy === 'new' || busy === editing?._id}
      >
        {editing === 'new' && (
          <>
            <Field label="Login ID" hint="What they type to sign in — it cannot be changed later.">
              <input value={form.userId || ''} autoFocus
                     onChange={(e) => setForm({ ...form, userId: e.target.value.toUpperCase() })}
                     placeholder="e.g. MKR18140100" />
            </Field>
            <Field label="Role">
              <select value={form.role || ''} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {canManage.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
              </select>
            </Field>
            {['school_maker', 'school_checker'].includes(form.role) && (
              <Field label="School">
                <select value={form.school || ''} onChange={(e) => setForm({ ...form, school: e.target.value })}>
                  <option value="">— Select school —</option>
                  {options.schools.map((o) => <option key={o._id} value={o._id}>{o.name} ({o.code})</option>)}
                </select>
              </Field>
            )}
            {form.role === 'block' && (
              <Field label="Block">
                <select value={form.block || ''} onChange={(e) => setForm({ ...form, block: e.target.value })}>
                  <option value="">— Select block —</option>
                  {options.blocks.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
                </select>
              </Field>
            )}
            {form.role === 'dc' && (
              <Field label="District office">
                <select value={form.dcOffice || ''} onChange={(e) => setForm({ ...form, dcOffice: e.target.value })}>
                  <option value="">— Select district —</option>
                  {options.districts.map((o) => <option key={o._id} value={o._id}>{o.district}</option>)}
                </select>
              </Field>
            )}
            <Field label="Password" hint="At least 6 characters. They can change it after signing in.">
              <input value={form.password || ''} type="text"
                     onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Name">
          <input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Designation">
          <input value={form.designation || ''}
                 onChange={(e) => setForm({ ...form, designation: e.target.value })}
                 placeholder="e.g. Head Teacher (Maker)" />
        </Field>
        <Field label="Mobile">
          <input value={form.mobile || ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
        </Field>
        <Field label="Email">
          <input value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        {editing !== 'new' && (
          <p className="small muted">
            The login id and password are not changed here — use Reset for a password.
          </p>
        )}
      </Confirm>

      <Confirm
        open={Boolean(moving)}
        title={`Transfer ${moving?.name || ''}`}
        onCancel={() => setMoving(null)}
        onConfirm={doTransfer}
        confirmLabel="Transfer"
        busy={busy === moving?._id}
      >
        {preview ? (
          <>
            <p className="small">
              Currently at <strong>{preview.currentPosting}</strong>.
            </p>
            {preview.pendingWork?.count > 0 && (
              <Alert kind="warn">
                {preview.pendingWork.count} claim(s) are waiting at this posting.
                They stay with the post — whoever holds it next will see them.
              </Alert>
            )}
            <Field label="Move to">
              <select value={dest.value} onChange={(e) => setDest({ ...dest, value: e.target.value })}>
                <option value="">— Select destination —</option>
                {destList.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </Field>
            <Field label="Reason / order number">
              <input value={dest.note} onChange={(e) => setDest({ ...dest, note: e.target.value })}
                     placeholder="e.g. Transfer order 44/2026" />
            </Field>
            <p className="small muted">
              Their login ID and password stay the same. Access switches to the new
              place immediately and stops at the old one.
            </p>
          </>
        ) : <Spinner />}
      </Confirm>
    </>
  );
}
