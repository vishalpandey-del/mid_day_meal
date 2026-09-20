import { useEffect, useState } from 'react';
import api, { errorText } from '../../api/client.js';
import { Alert, Badge, Card, Empty, PageHead, SearchBox, Spinner, Tile } from '../../components/UI.jsx';

/** District to Block to School coverage, with the login gaps called out. */
export default function Hierarchy() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState({});

  useEffect(() => {
    api.get('/admin/hierarchy')
      .then(({ data }) => {
        setData(data);
        setOpen(Object.fromEntries(data.hierarchy.map((d) => [d.districtId, true])));
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner />;

  const t = data.totals;
  const gaps = t.missingDcLogins + t.missingBlockLogins;

  /*
   * The whole tree is already loaded, so searching narrows it in place: a
   * district stays if it matches, or if any block under it does, and only
   * the matching blocks are listed beneath it.
   */
  const needle = q.trim().toLowerCase();
  const hit = (...vals) => vals.some((v) => String(v || '').toLowerCase().includes(needle));
  const tree = !needle ? data.hierarchy : data.hierarchy
    .map((d) => {
      if (hit(d.district, d.districtId)) return d;
      const blocks = d.blocks.filter((b) => hit(b.block, b.blockId));
      return blocks.length ? { ...d, blocks } : null;
    })
    .filter(Boolean);

  return (
    <>
      <PageHead title="Hierarchy" subtitle="District to block to school, with login coverage at each level." />

      <Card>
        <SearchBox value={q} onSearch={setQ} placeholder="Search district or block…" />
      </Card>

      <div className="tiles">
        <Tile label="Districts" value={t.districts} />
        <Tile label="Blocks" value={t.blocks} />
        <Tile label="Schools" value={t.schools} />
        <Tile label="Logins" value={t.logins} />
        <Tile label="Claims" value={t.claims} />
        {gaps > 0 && <Tile label="Missing logins" value={gaps} tone="red" />}
      </div>

      {gaps > 0 && (
        <Alert kind="warn">
          {t.missingDcLogins} district and {t.missingBlockLogins} block office(s) have no
          login yet. Create them from the Login Manager.
        </Alert>
      )}

      {tree.length === 0 ? (
        <Card><Empty>{needle ? 'No district or block matches that.' : 'No master data uploaded yet.'}</Empty></Card>
      ) : tree.map((d) => (
        <Card
          key={d.districtId}
          title={
            <span className="row">
              <span>{d.district}</span>
              <code className="small">{d.districtId}</code>
              {d.hasLogin ? <Badge tone="green">login ok</Badge> : <Badge tone="red">no login</Badge>}
            </span>
          }
          actions={
            <button className="btn sm"
                    onClick={() => setOpen((o) => ({ ...o, [d.districtId]: !o[d.districtId] }))}>
              {open[d.districtId] || needle ? 'Hide' : 'Show'} {d.blocks.length} block(s)
            </button>
          }
          padded={false}
        >
          {(open[d.districtId] || Boolean(needle)) && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Block</th><th>ID</th><th>Login</th>
                    <th className="num">Schools</th><th className="num">Payable</th>
                    <th className="num">Makers</th><th className="num">Checkers</th>
                  </tr>
                </thead>
                <tbody>
                  {d.blocks.map((b) => (
                    <tr key={b.blockId}>
                      <td>{b.block}</td>
                      <td><code className="small">{b.blockId}</code></td>
                      <td>{b.hasLogin ? <Badge tone="green">ok</Badge> : <Badge tone="red">missing</Badge>}</td>
                      <td className="num">{b.schools}</td>
                      <td className="num">
                        {b.payableSchools < b.schools
                          ? <Badge tone="amber">{b.payableSchools}/{b.schools}</Badge>
                          : b.payableSchools}
                      </td>
                      <td className="num">
                        {b.schoolLogins.makers < b.schools
                          ? <Badge tone="amber">{b.schoolLogins.makers}</Badge>
                          : b.schoolLogins.makers}
                      </td>
                      <td className="num">
                        {b.schoolLogins.checkers < b.schools
                          ? <Badge tone="amber">{b.schoolLogins.checkers}</Badge>
                          : b.schoolLogins.checkers}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
