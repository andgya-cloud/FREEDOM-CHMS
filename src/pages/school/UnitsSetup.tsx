import { useMemo, useState } from 'react';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { useExamAccess, useExamSettings, type ExamSheetRow } from '../../state/useExams';
import { deleteExamSheet, logExam, saveExamSheetDetails, saveExamUnits } from '../../lib/examWrites';
import { ADIA_BANDS } from '../../../functions/src/shared/exams';
import {
  ADIA_UNITS, UNIT_DEPTS, UNIT_DEPT_NAMES, UNIT_KINDS, UNIT_KIND_LABELS, guessUnitDept, semesterHoursWithDefaults, sheetsThatDontFit, unitDeptOf, unitKey, unitLabel,
  unitProblem, unitTitle, unitsFor, unitsWithDefaults, type FitProblem, type UnitDept, type UnitItem, type UnitKind,
} from '../../../functions/src/shared/units';
import type { Organization } from '../../state/OrgContext';

type Dept = UnitDept | 'common';
const deptName = (d: Dept) => (d === 'common' ? 'Common units' : UNIT_DEPT_NAMES[d]);
const num = (v: string): number | null => { const t = v.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const sumCredits = (list: UnitItem[]) => Math.round(list.reduce((a, x) => a + (x.credit ?? 0), 0) * 10) / 10;

/**
 * Setup › Units (Andy, 2026-11-20, 1A-15A): ADIA's units from the SEMESTER UNITS list, per department and
 * semester, with code, Theory or Practical, credit and hours; the A to E grades; which app department is
 * which; and the cohort's marks sheets that don't fit the list, to move or remove.
 */
export function UnitsSetup({ org, cohort, closed, sheets, courses }: {
  org: Organization; cohort: string; closed: boolean; sheets: ExamSheetRow[]; courses: { id: string; name: string }[];
}) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings, exists } = useExamSettings(org.id);
  const saved = useMemo(() => unitsWithDefaults(settings.units), [settings.units]);
  const savedHours = useMemo(() => semesterHoursWithDefaults(settings.semesterHours), [settings.semesterHours]);
  const [draft, setDraft] = useState<UnitItem[] | null>(null);
  const [hours, setHours] = useState<typeof savedHours | null>(null);
  const [dept, setDept] = useState<UnitDept>('it');
  // Bumped on Cancel so the boxes show the saved figures again.
  const [ver, setVer] = useState(0);
  const units = draft ?? saved;
  const semHours = hours ?? savedHours;
  const deptOf = (id: string) => unitDeptOf(id, courses.find((c) => c.id === id)?.name ?? '', settings.unitDepartments);
  const log = (detail: string, sheetId: string | null = null) => void logExam(org.id, { action: 'units', cohort: sheetId ? cohort : 'All cohorts', sheetId, detail, byName: a.myName });

  const edit = (x: UnitItem, changes: Partial<UnitItem>) => setDraft(units.map((y) => (y === x ? { ...y, ...changes } : y)));
  function save() {
    for (const x of units) { const p = unitProblem(x, units); if (p) return toast.show(p); }
    for (const d of UNIT_DEPTS) for (const h of [semHours[d][1], semHours[d][2]]) if (h != null && !(h >= 0 && h <= 5000)) return toast.show(`${UNIT_DEPT_NAMES[d]}: semester hours must be a number from 0 to 5000.`);
    const clean = units.map((x) => ({ ...x, code: x.code.trim().toUpperCase().replace(/\s+/g, ' '), name: x.name.trim().slice(0, 120) }));
    saveExamUnits(org.id, exists, settings, { units: clean, semesterHours: semHours }).then(() => toast.show('Units saved.'), (err) => toast.show(friendlyError(err)));
    log(`Saved the units list (${clean.length} units)`);
    setDraft(null); setHours(null);
  }
  function linkDepartment(courseId: string, value: string) {
    const next = { ...(settings.unitDepartments ?? {}), [courseId]: value };
    saveExamUnits(org.id, exists, settings, { unitDepartments: next }).then(() => toast.show('Saved.'), (err) => toast.show(friendlyError(err)));
    log(`${courses.find((c) => c.id === courseId)?.name}: ${value === 'none' ? 'not on the units list' : UNIT_DEPT_NAMES[value as UnitDept]}`);
  }

  const own = (s: 1 | 2) => units.filter((x) => x.dept === dept && x.semester === s);
  const shared = (s: 1 | 2) => unitsFor(units, dept, s).filter((x) => x.dept === 'common');
  const missingCredit = units.filter((x) => x.credit == null && (x.dept === 'common' || units.some((y) => y.dept === x.dept)));
  const dirty = !!draft || !!hours;
  const misfits = useMemo(() => sheetsThatDontFit(sheets.map((s) => ({ ...s, hasMarks: hasMarks(s) })), saved, deptOf), [sheets, saved, settings.unitDepartments, courses]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (x: UnitItem) => (
    <tr key={unitKey(x)}>
      <td className="nowrap">{x.code}</td>
      <td>{x.name}{x.dept === 'common' && <div className="muted small">Common unit{x.only?.length ? ` · ${x.only.map((d) => UNIT_DEPT_NAMES[d]).join(', ')} only` : ''}</div>}</td>
      <td>{UNIT_KIND_LABELS[x.kind]}</td>
      <td>
        <input className="exam-att" inputMode="decimal" aria-label={`Credit for ${x.code}`} placeholder="fill in" defaultValue={x.credit ?? ''} key={`c${ver}-${x.credit}`}
          onBlur={(e) => { const v = num(e.target.value); if (v !== x.credit) edit(x, { credit: v }); }} />
        {x.credit == null && <span className="badge badge-warn unit-fill">fill in</span>}
      </td>
      <td><input className="exam-att" inputMode="numeric" aria-label={`Hours for ${x.code}`} placeholder="–" defaultValue={x.hours ?? ''} key={`h${ver}-${x.hours}`}
        onBlur={(e) => { const v = num(e.target.value); if (v !== x.hours) edit(x, { hours: v }); }} /></td>
      <td>{x.dept !== 'common' && <button type="button" className="btn btn-quiet btn-small" onClick={() => { if (window.confirm(`Take ${unitTitle(x)} off the units list?`)) setDraft(units.filter((y) => y !== x)); }}>Remove</button>}</td>
    </tr>
  );

  return (
    <section className="stack">
      <section className="card stack">
        <div className="card-head"><h2>Units</h2>{dirty && <span className="badge badge-warn">Not saved</span>}</div>
        <p className="muted small">ADIA's units from the Semester Units list: code, unit, credit and hours. New cohorts get their marks sheets from here, and semester points weight each unit by its credit.</p>
        <div className="unit-grades" aria-label="Grades">
          {ADIA_BANDS.map((b, i) => <span key={b.grade}><strong>{b.grade}</strong> {b.min}–{i === 0 ? 100 : ADIA_BANDS[i - 1]!.min - 1}{b.grade === 'E' ? ' · fail' : ''}</span>)}
        </div>
        <p className="muted small">D and above passes. The final result shows Honours from the average of both semesters: Distinction (A), Credit (B or C) or Pass (D).</p>
        <label className="field"><span>Department</span>
          <select value={dept} onChange={(e) => setDept(e.target.value as UnitDept)}>{UNIT_DEPTS.map((d) => <option key={d} value={d}>{UNIT_DEPT_NAMES[d]}</option>)}</select>
        </label>
        {!units.some((x) => x.dept === dept) && <p className="notice small">No {UNIT_DEPT_NAMES[dept]} units yet. Add them below; until then {UNIT_DEPT_NAMES[dept]} keeps its own courses.</p>}
        {([1, 2] as const).map((s) => {
          const list = [...own(s), ...shared(s)];
          if (!own(s).length && !units.some((x) => x.dept === dept)) return null;
          return (
            <div key={s} className="stack">
              <strong className="small">Semester {s === 1 ? 'I' : 'II'}</strong>
              <div className="exam-table-wrap">
                <table className="table unit-table">
                  <thead><tr><th>Code</th><th>Unit</th><th>Type</th><th>Credit</th><th>Hours</th><th /></tr></thead>
                  <tbody>
                    {list.map(row)}
                    <tr className="unit-total">
                      <td /><td>Semester total</td><td /><td>{sumCredits(list)}</td>
                      <td colSpan={2}>
                        <input className="exam-att" inputMode="numeric" aria-label={`Semester ${s} hours`} defaultValue={semHours[dept][s] ?? ''} key={`s${ver}-${dept}-${semHours[dept][s]}`}
                          onBlur={(e) => { const v = num(e.target.value); if (v !== semHours[dept][s]) setHours({ ...semHours, [dept]: { ...semHours[dept], [s]: v } }); }} /> hours
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        <AddUnit dept={dept} onAdd={(x) => { const next = [...units, x]; const p = unitProblem(x, next); if (p) { toast.show(p); return false; } setDraft(next); return true; }} />
        {missingCredit.length > 0 && <p className="small muted">{missingCredit.length} {missingCredit.length === 1 ? 'unit has' : 'units have'} no credit yet ({missingCredit.slice(0, 6).map((x) => x.code).join(', ')}{missingCredit.length > 6 ? '…' : ''}). Until a department's credits are all in, its semester points are the plain average.</p>}
        <div className="row-actions">
          <button type="button" className="btn btn-primary" disabled={!dirty} onClick={save}>Save units</button>
          {dirty && <button type="button" className="btn btn-quiet" onClick={() => { setDraft(null); setHours(null); setVer(ver + 1); }}>Cancel</button>}
          {!dirty && settings.units && <button type="button" className="btn btn-quiet" onClick={() => { if (window.confirm('Put back the units exactly as the documents give them? Your changes to credits and hours go.')) { setDraft(ADIA_UNITS); setVer(ver + 1); } }}>Start again from the documents</button>}
        </div>
        <details className="small">
          <summary>Which department is which ({courses.map((c) => `${c.name}: ${deptOf(c.id) ? UNIT_DEPT_NAMES[deptOf(c.id)!] : 'not linked'}`).join(' · ')})</summary>
          <div className="stack unit-links">
            {courses.map((c) => (
              <label key={c.id} className="field"><span>{c.name}</span>
                <select value={settings.unitDepartments?.[c.id] ?? guessUnitDept(c.name) ?? 'none'} onChange={(e) => linkDepartment(c.id, e.target.value)}>
                  {UNIT_DEPTS.map((d) => <option key={d} value={d}>{UNIT_DEPT_NAMES[d]}</option>)}
                  <option value="none">Not on the units list</option>
                </select>
              </label>
            ))}
          </div>
        </details>
      </section>
      {cohort && <Misfits org={org} cohort={cohort} closed={closed} misfits={misfits} units={saved} deptOf={deptOf} courses={courses} log={log} />}
    </section>
  );
}

const hasMarks = (s: ExamSheetRow) => Object.values(s.marks ?? {}).some((m) => m && Object.values(m).some((v) => v != null));

function AddUnit({ dept, onAdd }: { dept: UnitDept; onAdd: (x: UnitItem) => boolean }) {
  const blank = { where: dept as Dept, code: '', name: '', kind: 'theory' as UnitKind, semester: '1', credit: '', hours: '' };
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn btn-quiet align-start" onClick={() => { setF({ ...blank, where: dept }); setOpen(true); }}>+ Add a unit</button>;
  function add() {
    const credit = num(f.credit), hours = num(f.hours);
    const x: UnitItem = { code: f.code.trim().toUpperCase(), name: f.name.trim(), kind: f.kind, dept: f.where, semester: f.semester === '2' ? 2 : 1, credit, hours };
    if (onAdd(x)) setF({ ...f, code: '', name: '', credit: '', hours: '' });
  }
  return (
    <div className="stack exam-add">
      <div className="form-grid">
        <label className="field"><span>Department</span>
          <select value={f.where} onChange={(e) => setF({ ...f, where: e.target.value as Dept })}>
            {UNIT_DEPTS.map((d) => <option key={d} value={d}>{deptName(d)}</option>)}<option value="common">{deptName('common')}</option>
          </select>
        </label>
        <label className="field"><span>Code</span><input value={f.code} maxLength={12} placeholder="e.g. CSM 100" onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
        <label className="field"><span>Unit</span><input value={f.name} maxLength={120} placeholder="e.g. Hair Dressing" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Type</span>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as UnitKind })}>{UNIT_KINDS.map((k) => <option key={k} value={k}>{k === 'unit' ? 'Neither' : UNIT_KIND_LABELS[k]}</option>)}</select>
        </label>
        <label className="field"><span>Semester</span>
          <select value={f.semester} onChange={(e) => setF({ ...f, semester: e.target.value })}><option value="1">Semester I</option><option value="2">Semester II</option></select>
        </label>
        <label className="field"><span>Credit</span><input inputMode="decimal" value={f.credit} placeholder="e.g. 1.4" onChange={(e) => setF({ ...f, credit: e.target.value })} /></label>
        <label className="field"><span>Hours</span><input inputMode="numeric" value={f.hours} placeholder="optional" onChange={(e) => setF({ ...f, hours: e.target.value })} /></label>
      </div>
      <div className="row-actions"><button type="button" className="btn btn-primary" onClick={add}>Add unit</button><button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Done</button></div>
      <p className="muted small">Added units are kept once you press Save units.</p>
    </div>
  );
}

function Misfits({ org, cohort, closed, misfits, units, deptOf, courses, log }: {
  org: Organization; cohort: string; closed: boolean; misfits: { sheet: { id: string; courseName: string; courseId: string | null; semester?: number | null; hasMarks: boolean }; problem: FitProblem }[];
  units: UnitItem[]; deptOf: (id: string) => UnitDept | null; courses: { id: string; name: string }[]; log: (detail: string, sheetId: string | null) => void;
}) {
  const toast = useToast();
  const where = (courseId: string | null) => (courseId == null ? 'Common' : courses.find((c) => c.id === courseId)?.name ?? '');
  function move(id: string, name: string, unit: UnitItem) {
    saveExamSheetDetails(org.id, id, { semester: unit.semester, unitCode: unit.code }).catch((err) => toast.show(friendlyError(err)));
    log(`${name}: set to ${unit.code}, Semester ${unit.semester}`, id);
    toast.show(`${name} is now ${unit.code}, Semester ${unit.semester}. Marks are kept.`);
  }
  function remove(id: string, name: string, marks: boolean) {
    if (!window.confirm(`Remove ${name}${marks ? ' and the marks keyed in' : ''}? It can be restored from the bin within 30 days.`)) return;
    deleteExamSheet(org.id, id).catch((err) => toast.show(friendlyError(err)));
    log(`Removed ${name}: the unit is already in the cohort`, id);
  }
  return (
    <section className="card stack">
      <div className="card-head"><h2>Marks sheets that don't fit · {cohort}</h2><span className="muted small">{misfits.length || 'None'}</span></div>
      {misfits.length === 0 ? <p className="muted small">Every marks sheet of {cohort} is a unit on the list, in its semester.</p> : <>
        <p className="muted small">Common units now belong to one semester. Moving a sheet keeps its marks.</p>
        <div className="exam-table-wrap">
          <table className="table">
            <thead><tr><th>Marks sheet</th><th>Now</th><th>Should be</th><th /></tr></thead>
            <tbody>
              {misfits.map(({ sheet: s, problem: p }) => {
                const choices = s.courseId == null ? units.filter((x) => x.dept === 'common') : units.filter((x) => x.dept === deptOf(s.courseId!));
                return (
                  <tr key={s.id}>
                    <td>{s.courseName}<div className="muted small">{where(s.courseId)}{s.hasMarks ? ' · has marks' : ''}</div></td>
                    <td>{s.semester ? `Semester ${s.semester}` : 'No semester'}</td>
                    <td>{p.kind === 'semester' ? `Semester ${p.to} (${p.unit.code})` : p.kind === 'duplicate' ? `${p.unit.code} is already in Semester ${p.unit.semester}` : 'Not on the units list'}</td>
                    <td>
                      {closed ? null : p.kind === 'semester' ? <button type="button" className="btn btn-primary btn-small" onClick={() => move(s.id, s.courseName, p.unit)}>Move to Semester {p.to}</button>
                        : p.kind === 'duplicate' ? <button type="button" className="btn btn-quiet btn-small" onClick={() => remove(s.id, s.courseName, s.hasMarks)}>Remove</button>
                        : (
                          <select aria-label={`Which unit is ${s.courseName}?`} value="" onChange={(e) => { const u = choices.find((x) => unitKey(x) === e.target.value); if (u) move(s.id, s.courseName, u); }}>
                            <option value="">Which unit is this?</option>
                            {choices.map((x) => <option key={unitKey(x)} value={unitKey(x)}>{x.code} · {unitLabel(x)} · Sem {x.semester}</option>)}
                          </select>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">A sheet that is not on the units list still counts in its semester, without a credit, so that semester uses the plain average until it is matched.</p>
      </>}
    </section>
  );
}
