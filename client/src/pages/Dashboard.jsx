import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import api, { errorText } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Card, Spinner, Tile } from '../components/UI.jsx';
import { inr, lakhs } from '../utils/format.js';

// Distinct hues at similar lightness, so no single slice dominates.
const SLICE = ['#1a73e8', '#0f9d58', '#f4a100', '#7b3fa8', '#d93025', '#00838f', '#5f6368', '#c1272d'];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [network, setNetwork] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dashboard')
      .then(({ data }) => setData(data))
      .catch((e) => setError(errorText(e)));
  }, []);

  /*
   * A row on the rollup opens what it names: a school goes to its profile, a
   * block or district opens the level beneath it on the network screen.
   */
  const openNetworkRow = (r) => {
    const to = network?.level === 'schools'
      ? `/network/school/${r._id}`
      : network?.level === 'blocks'
        ? `/network?level=schools&block=${r._id}`
        : `/network?level=blocks&district=${r._id}`;
    const go = () => navigate(to);
    return {
      className: 'row-open',
      onClick: go,
      role: 'button',
      tabIndex: 0,
      title: `Open ${r.name || r.district}`,
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      },
    };
  };

  // Roles with something under them also get a network rollup on the landing
  // screen, so the hierarchy is visible without opening another page.
  useEffect(() => {
    if (!['block', 'dc', 'state', 'admin'].includes(user?.role)) return;
    const level = ['state', 'admin'].includes(user.role) ? 'districts' : user.role === 'dc' ? 'blocks' : 'schools';
    const url = level === 'districts' ? '/master/dc-offices'
      : level === 'blocks' ? '/master/blocks'
      : '/master/schools';
    api.get(url, { params: level === 'schools' ? { limit: 8 } : {} })
      .then(({ data }) => setNetwork({
        level,
        rows: data.offices || data.blocks || data.schools || [],
        total: data.total ?? data.count,
      }))
      .catch(() => {});
  }, [user]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner />;

  const k = data.kpis;
  const isState = ['state', 'admin'].includes(user?.role);
  const isSchool = ['school_maker', 'school_checker'].includes(user?.role);

  return (
    <>
      {k.myQueue > 0 && (
        <Alert kind="warn">
          <strong>{k.myQueue}</strong> claim(s) are waiting for your action.{' '}
          <Link to="/queue">Open my queue →</Link>
        </Alert>
      )}

      <div className="tiles">
        <Tile label="Total Claims" value={k.total} sub={inr(k.totalAmount)} />
        <Tile label="In Progress" value={k.pending} sub={inr(k.pendingAmount)} tone="amber" />
        <Tile label="Approved" value={k.approved} sub={inr(k.approvedAmount)} tone="green" />
        <Tile label="Rejected" value={k.rejected} tone="red" />
        {!isSchool && <Tile label="Approval Rate" value={`${k.approvalRate}%`} sub="of decided claims" />}
        {user?.role === 'dc' && (
          <>
            <Tile label="Paid" value={k.paid} sub={inr(k.paidAmount)} tone="green" />
            <Tile label="Awaiting Payment" value={k.unpaidApproved} tone="amber" />
          </>
        )}
        {isSchool && (
          <>
            <Tile label="Drafts" value={k.drafts} />
            <Tile label="Returned to You" value={k.returned} tone="red" />
          </>
        )}
      </div>

      {/* Stage pipeline — where everything currently sits. */}
      <Card title="Pipeline">
        <div className="tiles" style={{ marginBottom: 0 }}>
          <Tile label="With Checker" value={k.pendingChecker} />
          {/* Claims raised before the block stage was removed still count
              toward the DC, which is where they were moved. */}
          <Tile label="With DC" value={(k.pending || 0) - (k.pendingChecker || 0) - (k.returned || 0)} />
          <Tile label="Under Query" value={k.underQuery} tone="purple" />
          <Tile label="Returned" value={k.returned} tone="red" />
        </div>
      </Card>

      {network?.rows?.length > 0 && (
        <Card
          title={
            network.level === 'districts' ? 'Districts under you'
            : network.level === 'blocks' ? 'Blocks under you'
            : 'Schools under you'
          }
          padded={false}
          actions={<Link to="/network" className="btn sm">View all →</Link>}
        >
          <div className="table-wrap">
            <table>
              <thead>
                {network.level === 'schools' ? (
                  <tr>
                    <th>School</th><th>Code</th><th>Head Teacher</th>
                    <th className="num">Claims</th><th className="num">Pending</th>
                  </tr>
                ) : (
                  <tr>
                    <th>{network.level === 'districts' ? 'District' : 'Block'}</th>
                    <th className="num">Schools</th>
                    <th className="num">Claims</th>
                    <th className="num">Value</th>
                    <th className="num">Pending</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {network.rows.slice(0, 8).map((r) => (
                  <tr key={r._id} {...openNetworkRow(r)}>
                    {network.level === 'schools' ? (
                      <>
                        <td><strong>{r.name}</strong></td>
                        <td><code>{r.code}</code></td>
                        <td className="small">{r.headTeacher || '—'}</td>
                        <td className="num">{r.claims ?? 0}</td>
                        <td className="num">
                          {r.pending ? <Badge tone="amber">{r.pending}</Badge> : <span className="muted">—</span>}
                        </td>
                      </>
                    ) : (
                      <>
                        <td><strong>{r.district || r.name}</strong></td>
                        <td className="num">{r.schools ?? 0}</td>
                        <td className="num">{r.claims ?? 0}</td>
                        <td className="num">{inr(r.claimAmount || 0)}</td>
                        <td className="num">
                          {r.pending ? <Badge tone="amber">{r.pending}</Badge> : <span className="muted">—</span>}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {isState && data.pie && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 18 }}>
          <Card title="Claims by Status">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={data.pie.byStatus} dataKey="value" nameKey="label"
                     cx="50%" cy="50%" outerRadius={82} label={(e) => e.value}>
                  {data.pie.byStatus.map((_, i) => <Cell key={i} fill={SLICE[i % SLICE.length]} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} claims`, n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Amount by Scheme">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={data.pie.byCategory} dataKey="value" nameKey="label"
                     cx="50%" cy="50%" outerRadius={82}>
                  {data.pie.byCategory.map((_, i) => <Cell key={i} fill={SLICE[i % SLICE.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => inr(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Payment Position">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={data.pie.payment} dataKey="value" nameKey="label"
                     cx="50%" cy="50%" outerRadius={82} label={(e) => e.value}>
                  <Cell fill="#0f9d58" />
                  <Cell fill="#f4a100" />
                </Pie>
                <Tooltip formatter={(v, n, p) => [`${v} claims · ${inr(p.payload.amount)}`, n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {data.trend?.length > 1 && (
        <Card title="Last 6 Months">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eceef1" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, n) => (n === 'amount' ? inr(v) : v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="count" name="Claims" fill="#1a73e8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="approved" name="Approved" fill="#0f9d58" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {data.budget?.totals?.allocated > 0 && (
        <Card title={`Budget · FY ${data.budget.financialYear}`}>
          <div className="tiles" style={{ marginBottom: 14 }}>
            <Tile label="Allocated" value={lakhs(data.budget.totals.allocated)} />
            <Tile label="Distributed" value={lakhs(data.budget.totals.distributed)} />
            <Tile label="Undistributed" value={lakhs(data.budget.totals.undistributed)} tone="amber" />
            <Tile label="Committed" value={lakhs(data.budget.totals.committed)} tone="green" />
          </div>
          <Link to="/budget" className="small">Manage allocations →</Link>
        </Card>
      )}

      {data.ageing && (data.ageing.reminder > 0 || data.ageing.breached > 0) && (
        <Card title="SLA Ageing">
          <div className="row" style={{ marginBottom: 12 }}>
            <Badge tone="green">Within SLA · {data.ageing.normal}</Badge>
            <Badge tone="amber">Reminder · {data.ageing.reminder}</Badge>
            <Badge tone="red">Breached · {data.ageing.breached}</Badge>
          </div>
          {data.breaching?.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Claim</th><th>School</th><th>Status</th><th className="num">Amount</th><th className="num">Age</th></tr>
                </thead>
                <tbody>
                  {data.breaching.map((c) => (
                    <tr key={c.claimId}>
                      <td><Link to={`/claims/${c.claimId}`}>{c.claimId}</Link></td>
                      <td>{c.school}</td>
                      <td><Badge>{c.status}</Badge></td>
                      <td className="num">{inr(c.amount)}</td>
                      <td className="num"><Badge tone="red">{c.ageDays}d</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
