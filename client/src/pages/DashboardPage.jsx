import { Link } from 'react-router-dom';
import { api } from '../api.js';
import BarChart from '../components/BarChart.jsx';
import { Badge, DataTable, ErrorPanel, Loading, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtDate, fmtDateTime } from '../utils/format.js';
import { useAsync } from '../utils/useAsync.js';
import styles from './DashboardPage.module.css';

const inOrder = (rows, order) => order.map((label) => ({ label, value: rows.find((r) => r.label === label)?.value ?? 0 }));

export default function DashboardPage() {
  const { can } = useAuth();
  const { data: d, error, loading } = useAsync(() => api.get('/api/dashboard'), []);
  if (error) return <ErrorPanel error={error} />;
  if (loading && !d) return <Loading />;

  const s = d.stats;
  const tiles = [
    ['Active cases', s.activeCases, '/cases', false],
    ['Overdue cases', s.overdueCases, '/cases', s.overdueCases > 0],
    ['Evidence items', s.evidenceItems, '/evidence', false],
    ['Integrity failures', s.integrityFailures, '/evidence', s.integrityFailures > 0],
    ['Transfers, last 7 days', s.transfers7d, '/custody', false],
    ['Draft findings', s.draftFindings, '/findings', false],
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle={can('case.viewAll') ? 'Overview of all forensic casework' : 'Overview of your assigned cases'} />
      <div className={styles.stats}>
        {tiles.map(([label, value, to, alert]) => (
          <Link key={label} to={to} className={`${styles.stat} ${alert ? styles.alert : ''}`}>
            <b>{value}</b><span>{label}</span>
          </Link>
        ))}
      </div>
      <div className="stack">
        <div className={d.workload ? 'grid-3' : 'grid-2'}>
          <section className="panel"><h2>Cases by status</h2><BarChart rows={inOrder(d.casesByStatus, ['Open', 'In Progress', 'On Hold', 'Closed'])} /></section>
          <section className="panel"><h2>Evidence by status</h2><BarChart rows={inOrder(d.evidenceByStatus, ['In Storage', 'In Analysis', 'In Transit', 'Released', 'Archived'])} /></section>
          {d.workload && <section className="panel"><h2>Active cases per investigator</h2><BarChart rows={d.workload} /></section>}
        </div>
        <div className="grid-2">
          <section className="panel">
            <h2>Upcoming deadlines</h2>
            <DataTable
              rows={d.deadlines}
              empty="No upcoming deadlines"
              columns={[
                { label: 'Case', render: (c) => <><Link to={`/cases/${c.id}`}>{c.caseNumber}</Link><div className="small muted">{c.title}</div></> },
                { label: 'Priority', render: (c) => <Badge label={c.priority} /> },
                { label: 'Due', render: (c) => <span className="nowrap">{fmtDate(c.dueDate)}</span> },
              ]}
            />
          </section>
          <section className="panel">
            <h2>Recent custody activity</h2>
            <DataTable
              rows={d.recentCustody}
              empty="No custody activity yet"
              columns={[
                { label: 'Evidence', render: (e) => <span className="nowrap">{e.evidence?.evidenceNumber}</span> },
                { label: 'Movement', render: (e) => (e.fromUser ? `${e.fromUser.fullName} → ${e.toUser?.fullName}` : `Registered by ${e.toUser?.fullName}`) },
                { label: 'When', render: (e) => <span className="nowrap small">{fmtDateTime(e.occurredAt)}</span> },
              ]}
            />
          </section>
        </div>
      </div>
    </>
  );
}
