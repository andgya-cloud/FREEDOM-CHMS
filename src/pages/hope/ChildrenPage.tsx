import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { downloadFile } from '../../lib/givingPdf';
import { childrenListExcel, qrCardsPdf } from '../../lib/hopeAttendanceFiles';
import { canKeepFees, canReadNotes } from '../../../functions/src/shared/hopeRecords';
import { feesOwing } from '../../lib/hopeRecords';
import { useChildPhotos, useClubs, useHopeDays } from '../../state/useHope';
import { sponsorUpdatePdf } from '../../lib/sponsorUpdate';
import { sponsorPage } from './sponsorPages';
import { ClassChip } from '../../components/Stone';
import { classLabel, classOf, hasAllergy, HOPE_CLASSES, type HopeClassId } from '../../../functions/src/shared/hopeClasses';
import { consentMissing, isCurrentChild, normalizeCode } from '../../../functions/src/shared/hope';
import { birthdayThisWeek, kidRate, missedSaturdays, streak } from '../../../functions/src/shared/hopeRegister';
import { HopeGate, useHopePage } from './common';
import { childWarning, WARNING_LABEL } from '../../../functions/src/shared/hopeWarning';
const RANK = { green: 0, amber: 1, red: 2 } as const;
import { ConsentTicks } from './ConsentPage';
import { MissedActions } from './HopeTodayBoard';
import { Avatar, Delights, PctBadge } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function ChildrenPage() {
  return <HopeGate title="Children">{(org) => <Children org={org} />}</HopeGate>;
}

type Show = 'red' | 'amber' | 'current' | 'departing' | 'exited' | 'consent' | 'nosponsor' | 'birthdays' | 'missed' | 'owing' | 'concerns' | 'all' | 'allergies' | 'noclass' | 'notonlist' | `class-${HopeClassId}`;
type Sort = 'name' | 'age' | 'pct' | 'code' | 'need';

/**
 * The children as photo cards (Andy, 2026-11-04, 6A), with one dropdown to choose who is shown and one to sort.
 */
