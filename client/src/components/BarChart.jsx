import styles from './BarChart.module.css';

/** Horizontal bar chart: rows are [{ label, value }]. Each bar is labelled with its value. */
export default function BarChart({ rows, empty = 'No data yet' }) {
  if (!rows?.length) return <div className="empty">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={styles.bars}>
      {rows.map((r) => (
        <div key={r.label} className={styles.row} title={`${r.label}: ${r.value}`}>
          <span className={styles.label}>{r.label}</span>
          <span className={styles.track}><span className={styles.fill} style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className={styles.value}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
