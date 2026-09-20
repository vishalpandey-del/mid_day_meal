import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { downloadFile, errorText } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Card, Empty, PageHead, Spinner, Tile } from '../components/UI.jsx';
import { inr } from '../utils/format.js';

/**
 * "What sits under me" — districts, blocks and schools, scoped to the caller.
 * The API already narrows every list, so this screen only decides which
 * levels are worth showing for the signed-in role.
 */
const LEVELS_FOR = {
  state: ['districts', 'blocks', 'schools'],
  admin: ['districts', 'blocks', 'schools'],
  dc: ['blocks', 'schools'],
  block: ['schools'],
  school_maker: ['schools'],
  school_checker: ['schools'],
};

const TITLE = {
  districts: 'Districts',
  blocks: 'Blocks',
  schools: 'Schools',
};

export default function Network() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const levels = LEVELS_FOR[user?.role] || ['schools'];
  const level = levels.includes(params.get('level')) ? params.get('level') : levels[0];

  // Drill-down filters, carried in the URL so the view is linkable.
  const districtId = params.get('district') || '';
  const blockId = params.get('block') || '';

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  /**
   * Props that turn a table row into the thing you click.
   * Keyboard users get the same target, which a click handler alone would
   * leave out — hence the role, the tab stop and the Enter/Space handler.
   */
  const openRow = (go, label) => ({
    className: 'row-open',
    onClick: go,
    role: 'button',
    tabIndex: 0,
    title: label,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    },
  });

  const setLevel = (l, extra = {}) => {
    const next = { level: l, ...extra };
    setParams(next);
    setPage(1);
    setQ('');
  };

  const load = useCallback(() => {
    setData(null);
    setError('');
    const req =
      level === 'districts'
        ? api.get('/master/dc-offices')
        : level === 'blocks'
        ? api.get('/master/blocks', { params: districtId ? { district: districtId } : {} })
        : api.get('/master/schools', {
            params: {
              limit: 25,
              page,
              ...(q ? { q } : {}),
              ...(blockId ? { block: blockId } : {}),
              ...(districtId ? { district: districtId } : {}),
            },
          });

    req.then(({ data }) => setData(data)).catch((e) => setError(errorText(e)));
  }, [level, districtId, blockId, page, q]);

  useEffect(load, [load]);

  if (error) return <Alert kind="error">{error}</Alert>;

  const rows =
    level === 'districts' ? data?.offices : level === 'blocks' ? data?.blocks : data?.schools;

  /* ---------- Summary tiles across the top ---------- */
  const totals = (rows || []).reduce(
    (t, r) => ({
      units: t.units + 1,
      schools: t.schools + (level === 'schools' ? 1 : r.schools || 0),
      claims: t.claims + (r.claims || 0),
      amount: t.amount + (r.claimAmount || 0),
      pending: t.pending + (r.pending || 0),
    }),
    { units: 0, schools: 0, claims: 0, amount: 0, pending: 0 }
  );

  const crumbs = [];
  if (districtId && rows?.[0]) {
    const label = level === 'blocks' ? rows[0].dcOffice?.district : rows[0].dcOffice?.district;
    if (label) crumbs.push(label);
  }
  if (blockId && level === 'schools' && rows?.[0]?.blockRef?.name) {
    crumbs.push(`${rows[0].blockRef.name} block`);
  }

  return (
    <>
      <PageHead
        title="My Network"
        subtitle={
          crumbs.length
            ? crumbs.join(' · ')
            : 'Everything that reports to you, with live claim activity.'
        }
      >
        {level === 'schools' && (
          <button
            className="btn sm"
            onClick={() =>
              downloadFile('/reports/claims.xlsx').catch((e) => setError(errorText(e)))
            }
          >
            Export Claims
          </button>
        )}
      </PageHead>

      {/* Level switcher — only the levels this role actually has. */}
      {levels.length > 1 && (
        <div className="pill-tabs">
          {levels.map((l) => (
            <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
              {TITLE[l]}
            </button>
          ))}
        </div>
      )}

      {(districtId || blockId) && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn sm" onClick={() => setLevel(level)}>
            ← Clear filter
          </button>
        </div>
      )}

      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="tiles">
            <Tile label={TITLE[level]} value={level === 'schools' ? data.total : totals.units} />
            {level !== 'schools' && <Tile label="Schools" value={totals.schools} />}
            <Tile label="Claims" value={totals.claims} sub={inr(totals.amount)} tone="green" />
            <Tile label="In Progress" value={totals.pending} tone="amber" />
          </div>

          {level === 'schools' && (
            <Card>
              <div className="row">
                <input
                  placeholder="Search school name, code or head teacher…"
                  style={{
                    flex: 1, minWidth: 220, padding: '9px 12px',
                    border: '1.5px solid var(--bd)', borderRadius: 9, outline: 'none',
                  }}
                  defaultValue={q}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { setQ(e.target.value.trim()); setPage(1); }
                  }}
                />
                {q && (
                  <button className="btn sm" onClick={() => { setQ(''); setPage(1); }}>
                    Clear
                  </button>
                )}
              </div>
            </Card>
          )}

          <Card
            title={`${TITLE[level]} · ${level === 'schools' ? data.total : totals.units}`}
            padded={false}
            actions={
              level === 'schools' && data.pages > 1 ? (
                <div className="row">
                  <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Prev
                  </button>
                  <span className="small muted">{data.page} / {data.pages}</span>
                  <button className="btn sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </button>
                </div>
              ) : null
            }
          >
            {!rows?.length ? (
              <Empty>Nothing mapped here yet.</Empty>
            ) : (
              <div className="table-wrap">
                {level === 'districts' && (
                  <table>
                    <thead>
                      <tr>
                        <th>District</th><th>ID</th>
                        <th className="num">Blocks</th><th className="num">Schools</th>
                        <th className="num">Claims</th><th className="num">Value</th>
                        <th className="num">Approved</th><th className="num">Pending</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((o) => (
                        <tr
                          key={o._id}
                          {...openRow(() => setLevel('blocks', { district: o._id }),
                            `Open the blocks in ${o.district}`)}
                        >
                          <td><strong>{o.district}</strong></td>
                          <td><code>{o.districtId}</code></td>
                          <td className="num">{o.blocks}</td>
                          <td className="num">{o.schools}</td>
                          <td className="num">{o.claims}</td>
                          <td className="num">{inr(o.claimAmount)}</td>
                          <td className="num"><Badge tone="green">{o.approved}</Badge></td>
                          <td className="num">
                            {o.pending ? <Badge tone="amber">{o.pending}</Badge> : <span className="muted">—</span>}
                          </td>
                          <td className="go">{o.blocks} blocks →</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {level === 'blocks' && (
                  <table>
                    <thead>
                      <tr>
                        <th>Block</th><th>ID</th><th>District</th>
                        <th className="num">Schools</th><th className="num">Payable</th>
                        <th className="num">Claims</th><th className="num">Value</th>
                        <th className="num">Pending</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((b) => (
                        <tr
                          key={b._id}
                          {...openRow(() => setLevel('schools', { block: b._id }),
                            `Open the ${b.schools} school(s) in ${b.name}`)}
                        >
                          <td><strong>{b.name}</strong></td>
                          <td><code>{b.blockId}</code></td>
                          <td className="small muted">{b.dcOffice?.district}</td>
                          <td className="num">{b.schools}</td>
                          <td className="num">
                            {b.payableSchools < b.schools ? (
                              <Badge tone="amber">{b.payableSchools}/{b.schools}</Badge>
                            ) : (
                              <Badge tone="green">{b.payableSchools}</Badge>
                            )}
                          </td>
                          <td className="num">{b.claims}</td>
                          <td className="num">{inr(b.claimAmount)}</td>
                          <td className="num">
                            {b.pending ? <Badge tone="amber">{b.pending}</Badge> : <span className="muted">—</span>}
                          </td>
                          <td className="go">{b.schools} schools →</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {level === 'schools' && (
                  <table>
                    <thead>
                      <tr>
                        <th>School</th><th>Code</th><th>Block</th>
                        <th>Head Teacher</th><th>Bank</th>
                        <th className="num">Claims</th><th className="num">Value</th>
                        <th className="num">Pending</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => (
                        <tr
                          key={s._id}
                          {...openRow(() => navigate(`/network/school/${s._id}`),
                            `Open ${s.name}`)}
                        >
                          <td>
                            <strong>{s.name}</strong>
                            <div className="small muted">{s.cluster || s.category}</div>
                          </td>
                          <td><code>{s.code}</code></td>
                          <td className="small">{s.blockRef?.name || s.block}</td>
                          <td className="small">
                            {s.headTeacher || <span className="muted">—</span>}
                            {s.mobile && <div className="small muted">{s.mobile}</div>}
                          </td>
                          <td>
                            {s.isPayable ? (
                              <Badge tone="green">Ready</Badge>
                            ) : (
                              <Badge tone="red">No bank</Badge>
                            )}
                          </td>
                          <td className="num">{s.claims}</td>
                          <td className="num">{inr(s.claimAmount)}</td>
                          <td className="num">
                            {s.pending ? <Badge tone="amber">{s.pending}</Badge> : <span className="muted">—</span>}
                          </td>
                          <td className="go">open →</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
