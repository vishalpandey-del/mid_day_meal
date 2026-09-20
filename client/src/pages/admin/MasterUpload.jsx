import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadFile, errorText } from '../../api/client.js';
import { Alert, Badge, Card, Empty, PageHead, Tile } from '../../components/UI.jsx';

/**
 * Master sheet upload. Preview first — nothing is written until the admin
 * sees exactly what the file would create.
 */
export default function MasterUpload() {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const pick = (f) => {
    setFile(f);
    setPreview(null);
    setResult(null);
    setError('');
  };

  const send = async (mode) => {
    if (!file) return;
    setBusy(mode);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/admin/master/${mode}`, fd);
      mode === 'preview' ? setPreview(data) : (setResult(data), setPreview(null));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <PageHead
        title="Master Data Upload"
        subtitle="The sheet's own district_id, block_id and school_code build the hierarchy — re-uploading updates rows instead of duplicating them."
      />

      <Alert kind="error">{error}</Alert>

      <Card title="1 · Choose the file" actions={
        <button className="btn sm" onClick={() =>
          downloadFile('/admin/master/template.xlsx').catch((e) => setError(errorText(e)))}>
          Download Template
        </button>
      }>
        <input ref={fileRef} type="file" accept=".xlsx"
               onChange={(e) => pick(e.target.files[0])} />
        {file && (
          <div className="row" style={{ marginTop: 12 }}>
            <span className="small">{file.name} · {Math.round(file.size / 1024)} KB</span>
            <button className="btn primary" disabled={busy} onClick={() => send('preview')}>
              {busy === 'preview' ? 'Reading…' : 'Preview'}
            </button>
          </div>
        )}
      </Card>

      {preview && (
        <>
          <Card title="2 · What this file will do">
            <div className="tiles" style={{ marginBottom: 14 }}>
              <Tile label="Rows in sheet" value={preview.rowsInSheet} />
              <Tile label="Districts" value={preview.districts.length} />
              <Tile label="Blocks" value={preview.blocks.length} />
              <Tile label="Schools" value={preview.schools.total}
                    sub={`${preview.schools.new} new · ${preview.schools.update} update`} tone="green" />
              {preview.skipped.length > 0 && (
                <Tile label="Rows skipped" value={preview.skipped.length} tone="red" />
              )}
            </div>

            {preview.unmatchedColumns?.length > 0 && (
              <Alert kind="info">
                Columns not used: {preview.unmatchedColumns.join(', ')}
              </Alert>
            )}

            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table>
                <thead><tr><th>District</th><th>ID</th><th className="num">Blocks</th><th className="num">Schools</th><th></th></tr></thead>
                <tbody>
                  {preview.districts.map((d) => (
                    <tr key={d.districtId}>
                      <td>{d.name}</td>
                      <td><code>{d.districtId}</code></td>
                      <td className="num">{d.blocks}</td>
                      <td className="num">{d.schools}</td>
                      <td><Badge tone={d.status === 'new' ? 'green' : 'blue'}>{d.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>
                Blocks ({preview.blocks.length})
              </summary>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>Block</th><th>ID</th><th>District</th><th className="num">Schools</th><th></th></tr></thead>
                  <tbody>
                    {preview.blocks.map((b) => (
                      <tr key={b.blockId}>
                        <td>{b.name}</td><td><code>{b.blockId}</code></td>
                        <td className="small muted">{b.district}</td>
                        <td className="num">{b.schools}</td>
                        <td><Badge tone={b.status === 'new' ? 'green' : 'blue'}>{b.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>

          {preview.skipped.length > 0 && (
            <Card title={`Rows that will be skipped (${preview.skipped.length})`} padded={false}>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Row</th><th>School</th><th>Reason</th></tr></thead>
                  <tbody>
                    {preview.skipped.slice(0, 40).map((s, i) => (
                      <tr key={i}>
                        <td className="num">{s.row}</td>
                        <td>{s.school}</td>
                        <td className="small" style={{ color: 'var(--red)' }}>{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {preview.warnings?.missingBank?.length > 0 && (
            <Alert kind="warn">
              <strong>{preview.warnings.missingBank.length} school(s)</strong> have no bank
              account or IFSC. They will import fine, but their bills cannot be paid until
              the bank details are filled in — the PFMS export will refuse them.
            </Alert>
          )}

          <Card title="3 · Commit">
            <p className="small muted" style={{ marginTop: 0 }}>
              Nothing has been written yet. This step creates the districts, blocks and schools above.
            </p>
            <button className="btn primary" disabled={busy} onClick={() => send('import')}>
              {busy === 'import' ? 'Importing…' : `Import ${preview.schools.total} school(s)`}
            </button>
          </Card>
        </>
      )}

      {result && (
        <Card title="Import complete">
          <div className="tiles" style={{ marginBottom: 14 }}>
            <Tile label="Districts" value={`+${result.districts.created}`}
                  sub={`${result.districts.updated} updated`} tone="green" />
            <Tile label="Blocks" value={`+${result.blocks.created}`}
                  sub={`${result.blocks.updated} updated`} tone="green" />
            <Tile label="Schools" value={`+${result.schools.inserted}`}
                  sub={`${result.schools.updated} updated`} tone="green" />
          </div>
          {result.schools.failed?.length > 0 && (
            <Alert kind="error">
              {result.schools.failed.length} row(s) failed: {result.schools.failed[0].reason}
            </Alert>
          )}
          <Alert kind="ok">
            Master data is in. Next, create the logins this data needs.
          </Alert>
          <Link to="/admin/logins" className="btn primary" style={{ display: 'inline-block' }}>
            Go to Login Manager →
          </Link>
        </Card>
      )}

      {!file && !preview && !result && (
        <Card title="Expected columns">
          <Empty>
            <div className="small" style={{ textAlign: 'left', maxWidth: 560, margin: '0 auto' }}>
              <p><strong>Required:</strong> district_name, district_id, block_name, block_id,
                 school_code, school_name</p>
              <p><strong>Also read:</strong> cluster_name, cluster_id, lowest_class, highest_class,
                 school_assam_category, school_management, contact_name, contact_number, email_id,
                 location, assembly_name, parliament_name, bank_account_number, bank_name,
                 bank_branch, bank_ifsc_code</p>
              <p className="muted">Minor spelling and spacing differences in headers are tolerated.</p>
            </div>
          </Empty>
        </Card>
      )}
    </>
  );
}
