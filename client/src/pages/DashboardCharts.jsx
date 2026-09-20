import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { Card } from '../components/UI.jsx';
import { inr } from '../utils/format.js';

/**
 * The dashboard's charts, kept apart from the dashboard itself.
 *
 * The charting library is 390 KB — larger than the rest of the portal put
 * together — and every role was downloading it before its landing screen
 * appeared, though only the state sees the pies at all. Loading it here means
 * the numbers show immediately and the pictures arrive a moment later.
 */

// Distinct hues at similar lightness, so no single slice dominates.
const SLICE = ['#1a73e8', '#0f9d58', '#f4a100', '#7b3fa8', '#d93025', '#00838f', '#5f6368', '#c1272d'];

const Donut = ({ title, data, label, tip }) => (
  <Card title={title}>
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={82} label={label}>
          {data.map((_, i) => <Cell key={i} fill={SLICE[i % SLICE.length]} />)}
        </Pie>
        <Tooltip formatter={tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  </Card>
);

export default function DashboardCharts({ pie, trend, showPies }) {
  return (
    <>
      {showPies && pie && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 18 }}>
          <Donut
            title="Claims by Status"
            data={pie.byStatus}
            label={(e) => e.value}
            tip={(v, n) => [`${v} claims`, n]}
          />
          <Donut
            title="Amount by Scheme"
            data={pie.byCategory}
            tip={(v) => inr(v)}
          />
          <Donut
            title="Payment Position"
            data={pie.payment}
            label={(e) => e.value}
            tip={(v, n, p) => [`${v} claims · ${inr(p.payload.amount)}`, n]}
          />
        </div>
      )}

      {trend?.length > 1 && (
        <Card title="Last 6 Months">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={trend}>
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
    </>
  );
}
