import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { downloadFile } from '../../lib/givingPdf';
import { childrenListExcel, qrCardsPdf } from '../../lib/hopeAttendanceFiles';
import { canKeepFees, canReadNotes } from '../../../functions/src/shared/hopeRecords';
import { feesOwing } from '../../lib/hopeRecords';
import { useChildPhotos, useHopeDays } from '../../state/useHope';
import { consentMissing, isCurrentChild, normalizeCode } from '../../../functions/src/shared/hope';
import { birthdayThisWeek, kidRate, missedSaturdays, streak } from '../../../functions/src/shared/hopeRegister';
import { HopeGate, useHopePage } from './common';
import { Avatar, Delights, PctBadge } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function ChildrenPage() {
  return <HopeGate title="Children">{(org) => <Children org={org} />}</HopeGate>;
}

type Show = 'current' | 'departing' | 'exited' | 'consent' | 'nosponsor' | 'birthdays' | 'missed' | 'owing' | 'concerns' | 'all';
type Sort = 'name' | 'age' | 'pct' | 'code';

/**
 * The children as photo cards (Andy, 2026-11-04, 6A), with one dropdown to choose who is shown and one to sort.
 */
function Children({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { can, profile } = useAuth();
  const toast = useToast();
  const lists = canReadNotes(profile, org.id);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const { days } = useHopeDays(org.id);
  const photos = useChildPhotos(org.id);
  const legacy = params.get('consent') === 'missing' ? 'consent' : null;
  const show = ((legacy ?? params.get('show')) || 'current') as Show;
  const [owing, setOwing] = useState<Set<string> | null>(null);
  useEffect(() => { if (show === 'owing' && !owing && canKeepFees(profile, org.id)) feesOwing(org.id).then((r) => setOwing(new Set(r.owing.map((o) => o.childId))), (err) => toast.show(friendlyError(err))); }, [show, owing, profile, org.id, toast]);
  const concernIds = useMemo(() => new Set(h.openConcerns.map((c) => c.childId)), [h.openConcerns]);

  const SHOWS: [Show, string, boolean][] = [
    ['current', 'Current children', true], ['departing', 'Departing', true], ['exited', 'Past children', true],
    ['consent', 'Consent missing', true], ['nosponsor', 'No sponsor yet', true], ['birthdays', 'Birthdays this week', true],
    ['missed', 'Missed the last 3 Saturdays', true], ['owing', 'Fees still to pay this term', canKeepFees(profile, org.id)],
    ['concerns', 'Safeguarding concern open', h.pastoral], ['all', 'Everyone', true],
  ];
  const fits = (c: (typeof h.children)[number]) => {
    switch (show) {
      case 'current': return isCurrentChild(c);
      case 'departing': return c.status === 'departing';
      case 'exited': return c.status === 'exited';
      case 'consent': return consentMissing(c);
      case 'nosponsor': return isCurrentChild(c) && !c.sponsorName;
      case 'birthdays': return isCurrentChild(c) && birthdayThisWeek(c.dateOfBirth, h.today);
      case 'missed': return isCurrentChild(c) && missedSaturdays(c.id, c.enrolledOn, days);
      case 'owing': return isCurrentChild(c) && !!owing?.has(c.id);
      case 'concerns': return concernIds.has(c.id);
      default: return true;
    }
  };

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    const code = normalizeCode(q);
    const list = h.children
      .filter(fits)
      .map((c) => ({ c, name: h.nameOf(c.id), age: h.ageOf(c), rate: kidRate(c.id, days).pct, fire: streak(c.id, days) }))
      .filter(({ c, name }) => !text || name.toLowerCase().includes(text) || (c.code ?? '').toLowerCase().includes(text) || (!!code && c.code === code));
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      age: (a, b) => (a.age ?? 99) - (b.age ?? 99) || a.name.localeCompare(b.name),
      pct: (a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.name.localeCompare(b.name),
      code: (a, b) => (a.c.code ?? 'ZZ').localeCompare(b.c.code ?? 'ZZ'),
    };
    return list.sort(by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.children, h.nameOf, q, show, sort, days, concernIds, owing]);

  async function cards() {
    setBusy(true);
    try { downloadFile(await qrCardsPdf(org, rows.filter(({ c }) => !!c.code).map(({ c, name }) => ({ name, code: c.code! })))); }
    catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
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
          {lists && <button type="button" className="btn" disabled={busy || !rows.length} onClick={() => void listExcel()}>⬇︎ Children list</button>}
          {(lists || can('people.write')) && <button type="button" className="btn" disabled={busy || !rows.length} onClick={() => void cards()} title="Cards with a QR code to check children in at the door">🪪 QR cards</button>}
          {can('people.write') && <><Link to="/hope/children/import" className="btn">⬆︎ Excel</Link><Link to="/hope/children/photos" className="btn">📷 Photos</Link><Link to="/hope/children/new" className="btn btn-primary">Register a child</Link></>}
        </div>
      </div>
      <div className="hc-tools">
        <input type="search" className="search" placeholder="Find by name or code, for example HC-0042" aria-label="Find a child" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="field"><span>Show</span>
          <select value={show} onChange={(e) => setParams(e.target.value === 'current' ? {} : { show: e.target.value }, { replace: true })}>
            {SHOWS.filter((s) => s[2]).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="field"><span>Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="name">Name</option><option value="age">Age</option><option value="pct">Attendance %</option><option value="code">Code</option>
          </select>
        </label>
      </div>
      <p className="small muted">{rows.length} {rows.length === 1 ? 'child' : 'children'}</p>
      {h.loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card"><p>No children match. {h.children.length === 0 && 'Register the first child with the button above.'}</p></div> : (
        <ul className="hc-grid">
          {rows.map(({ c, name, age, rate, fire }) => (
            <li key={c.id}>
              <Link to={`/hope/children/${c.id}`} className={`card hc-card${c.status !== 'active' ? ` s-${c.status}` : ''}`}>
                <span className="hc-photo"><Avatar photo={c.photoConsent?.given ? photos.get(c.id) : null} name={name} size={72} /></span>
                <span className="hc-badges"><Delights birthday={birthdayThisWeek(c.dateOfBirth, h.today)} streak={fire} /><PctBadge pct={rate} /></span>
                <b className="hc-name">{name}</b>
                <span className="small muted">{h.codeOf(c)}{age != null ? ` · ${age} years` : ''}</span>
                {c.sponsorName && <span className="small">Sponsor: {c.sponsorName}</span>}
                <span className="hc-flags">
                  {c.status === 'departing' && <span className="badge badge-warn">Departing</span>}
                  {c.status === 'exited' && <span className="badge badge-muted">Departed</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
