import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { saveSchoolSettings } from '../../lib/schoolWrites';
import { ASSESSMENT_TYPE_LABELS, ASSESSMENT_TYPES, type GradeBand } from '../../../functions/src/shared/school';
import { SchoolGate, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function SchoolSettingsPage() {
  return <SchoolGate title="School settings">{(org) => <Settings org={org} />}</SchoolGate>;
}

function Settings({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const toast = useToast();
  const [scale, setScale] = useState<{ min: string; grade: string }[]>([]);
  const [passMark, setPassMark] = useState('');
  const [threshold, setThreshold] = useState('');
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [director, setDirector] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (s.loading || loaded) return;
    setScale(s.settings.gradingScale.map((b) => ({ min: String(b.min), grade: b.grade })));
    setPassMark(String(s.settings.passMark));
    setThreshold(String(s.settings.attendanceThreshold));
    setWeights(Object.fromEntries(ASSESSMENT_TYPES.map((t) => [t, String(s.settings.weights[t])])));
    setDirector(s.settings.director ?? '');
    setLoaded(true);
  }, [s.loading, loaded, s.settings]);

  function save() {
    setError('');
    const bands: GradeBand[] = scale.filter((b) => b.grade.trim()).map((b) => ({ min: Number(b.min), grade: b.grade.trim().slice(0, 30) }));
    if (bands.some((b) => !Number.isFinite(b.min) || b.min < 0 || b.min > 100) || !bands.some((b) => b.min === 0)) return setError('Each grade needs a starting mark from 0 to 100, and one grade must start at 0.');
    const pm = Number(passMark);
    const th = Number(threshold);
    if (!(pm >= 0 && pm <= 100) || !(th >= 0 && th <= 100)) return setError('The pass mark and attendance threshold must be between 0 and 100.');
    const w = Object.fromEntries(ASSESSMENT_TYPES.map((t) => [t, Number(weights[t])])) as Record<(typeof ASSESSMENT_TYPES)[number], number>;
    if (ASSESSMENT_TYPES.some((t) => !(w[t] >= 0 && w[t] <= 100)) || ASSESSMENT_TYPES.every((t) => w[t] === 0)) return setError('Weights must be between 0 and 100, and not all zero.');
    saveSchoolSettings(org.id, { gradingScale: bands, passMark: pm, attendanceThreshold: th, weights: w, director: director.trim().slice(0, 80) }, s.settingsSaved)
      .catch((err) => toast.show(friendlyError(err)));
    toast.show('School settings saved');
  }

  return (
    <div className="page narrow">
      <p><Link to="/school">← {org.name}</Link></p>
      <h1>School settings</h1>
      <section className="card stack">
        <h2>Grading scale</h2>
        <p className="small muted">A mark gets the grade of the highest band it reaches.</p>
        {scale.map((b, i) => (
          <div key={i} className="field-row">
            <label className="field"><span>From mark</span><input type="number" inputMode="numeric" value={b.min} onChange={(e) => setScale((l) => l.map((x, n) => (n === i ? { ...x, min: e.target.value } : x)))} /></label>
            <label className="field"><span>Grade</span><input value={b.grade} onChange={(e) => setScale((l) => l.map((x, n) => (n === i ? { ...x, grade: e.target.value } : x)))} /></label>
            <button type="button" className="btn btn-quiet danger-text align-start" onClick={() => setScale((l) => l.filter((_, n) => n !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn btn-quiet align-start" onClick={() => setScale((l) => [...l, { min: '', grade: '' }])}>Add a grade</button>
        <label className="field"><span>Pass mark (%)</span><input type="number" inputMode="numeric" value={passMark} onChange={(e) => setPassMark(e.target.value)} /></label>
      </section>
      <section className="card stack">
        <h2>How much each kind of assessment counts</h2>
        <p className="small muted">Within a unit. If a unit has no marks of one kind yet, the others are scaled to fit.</p>
        <div className="field-row">
          {ASSESSMENT_TYPES.map((t) => (
            <label key={t} className="field"><span>{ASSESSMENT_TYPE_LABELS[t]} (%)</span><input type="number" inputMode="numeric" value={weights[t] ?? ''} onChange={(e) => setWeights((w) => ({ ...w, [t]: e.target.value }))} /></label>
          ))}
        </div>
      </section>
      <section className="card stack">
        <h2>Attendance and reports</h2>
        <label className="field"><span>Alert when a student's attendance falls below (%)</span><input type="number" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></label>
        <label className="field"><span>Director's name (shown on reports)</span><input value={director} onChange={(e) => setDirector(e.target.value)} /></label>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="btn btn-primary btn-block" disabled={!loaded} onClick={save}>Save settings</button>
    </div>
  );
}