function Children({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { can, profile } = useAuth();
  const toast = useToast();
  const lists = canReadNotes(profile, org.id);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [sort, setSort] = useState<Sort>('name');
  const { days } = useHopeDays(org.id);
  const photos = useChildPhotos(org.id);
  const clubs = useClubs(org.id);
  const legacy = params.get('consent') === 'missing' ? 'consent' : null;
  const show = ((legacy ?? params.get('show')) || 'current') as Show;
  const [owing, setOwing] = useState<Set<string> | null>(null);
  useEffect(() => { if (!owing && canKeepFees(profile, org.id)) feesOwing(org.id).then((r) => setOwing(new Set(r.owing.map((o) => o.childId))), (err) => toast.show(friendlyError(err))); }, [owing, profile, org.id, toast]);
  const concernIds = useMemo(() => new Set(h.openConcerns.map((c) => c.childId)), [h.openConcerns]);

  // The Show list in three groups (v182, 8A).
  const SHOWS: [string, [Show, string, boolean][]][] = [
    ['Children', [['current', 'Current children', true], ['departing', 'Departing', true], ['exited', 'Past children', true], ['all', 'Everyone', true]]],
    ['Needs something', [
      ['red', '🔴 Needs us', true], ['amber', '🟠 Watch', true], ['consent', 'Consent missing', true], ['missed', 'Missed the last 3 Saturdays', true], ['owing', 'Fees still to pay this term', canKeepFees(profile, org.id)],
      ['nosponsor', 'No sponsor yet', true], ['notonlist', 'Not on KE-014', true], ['concerns', 'Safeguarding concern open', h.pastoral],
      ['allergies', 'Allergies', true], ['birthdays', 'Birthdays this week', true],
    ]],
    // The classes by age, each with its stone (Andy, 2026-11-05, 5A).
    ['Classes', [...HOPE_CLASSES.map((k): [Show, string, boolean] => [`class-${k.id}`, classLabel(k), true]), ['noclass', 'No class yet (birth date missing)', true]]],
  ];
  // The early warning dot (v182, 14A).
  const warn = (c: (typeof h.children)[number]) => childWarning(c, days, { urgent: concernIds.has(c.id), owing: !!owing?.has(c.id) });
  const fits = (c: (typeof h.children)[number]) => {
    switch (show) {
      case 'current': return isCurrentChild(c);
      case 'red': return isCurrentChild(c) && warn(c).level === 'red';
      case 'amber': return isCurrentChild(c) && warn(c).level === 'amber';
      case 'departing': return c.status === 'departing';
      case 'exited': return c.status === 'exited';
      case 'consent': return consentMissing(c);
      case 'nosponsor': return isCurrentChild(c) && !c.sponsorName;
      case 'notonlist': return isCurrentChild(c) && !c.sponsorship?.childId;
      case 'birthdays': return isCurrentChild(c) && birthdayThisWeek(c.dateOfBirth, h.today);
      case 'missed': return isCurrentChild(c) && missedSaturdays(c.id, c.enrolledOn, days);
      case 'owing': return isCurrentChild(c) && !!owing?.has(c.id);
      case 'concerns': return concernIds.has(c.id);
      case 'allergies': return isCurrentChild(c) && hasAllergy(c.allergies);
      case 'noclass': return isCurrentChild(c) && !classOf(c.dateOfBirth, h.today);
      case 'all': return true;
      default: return isCurrentChild(c) && `class-${classOf(c.dateOfBirth, h.today)?.id}` === show;
    }
  };

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    const code = normalizeCode(q);
    const digits = text.replace(/\D/g, '').replace(/^254/, '0');
    const list = h.children
      .filter(fits)
      .map((c) => ({ c, name: h.nameOf(c.id), age: h.ageOf(c), rate: kidRate(c.id, days).pct, fire: streak(c.id, days), w: warn(c) }))
      .filter(({ c, name }) => !text || name.toLowerCase().includes(text) || (c.code ?? '').toLowerCase().includes(text) || (!!code && c.code === code)
        || (digits.length >= 4 && (c.parentPhone ?? '').replace(/\D/g, '').replace(/^254/, '0').includes(digits)));
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      age: (a, b) => (a.age ?? 99) - (b.age ?? 99) || a.name.localeCompare(b.name),
      pct: (a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.name.localeCompare(b.name),
      code: (a, b) => (a.c.code ?? 'ZZ').localeCompare(b.c.code ?? 'ZZ'),
      need: (a, b) => RANK[b.w.level] - RANK[a.w.level] || b.w.reasons.length - a.w.reasons.length || a.name.localeCompare(b.name),
    };
    return list.sort(by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.children, h.nameOf, q, show, sort, days, concernIds, owing]);

  async function cards() {
    setBusy(true);
    try { downloadFile(await qrCardsPdf(org, rows.filter(({ c }) => !!c.code).map(({ c, name, age }) => ({
      name, code: c.code!, age, klass: classOf(c.dateOfBirth, h.today), allergies: hasAllergy(c.allergies) ? c.allergies! : '', photo: c.photoConsent?.given ? photos.get(c.id) ?? null : null,
    })))); }
    catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }

  // One page per child shown who has a sponsor (v182, 13A).
  async function sponsorUpdates() {
    const list = rows.filter(({ c }) => c.status !== 'exited' && (c.sponsorName || c.sponsorship?.sponsorName));
    if (!list.length) { toast.show('None of the children shown has a sponsor.'); return; }
    setBusy(true);
    try {
      const pages = list.map(({ c, name, age }) => sponsorPage({ child: c, name, age, today: h.today, days, clubs: clubs.clubs, wins: clubs.wins, photo: photos.get(c.id) ?? null }));
      downloadFile(await sponsorUpdatePdf(org, pages, h.today.slice(0, 4)));
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }

  async function listExcel() {
    setBusy(true);
    const yn = (v: boolean | null | undefined) => (v == null ? 'Not on file' : v ? 'Yes' : 'No');
    try {
      downloadFile(await childrenListExcel(org, h.today, rows.map(({ c, name, age }) => {
        const p = h.byId(c.id);
        return { code: c.code ?? '', name, gender: p?.gender ?? '', dob: c.dateOfBirth ?? '', age: age != null ? String(age) : '', school: c.school ?? '', cls: c.schoolClass ?? '',
          parent: c.parentName ?? '', phone: c.parentPhone ?? '', sponsor: c.sponsorName ?? '', consent: yn(c.guardianConsent?.given), status: c.status === 'exited' ? 'Departed' : c.status === 'departing' ? 'Departing' : 'Active' };
      })));
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Children</h1>
        <div className="chips">
          {(lists || can('people.write')) && (
            <select className="hc-more" aria-label="More" value="" disabled={busy || !rows.length} onChange={(e) => {
              const v = e.target.value;
              if (v === 'list') void listExcel();
              else if (v === 'cards') void cards();
              else if (v === 'upload') navigate('/hope/upload');
              else if (v === 'sponsor') void sponsorUpdates();
            }}>
              <option value="" disabled>{busy ? 'Making…' : '⋯ More'}</option>
              {lists && <option value="list">⬇︎ Children list (Excel)</option>}
              <option value="cards">🪪 QR cards (PDF)</option>
              <option value="sponsor">📄 Sponsor updates (PDF)</option>
              {can('people.write') && <option value="upload">⬆︎ Upload a file or photos</option>}
            </select>
          )}
          {can('people.write') && <Link to="/hope/children/new" className="btn btn-primary">Register a child</Link>}
        </div>
      </div>
      {q && <p className="chips"><span className="chip chip-on">Search: {q}</span><button type="button" className="btn btn-quiet btn-small" onClick={() => { params.delete('q'); setParams(params, { replace: true }); }}>✕ Clear</button></p>}
      <div className="hc-tools">
        <label className="field"><span>Show</span>
          <select value={show} onChange={(e) => setParams(e.target.value === 'current' ? {} : { show: e.target.value }, { replace: true })}>
            {SHOWS.map(([group, list]) => <optgroup key={group} label={group}>{list.filter((x) => x[2]).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</optgroup>)}
          </select>
        </label>
        <label className="field"><span>Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="name">Name</option><option value="need">Needs us most</option><option value="age">Age</option><option value="pct">Attendance %</option><option value="code">Code</option>
          </select>
        </label>
      </div>
      <p className="small muted">{rows.length} {rows.length === 1 ? 'child' : 'children'}</p>
      {show === 'consent' ? <ConsentTicks org={org} q={q} /> : h.loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card"><p>No children match. {h.children.length === 0 && 'Register the first child with the button above.'}</p></div> : (
        <ul className="hc-grid">
          {rows.map(({ c, name, age, rate, fire, w }) => (
            <li key={c.id}>
              <Link to={`/hope/children/${c.id}`} className={`card hc-card${c.status !== 'active' ? ` s-${c.status}` : ''}`}>
                {c.status !== 'exited' && <span className={`hc-dot w-${w.level}`} title={`${WARNING_LABEL[w.level]}${w.reasons.length ? `: ${w.reasons.join('; ')}` : ''}`} aria-label={WARNING_LABEL[w.level]} />}
                <span className="hc-photo"><Avatar photo={c.photoConsent?.given ? photos.get(c.id) : null} name={name} size={72} /></span>
                <span className="hc-badges"><Delights birthday={birthdayThisWeek(c.dateOfBirth, h.today)} streak={fire} /><PctBadge pct={rate} /></span>
                <b className="hc-name">{name}</b>
                <span className="small muted">{h.codeOf(c)}{age != null ? ` · ${age} years` : ''}</span>
                <ClassChip c={classOf(c.dateOfBirth, h.today)} size={16} />
                {hasAllergy(c.allergies) && <span className="badge badge-warn">⚠️ Allergy</span>}
                {c.sponsorName && <span className="small">Sponsor: {c.sponsorName}</span>}
                <span className="hc-flags">
                  {c.status === 'departing' && <span className="badge badge-warn">Departing</span>}
                  {c.status === 'exited' && <span className="badge badge-muted">Departed</span>}
                </span>
              </Link>
              {show === 'missed' && <MissedActions orgId={org.id} child={c} name={name} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
