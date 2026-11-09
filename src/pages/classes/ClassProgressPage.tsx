import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { clockLabel } from '../../../functions/src/shared/classRegister';

type Progress = {
  church: string; programme: string; firstName: string; done: number; total: number; percent: number; graduated: boolean;
  classTime: string; next: { date: string; topic: string } | null;
  topics: { name: string; label: string; planned: string | null; done: string | null; byHand: boolean }[];
};

/** A student's own progress (Andy, 2026-11-09, 5A): their %, what they have done and what is left. No sign-in. */
export function ClassProgressPage() {
  const { orgId = '', token = '' } = useParams();
  const [p, setP] = useState<Progress | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    httpsCallable<Record<string, unknown>, Progress>(functions, 'classRegister')({ action: 'progress', orgId, token })
      .then((r) => setP(r.data))
      .catch(() => setError('This progress link is not working. Please ask the class leader for a new one.'));
  }, [orgId, token]);

  if (error) return <div className="center-card welcome-card"><h1>My progress</h1><p>{error}</p></div>;
  if (!p) return <div className="splash" aria-busy="true"><span className="splash-mark" />Loading…</div>;
  const left = p.topics.filter((t) => !t.done);
  const time = clockLabel(p.classTime);

  return (
    <div className="center-card welcome-card class-progress">
      <img src="/org/freedom-church-logo.png" alt="" width={72} height={72} />
      <h1>{p.firstName}'s {p.programme}</h1>
      <p className="class-pct">{p.percent}%</p>
      <span className="progress" aria-hidden="true"><span style={{ width: `${p.percent}%` }} /></span>
      <p className="muted">{p.done} of {p.total} topics done{p.graduated ? ' · Ready to graduate 🎓' : ''}</p>
      {p.next && !p.graduated && <p className="notice">Next class: <strong>{formatDateKey(p.next.date)}{time ? `, ${time}` : ''}</strong> · {p.next.topic}</p>}
      {left.length > 0 && !p.graduated && <p className="muted small">Missed a topic? Ask the class leader about a make-up class. Every topic is needed to graduate.</p>}
      <ol className="class-topics">
        {p.topics.map((t) => (
          <li key={t.name} className={t.done ? 'done' : ''}>
            <span className="class-tick" aria-hidden="true">{t.done ? '✓' : ''}</span>
            <span>
              <strong>{t.name}</strong>
              <small className="muted">{t.done ? `Done ${formatDateKey(t.done)}${t.byHand ? ' (caught up)' : ''}` : t.planned ? `${t.label} · ${formatDateKey(t.planned)}` : 'Still to do'}</small>
            </span>
          </li>
        ))}
      </ol>
      <p className="muted small">{p.church}</p>
    </div>
  );
}
