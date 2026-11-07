import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { downloadFile } from '../../lib/givingPdf';
import {
  approveStory, removeStoryFile, restoreStoryFile, setFace, setFollowUp, setStoryStatus, storyChildren,
  deletePhotoReport, editStoryMessage, emailStoryPdf, isPhotoFile, isStoryFile, isVideoFile, listPhotoReports, loadBoard, markDecision, openStory,
  photoFile, restorePhotoReport, saveStorySummary, sayInStory, startStory, STORY_ACCEPT, storyPeople, unsayStoryMessage,
  type BoardPerson, type PhotoList, type StoredPhotoReport, type StoryOpen,
} from '../../lib/hopePhotos';
import { hopeStoryPdf } from '../../lib/hopeStoryPdf';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { chatRole, chatTime } from '../../../functions/src/shared/hopeChats';
import {
  incidentRows, MAX_PHOTO_FILES, PHOTO_REPORT_EMOJI, PHOTO_TEXT_MAX, PHOTO_TITLE_MAX,
  STORY_FILES_MAX, STORY_TEXT_MAX, storyStartWhatsApp, storyTimeline, storyTint, UNSAY_MINUTES,
  type IncidentDetails, type PhotoFile, type PhotoReportKind, type StoryMessage,
  APPROVAL_LABELS, builtInFace, faceKey, FOLLOW_UP_HOURS, SEVERITY_LABELS, STORY_CHILDREN_MAX, STORY_STATUS_LABELS, STORY_STATUSES,
  type ApprovalSlot, type Severity, type StoryChild, type StoryStatus,
} from '../../../functions/src/shared/hopePhotos';
import { useIsAndy } from '../../lib/andy';
import { myOwnProof, passwordProof } from '../../lib/pettyPin';
import type { Organization } from '../../state/OrgContext';
import { HopeGate, useHopePage } from './common';
import { CircleGate, circlePageFor, isOneItem, type CirclePage } from '../../components/CircleGate';
import { useOrg } from '../../state/OrgContext';
import { circleOf, isCircleType, KINDS_OF, kindLabel, type Circle, type CircleType } from '../../../functions/src/shared/circles';
import { useClubs } from '../../state/useHope';
import { WIN_KIND_LABELS } from '../../../functions/src/shared/hopeClubs';

export function HopePhotosPage() {
  return <AwayFromHope page="photos"><HopeGate title="Photos and wins">{(org) => <Photos org={org} />}</HopeGate></AwayFromHope>;
}

/** On a Hope page after switching to ADIA or the church: open that organization's own page (Andy, 2026-11-07). */
export function AwayFromHope({ page, children }: { page: CirclePage; children: ReactNode }) {
  const { current } = useOrg();
  const [params] = useSearchParams();
  if (current && current.type !== 'ministry' && isCircleType(current.type) && !isOneItem(page, params.toString() ? `?${params.toString()}` : '')) return <Navigate to={circlePageFor(current.type, page)} replace />;
  return <>{children}</>;
}

/** Photos and wins at ADIA and Freedom Church (Andy, 2026-11-07, 1A-10A): the same conversations as the Hope Centre. */
export function CirclePhotosPage({ type }: { type: Exclude<CircleType, 'ministry'> }) {
  return <CircleGate type={type} title="Photos and wins" page="photos">{(org) => <Photos org={org} />}</CircleGate>;
}
const circleFor = (org: Organization): Circle => circleOf(org.type);

/** Loads the photo reports this person may see; reportId narrows it to one weekly or monthly report. */
export function usePhotoReports(orgId: string, reportId?: string) {
  const [list, setList] = useState<PhotoList | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    listPhotoReports(orgId, reportId).then((l) => { setList(l); setError(''); }).catch((err) => setError(friendlyError(err)));
  }, [orgId, reportId]);
  useEffect(() => { reload(); }, [reload]);
  return { list, error, reload };
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
export const tintStyle = (name: string, uid?: string) => ({ '--tint': storyTint(name, uid) }) as CSSProperties;
const isUnseen = (r: StoredPhotoReport, uid: string) => !!r.lastAt && (!r.seen?.[uid] || r.seen[uid]! < r.lastAt);
const appLink = (id: string, type?: string) => `${location.origin}${circleOf(type).photosPath}?report=${id}`;
const waNumber = (phone: string) => phone.replace(/\D/g, '').replace(/^0/, '254');

/**
 * Photos and wins as conversations (Andy, 2026-11-06, 1A-8A): each report is its own conversation, opened by the
 * sender's first message with photos; the Director, the sender, the board, Andy and Doreen reply in frosted-glass
 * bubbles, each person in their own colour. "Package for the board" makes the PDF report, emailed or sent on WhatsApp.
 */
function Photos({ org }: { org: Organization }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const uid = profile?.uid ?? '';
  const { list, error, reload } = usePhotoReports(org.id);
  const circle = circleFor(org);
  const hope = circle.type === 'ministry';
  const kinds = KINDS_OF[circle.type];
  const openId = params.get('report') ?? '';
  const making = params.get('new') === '1';
  const forReport = params.get('for') ?? '';
  const forLabel = params.get('label') ?? '';
  const [kind, setKind] = useState<PhotoReportKind | 'all'>('all');
  const shown = (list?.reports ?? []).filter((r) => kind === 'all' || r.kind === kind)
    .sort((a, b) => (b.lastAt ?? b.day).localeCompare(a.lastAt ?? a.day));

  if (openId) {
    return (
      <div className="page narrow">
        <Story key={openId} org={org} id={openId} told={params.get('told') === '1' ? (params.get('emailed') ?? '') : null}
          onBack={() => { reload(); setParams({}); }} onChanged={reload} />
      </div>
    );
  }

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>📷 Photos and wins</h1>
        <div className="btn-line">
          {!hope && <Link to={circle.vaultPath} className="btn btn-quiet">🔒 Private conversations</Link>}
          {list?.sends && !making && <button type="button" className="btn btn-primary" onClick={() => setParams({ new: '1' })}>📷 New report</button>}
        </div>
      </div>
      <p className="small muted">
        {list?.seesAll ? `Each report is a conversation: open it to reply, add photos, and package it for ${circle.board}.` : `Only ${circle.readers} see these reports. You see the ones you sent.`}
      </p>
      {error && <p className="notice notice-warn small">{error}</p>}

      {making && (
        <NewReport org={org} forReport={forReport} forLabel={forLabel}
          onCancel={() => (forReport ? navigate(`/hope/reports?report=${forReport}`) : setParams({}))}
          onSent={(id, emailed) => { reload(); if (forReport) navigate(`/hope/reports?report=${forReport}`); else setParams({ report: id, told: '1', emailed: String(emailed) }); }} />
      )}

      {!list ? (!error && <p className="muted">Loading…</p>) : !making && (
        <>
          {list.reports.length > 0 && (
            <div className="chips" role="radiogroup" aria-label="Show">
              {(['all', ...kinds] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' chip-on' : ''}`} onClick={() => setKind(k)}>
                  {k === 'all' ? 'All' : `${PHOTO_REPORT_EMOJI[k]} ${kindLabel(k, circle.type)}`}
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 ? <div className="card"><p>{list.reports.length ? 'None of this kind yet.' : 'No photo reports yet.'}</p></div> : (
            <ul className="st-list">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link to={`${circle.photosPath}?report=${r.id}`} className={`st-item${r.kind === 'incident' ? ' incident' : ''}`}>
                    <span className="st-face" style={tintStyle(r.lastByName ?? r.senderName)} aria-hidden="true">{PHOTO_REPORT_EMOJI[r.kind]}</span>
                    <span className="st-item-main">
                      <span className="st-item-title">{r.title}{isUnseen(r, uid) && <i className="st-dot" aria-label="New messages" />}</span>
                      <span className="st-item-last">{r.lastByName ? <b>{r.lastByName.split(' ')[0]}: </b> : null}{r.lastText || r.text || `${r.files.length} files`}</span>
                      <span className="st-item-meta">
                        {formatDateKey(r.day)} · {r.senderName} · {(r.replies ?? 0) + 1} {(r.replies ?? 0) === 0 ? 'message' : 'messages'}
                        {r.status && r.status !== 'open' ? ` · ${STORY_STATUS_LABELS[r.status]}` : ''}{r.ref ? ` · ${r.ref}` : ''}{r.reportLabel ? ` · for ${r.reportLabel}` : ''}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!making && hope && <ClubWins org={org} />}
      {!making && !hope && list && list.deleted.length > 0 && (
        <details className="card hr-fold">
          <summary><h2>🗑 Deleted reports</h2><span className="small muted">{list.deleted.length}</span></summary>
          <ul className="link-list">
            {list.deleted.map((r) => (
              <li key={r.id}><Link to={`${circle.photosPath}?report=${r.id}`}>
                <span className="link-title">{PHOTO_REPORT_EMOJI[r.kind]} {r.title}</span>
                <span className="link-detail">{[r.ref, `deleted by ${r.deletedByName ?? ''}`, r.deletedOn ? formatDateKey(r.deletedOn) : '', r.deleteReason].filter(Boolean).join(' · ')}</span>
              </Link></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The clubs' wins (Andy, 2026-11-05, v173 10A): the newest first, each opening its club. Added on the club's Wins tab. */
function ClubWins({ org }: { org: Organization }) {
  const { clubs, wins } = useClubs(org.id);
  const h = useHopePage(org);
  if (!wins.length) return null;
  return (
    <details className="card hr-fold" open>
      <summary><h2>🏆 Club wins</h2><span className="small muted">{wins.length}</span></summary>
      <ul className="link-list">
        {wins.slice(0, 40).map((w) => {
          const c = clubs.find((x) => x.id === w.clubId);
          return (
            <li key={w.id}><Link to={`/hope/clubs/${w.clubId}`}>
              <span className="link-title">{c?.emoji ?? '🏆'} {w.title}</span>
              <span className="link-detail">{[formatDateKey(w.date), c?.name, WIN_KIND_LABELS[w.kind], w.childIds.map((id) => h.nameOf(id)).join(', ')].filter(Boolean).join(' · ')}</span>
            </Link></li>
          );
        })}
      </ul>
    </details>
  );
}

const extOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]{2,5})$/) ?? [])[1] ?? '';
const mb = (n: number) => `${(n / 1048576).toFixed(n < 1048576 ? 2 : 1)} MB`;

/** The photos, videos or documents chosen so far, with a small preview of each photo and a × to take one out. */
export function Picked({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const u = files.map((f) => (isPhotoFile(f) ? URL.createObjectURL(f) : ''));
    setUrls(u);
    return () => u.forEach((x) => x && URL.revokeObjectURL(x));
  }, [files]);
  if (!files.length) return null;
  return (
    <div className="ph-grid">
      {files.map((f, i) => (
        <div key={`${f.name}${i}`} className="ph-thumb">
          {urls[i] ? <img src={urls[i]} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <span className={`st-ext e-${extOf(f.name)}`}>{isVideoFile(f) ? '▶' : extOf(f.name).toUpperCase()}</span>}
          <span className="ph-name">{isPhotoFile(f) ? (/\.hei[cf]$/i.test(f.name) ? 'HEIC photo' : '') : `${f.name} · ${mb(f.size)}`}</span>
          <button type="button" className="ph-x" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)}>×</button>
        </div>
      ))}
    </div>
  );
}

export function pickFiles(list: FileList | null, have: File[], max: number, toast: (m: string) => void): File[] {
  const all = [...(list ?? [])];
  const chosen = all.filter(isStoryFile);
  if (chosen.length < all.length) toast('Only photos, videos, PDF, Word, Excel and PowerPoint files can be added.');
  const next = [...have, ...chosen];
  if (next.length > max) toast(`Up to ${max} files per message. The first ${max} are kept.`);
  return next.slice(0, max);
}

function FilePicker({ files, setFiles, max }: { files: File[]; setFiles: (f: File[]) => void; max: number }) {
  const toast = useToast();
  return (
    <>
      <Picked files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
      {files.length < max && (
        <label className="btn align-start ph-add">
          📷 {files.length ? 'Add more' : 'Add photos, videos or files'}
          <input type="file" multiple hidden accept={STORY_ACCEPT} onChange={(e) => { setFiles(pickFiles(e.target.files, files, max, toast.show)); e.target.value = ''; }} />
        </label>
      )}
      <p className="small muted">{files.length} of {max} · photos (JPG, PNG, HEIC) are made smaller on the phone; videos up to 50 MB; PDF, Word, Excel and PowerPoint up to 10 MB.</p>
    </>
  );
}

const NO_INCIDENT: IncidentDetails = { time: '', place: '', hurt: '', action: '', parentsTold: null, followUp: '', severity: null };

/** The incident's own questions (7A). */
function IncidentFields({ value, onChange, circle }: { value: IncidentDetails; onChange: (v: IncidentDetails) => void; circle: Circle }) {
  const hope = circle.type === 'ministry';
  const set = (k: keyof IncidentDetails, v: string | boolean | null) => onChange({ ...value, [k]: v });
  return (
    <fieldset className="st-incident-fields stack">
      <legend>⚠️ Incident details</legend>
      <div className="field">
        <span>How serious is it?</span>
        <div className="chips" role="radiogroup" aria-label="Severity">
          {(['low', 'medium', 'high'] as Severity[]).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={value.severity === v} className={`chip${value.severity === v ? ' chip-on' : ''}`} onClick={() => set('severity', value.severity === v ? null : v)}>{SEVERITY_LABELS[v]}</button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <label className="field"><span>Time</span><input type="time" value={value.time} onChange={(e) => set('time', e.target.value)} /></label>
        <label className="field"><span>Where</span><input value={value.place} maxLength={300} onChange={(e) => set('place', e.target.value)} placeholder={hope ? 'Playground' : circle.type === 'college' ? 'Workshop' : 'Main hall'} /></label>
      </div>
      <label className="field"><span>Who was hurt</span><input value={value.hurt} maxLength={300} onChange={(e) => set('hurt', e.target.value)} placeholder={hope ? "Name and HC code, or 'No one'" : "Name, or 'No one'"} /></label>
      <label className="field"><span>What was done</span><textarea rows={2} value={value.action} maxLength={300} onChange={(e) => set('action', e.target.value)} placeholder={hope ? 'First aid, called the nurse…' : 'First aid, called for help…'} /></label>
      <div className="field">
        <span>{circle.type === 'church_campus' ? 'Was the family told?' : 'Were the parents or guardians told?'}</span>
        <div className="chips" role="radiogroup" aria-label="Parents told">
          {([[true, 'Yes'], [false, 'No']] as const).map(([v, l]) => (
            <button key={l} type="button" role="radio" aria-checked={value.parentsTold === v} className={`chip${value.parentsTold === v ? ' chip-on' : ''}`} onClick={() => set('parentsTold', value.parentsTold === v ? null : v)}>{l}</button>
          ))}
        </div>
      </div>
      <label className="field"><span>Follow-up</span><textarea rows={2} value={value.followUp} maxLength={300} onChange={(e) => set('followUp', e.target.value)} placeholder={`Check on the ${circle.person} tomorrow…`} /></label>
    </fieldset>
  );
}

function NewReport({ org, forReport, forLabel, onCancel, onSent }: { org: Organization; forReport: string; forLabel: string; onCancel: () => void; onSent: (id: string, emailed: number) => void }) {
  const toast = useToast();
  const today = localDateKey(new Date(), org.timeZone || 'Africa/Nairobi');
  const [kind, setKind] = useState<PhotoReportKind>(forReport ? 'activity' : 'win');
  const [title, setTitle] = useState(forReport ? `Photos for ${forLabel}`.slice(0, PHOTO_TITLE_MAX) : '');
  const [day, setDay] = useState(today);
  const [text, setText] = useState('');
  const [incident, setIncident] = useState<IncidentDetails>(NO_INCIDENT);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const picker = useChildPicker(org.id, text, setText, org.type);
  const circle = circleFor(org);
  const kinds = KINDS_OF[circle.type];
  const sample: Partial<Record<PhotoReportKind, string>> = circle.type === 'college'
    ? { win: 'Grace passed her trade test', activity: 'Catering practical day', exams: 'Cohort 3 CAT results', incident: 'A student was hurt in the workshop' }
    : circle.type === 'church_campus'
      ? { win: 'Healed after prayer', activity: 'Youth Sunday', care: 'Hospital visit to Mary', incident: 'A child got lost after the service' }
      : { win: 'Amani read a whole book', activity: 'Sports day', incident: 'A child fell in the playground' };

  async function send() {
    if (!title.trim()) { toast.show('Please give it a title.'); return; }
    if (!files.length && !text.trim()) { toast.show('Add a few words or at least one photo.'); return; }
    setProgress([0, files.length]);
    try {
      const { id, emailed, failed } = await startStory(org.id, { kind, title: title.trim(), day, text, reportId: forReport || null, incident: kind === 'incident' ? incident : null, childIds: picker.picked.map((c) => c.id) }, files, (d, of) => setProgress([d, of]));
      if (failed.length) toast.show(`Sent, but ${failed.length} ${failed.length === 1 ? 'file' : 'files'} did not go: ${failed.join(', ')}. Add them again in the conversation.`);
      onSent(id, emailed.length);
    } catch (err) { toast.show(friendlyError(err)); } finally { setProgress(null); }
  }

  return (
    <section className="card stack">
      <h2>{forReport ? `Add photos to ${forLabel || 'the report'}` : 'Start a report'}</h2>
      <p className="small muted">{forReport ? "These photos will be printed at the end of the report's PDF." : `Your first message opens the conversation. ${circle.readers.replace(/^the /, 'The ')} get an email, and you can tell them on WhatsApp with one tap.`}</p>
      <div className="ph-kinds" role="radiogroup" aria-label="Kind of report">
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`ph-kind${kind === k ? ' on' : ''}${k === 'incident' ? ' incident' : ''}`} onClick={() => setKind(k)}>
            <span aria-hidden="true">{PHOTO_REPORT_EMOJI[k]}</span>{kindLabel(k, circle.type)}
          </button>
        ))}
      </div>
      {kind === 'incident' && <p className="notice notice-warn small">An incident is seen only by {circle.readers}.</p>}
      <label className="field"><span>Title</span><input value={title} maxLength={PHOTO_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder={sample[kind] ?? ''} /></label>
      <label className="field"><span>Date</span><input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></label>
      {kind === 'incident' && <IncidentFields value={incident} onChange={setIncident} circle={circle} />}
      <label className="field"><span>What happened (a few lines)</span><textarea rows={4} value={text} maxLength={PHOTO_TEXT_MAX} onChange={(e) => setText(e.target.value)} placeholder={`Type @ and a name to add a ${circle.person}'s card`} /></label>
      <div className="st-light">
        {picker.panel}
        {picker.chips}
        <button type="button" className="btn btn-quiet btn-small align-start" onClick={picker.toggle}>{circle.personEmoji} Name a {circle.person}</button>
      </div>
      <FilePicker files={files} setFiles={setFiles} max={MAX_PHOTO_FILES} />
      <div className="btn-line">
        <button type="button" className="btn btn-primary" disabled={!!progress} onClick={() => void send()}>
          {progress ? (progress[1] ? `Sending ${Math.min(progress[0] + 1, progress[1])} of ${progress[1]}…` : 'Sending…') : 'Send'}
        </button>
        <button type="button" className="btn btn-quiet" disabled={!!progress} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

/**
 * The files in one message, with "Download all" when there are two or more photos or videos (Andy, 2026-11-07).
 * On a phone the share sheet opens so they can be saved to the gallery in one go; on a computer each one downloads.
 */
export function FilesGrid({ files, get, children }: { files: PhotoFile[]; get: (f: PhotoFile) => Promise<File>; children: ReactNode }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const media = files.filter((f) => f.photo || f.video);
  async function saveAll() {
    setBusy(`Getting 0 of ${media.length}…`);
    try {
      const got: File[] = [];
      for (const f of media) { got.push(await get(f)); setBusy(`Getting ${got.length} of ${media.length}…`); }
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      const phone = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
      if (phone && nav.canShare?.({ files: got })) {
        try { await nav.share({ files: got }); return; } catch (err) { if ((err as { name?: string })?.name === 'AbortError') return; }
      }
      for (const f of got) { downloadFile(f); await new Promise((r) => window.setTimeout(r, 400)); }
      toast.show(`${got.length} files downloaded.`);
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  return (
    <>
      <div className="st-pics">{children}</div>
      {media.length > 1 && (
        <button type="button" className="st-chip st-dl-all" disabled={!!busy} onClick={() => void saveAll()}>{busy || `⬇ Download all ${media.length}`}</button>
      )}
    </>
  );
}

/** A file in a bubble: photos show, a video plays when tapped (so 50 MB is not fetched on its own), documents download. */
export function FileView({ org, reportId, file, onRemove, getFile }: { org: Organization; reportId: string; file: PhotoFile; onRemove?: () => Promise<void>; getFile?: (f: PhotoFile) => Promise<File> }) {
  const get = useCallback((f: PhotoFile) => (getFile ? getFile(f) : photoFile(org.id, reportId, f)), [getFile, org.id, reportId]);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<'' | 'loading' | 'failed'>('');
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const made = useRef('');
  useEffect(() => () => { if (made.current) URL.revokeObjectURL(made.current); }, []);
  const load = useCallback(() => {
    setState('loading');
    get(file).then((f) => { made.current = URL.createObjectURL(f); setUrl(made.current); setState(''); }).catch(() => setState('failed'));
  }, [get, file]);
  // Save a shared photo or video to this phone or computer (Andy, 2026-11-07).
  const save = () => { setSaving(true); void get(file).then(downloadFile).catch(() => setState('failed')).finally(() => setSaving(false)); };
  const saveBtn = (
    <button type="button" className="st-dl" aria-label={`Download ${file.name}`} title="Download" disabled={saving} onClick={save}>{saving ? '…' : '⬇'}</button>
  );
  useEffect(() => { if (file.photo) load(); }, [file.photo, load]);
  // Andy and Doreen take out any photo or file (1A): tap ✕, then "Take out".
  const remove = onRemove && (
    <span className="st-fx-wrap">
      {asking ? (
        <>
          <button type="button" className="st-chip danger" onClick={() => void onRemove().catch(() => setAsking(false))}>Take out</button>
          <button type="button" className="st-chip" onClick={() => setAsking(false)}>Keep</button>
        </>
      ) : <button type="button" className="st-fx" aria-label={`Take out ${file.name}`} onClick={() => setAsking(true)}>✕</button>}
    </span>
  );
  if (file.photo) {
    return (
      <div className="st-file-box">
        <a className="st-pic" href={url || undefined} target="_blank" rel="noreferrer" aria-label={file.name}>
          {url ? <img src={url} alt="" onError={() => setState('failed')} /> : <span>{state === 'failed' ? 'Could not load' : 'Loading…'}</span>}
        </a>
        {url && saveBtn}
        {remove}
      </div>
    );
  }
  if (file.video && url) return <div className="st-file-box st-wide"><video className="st-video" src={url} controls playsInline preload="metadata" />{saveBtn}{remove}</div>;
  const ext = extOf(file.name);
  return (
    <div className="st-file-box st-wide">
      <button type="button" className="st-file" disabled={state === 'loading'}
        onClick={() => (file.video ? load() : void get(file).then(downloadFile).catch(() => setState('failed')))}>
        <span className={`st-ext e-${ext}`}>{file.video ? '▶' : ext.toUpperCase()}</span>
        <span><b>{file.name}</b><small>{mb(file.size)} · {state === 'loading' ? 'Getting it…' : state === 'failed' ? 'Could not open, tap to try again' : file.video ? 'Tap to play' : 'Tap to download'}</small></span>
      </button>
      {remove}
    </div>
  );
}

type Item = StoryMessage & { id: string; opening?: boolean };

/** A person's face (3A): their photo if they added one, otherwise their initials in their colour. Tap to change it. */
export function Face({ name, photo, onPick }: { name: string; photo?: string; onPick?: (f: File) => void }) {
  const inner = photo ? <img src={photo} alt="" /> : initials(name);
  if (!onPick) return <span className="st-face" aria-hidden="true">{inner}</span>;
  return (
    <label className="st-face st-face-edit" title={photo ? 'Change the photo' : 'Add a photo'}>
      {inner}
      <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
    </label>
  );
}

/** The children named in a message (2A): photo, name, HC code and class, opening the child's page. */
export function ChildCards({ kids, photos, type }: { kids: StoryChild[]; photos: Record<string, string>; type?: string }) {
  if (!kids.length) return null;
  const circle = circleOf(type);
  return (
    <div className="st-kids">
      {kids.map((c) => (
        <Link key={c.id} to={circle.personPath(c.id)} className="st-kid">
          {photos[c.id] ? <img src={photos[c.id]} alt="" /> : <span className="st-kid-none">{initials(c.name)}</span>}
          <span><b>{c.name}</b><small>{[c.code, c.className].filter(Boolean).join(' · ')}</small></span>
        </Link>
      ))}
    </div>
  );
}

/** One bubble (2A): the person's face and tint, their name, role and time, and what they may do with it. */
function Bubble({ org, story, m, mine, canDelete, onEdit, onDelete, onDecision, onRemoveFile, onFace }: {
  org: Organization; story: StoryOpen; m: Item; mine: boolean; canDelete: boolean;
  onEdit: (text: string) => Promise<void>; onDelete: () => Promise<void>; onDecision: (on: boolean) => Promise<void>;
  onRemoveFile: (key: string) => Promise<void>; onFace?: (f: File) => void;
}) {
  const tz = org.timeZone || 'Africa/Nairobi';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); setMenu(false); setEditing(false); } catch { /* already shown */ } finally { setBusy(false); } };
  if (m.system) return <p className="st-gone st-system">{m.text} · {chatTime(m.at, tz)}</p>;
  if (m.deleted) {
    return <div className={`st-msg${mine ? ' mine' : ''}`}><p className="st-gone">🗑 A message from {m.byName} was deleted{m.deletedByName && m.deletedByName !== m.byName ? ` by ${m.deletedByName}` : ''}.</p></div>;
  }
  const canDecide = story.writes && !m.opening;
  return (
    <div className={`st-msg${mine ? ' mine' : ''}`} style={tintStyle(m.byName, m.byUid)}>
      <Face name={m.byName} photo={story.faces[faceKey(m.byName)] || builtInFace(m.byName)} onPick={onFace} />
      <div className="st-bubble">
        <div className="st-who"><b>{m.byName}</b>{m.byRole && <span>{m.byRole}</span>}<span>{chatTime(m.at, tz)}</span></div>
        {editing ? (
          <div className="stack">
            <textarea className="st-edit" rows={3} value={draft} maxLength={m.opening ? PHOTO_TEXT_MAX : STORY_TEXT_MAX} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <div className="btn-line">
              <button type="button" className="st-chip on" disabled={busy} onClick={() => void run(() => onEdit(draft))}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="st-chip" onClick={() => { setEditing(false); setDraft(m.text); }}>Cancel</button>
            </div>
          </div>
        ) : m.text && <p>{m.text}</p>}
        <ChildCards kids={m.children ?? []} photos={story.childPhotos} type={org.type} />
        {m.files.length > 0 && (
          <FilesGrid files={m.files} get={(f) => photoFile(org.id, story.report.id, f)}>
            {m.files.map((f) => <FileView key={f.key} org={org} reportId={story.report.id} file={f} onRemove={story.removes && !story.report.deleted ? () => onRemoveFile(f.key) : undefined} />)}
          </FilesGrid>
        )}
        <div className="st-when">
          <span>{m.decision ? '📌 Decision · ' : ''}{m.editedAt ? 'edited' : ''}</span>
          {(mine || canDelete || canDecide) && !editing && <button type="button" className="st-more" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>}
        </div>
        {menu && !editing && (
          <div className="st-menu">
            {mine && <button type="button" className="st-chip" onClick={() => { setDraft(m.text); setEditing(true); }}>✏️ Edit</button>}
            {canDecide && <button type="button" className="st-chip" disabled={busy} onClick={() => void run(() => onDecision(!m.decision))}>{m.decision ? 'Not a decision' : '📌 Mark as decision'}</button>}
            {canDelete && !m.opening && <button type="button" className="st-chip danger" disabled={busy} onClick={() => void run(onDelete)}>🗑 Delete</button>}
            {mine && !canDelete && !m.opening && <small className="st-note">After {UNSAY_MINUTES} minutes only Andy or Doreen can delete it. You can still edit it.</small>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Naming children in a reply (2A): type @ and a few letters, or tap 👧, then choose. */
export function useChildPicker(orgId: string, text: string, setText: (t: string) => void, type?: string) {
  const circle = circleOf(type);
  const [all, setAll] = useState<StoryChild[] | null>(null);
  const [picked, setPicked] = useState<StoryChild[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const at = /(^|\s)@([^@\n]{0,30})$/.exec(text);
  const query = at ? at[2]! : open ? q : null;
  useEffect(() => { if (query !== null && !all) storyChildren(orgId).then(setAll).catch(() => setAll([])); }, [query, all, orgId]);
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = query === null || !all ? [] : all.filter((c) => !picked.some((p) => p.id === c.id) && words.every((w) => `${c.name} ${c.code}`.toLowerCase().includes(w))).slice(0, 8);
  function choose(c: StoryChild) {
    if (picked.length < STORY_CHILDREN_MAX) setPicked([...picked, c]);
    if (at) setText(text.slice(0, at.index + at[1]!.length) + c.name + ' ');
    setOpen(false); setQ('');
  }
  const panel = query !== null && (
    <div className="st-suggest">
      {open && !at && <input className="st-suggest-q" autoFocus placeholder={circle.codeLabel ? `Name or ${circle.codeLabel}` : 'Name'} value={q} onChange={(e) => setQ(e.target.value)} />}
      {!all ? <p className="small">Loading the {circle.people}…</p> : matches.length === 0 ? <p className="small">{words.length ? `No ${circle.person} found.` : circle.codeLabel ? `Type a name or ${circle.codeLabel}.` : 'Type a name.'}</p> : (
        <ul>{matches.map((c) => <li key={c.id}><button type="button" onClick={() => choose(c)}><b>{c.name}</b> <small>{[c.code, c.className].filter(Boolean).join(' · ')}</small></button></li>)}</ul>
      )}
      {open && !at && <button type="button" className="st-chip" onClick={() => { setOpen(false); setQ(''); }}>Close</button>}
    </div>
  );
  const chips = picked.length > 0 && (
    <div className="st-menu">{picked.map((c) => <button key={c.id} type="button" className="st-chip on" onClick={() => setPicked(picked.filter((p) => p.id !== c.id))}>{circle.personEmoji} {c.name} ✕</button>)}</div>
  );
  return { picked, clear: () => setPicked([]), panel, chips, toggle: () => setOpen(!open) };
}

/** The one tap to tell everyone on WhatsApp (Andy, 2026-11-06), after the email has gone. */
function TellEveryone({ org, story, emailed, onDone }: { org: Organization; story: StoryOpen; emailed: string; onDone: () => void }) {
  const [people, setPeople] = useState<BoardPerson[]>([]);
  useEffect(() => { storyPeople(org.id).then(setPeople).catch(() => setPeople([])); }, [org.id]);
  const text = storyStartWhatsApp(story.report, appLink(story.report.id, org.type), circleOf(org.type).type);
  async function tell() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try { await nav.share({ text }); onDone(); return; } catch (err) { if ((err as { name?: string }).name === 'AbortError') return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    onDone();
  }
  return (
    <div className="st-tell">
      <p><b>✉️ {Number(emailed) > 0 ? `Email sent to ${emailed} ${emailed === '1' ? 'person' : 'people'}.` : 'Sent.'}</b> Now tell everyone on WhatsApp, with the link so they can reply.</p>
      <button type="button" className="st-pack" onClick={() => void tell()}>🟢 Tell everyone on WhatsApp</button>
      {people.some((p) => p.phone) && (
        <details><summary className="small">Or one person at a time</summary>
          <div className="st-menu">{people.filter((p) => p.phone).map((p) => (
            <a key={p.name} className="st-chip" href={`https://wa.me/${waNumber(p.phone)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">{p.name.split(' ')[0]}</a>
          ))}</div>
        </details>
      )}
      <button type="button" className="st-close" aria-label="Close" onClick={onDone}>✕</button>
    </div>
  );
}

/** The two approvals (7A): the Director's and the board's, each with that person's own password (none for Andy). */
function Approvals({ org, story, onDone }: { org: Organization; story: StoryOpen; onDone: () => void }) {
  const toast = useToast();
  const { profile } = useAuth();
  const andy = useIsAndy();
  const [slot, setSlot] = useState<ApprovalSlot | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const tz = org.timeZone || 'Africa/Nairobi';
  const r = story.report;
  async function approve(s: ApprovalSlot, undo = false) {
    if (!profile) return;
    setBusy(true);
    try {
      const proof = andy ? await myOwnProof() : await passwordProof(profile.uid, profile.email, pw);
      await approveStory(org.id, r.id, s, proof, undo);
      toast.show(undo ? 'Approval taken back.' : 'Approved.');
      setSlot(null); setPw(''); onDone();
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      toast.show(/invalid-credential|wrong-password/.test(code) ? 'That password is not right.' : friendlyError(err));
    } finally { setBusy(false); }
  }
  return (
    <div className="stack st-approvals">
      <h3>Approvals</h3>
      {(['director', 'board'] as ApprovalSlot[]).map((s) => {
        const labels = story.labels ?? APPROVAL_LABELS;
        const a = r.approvals?.[s];
        const mine = story.approves[s];
        return (
          <div key={s} className="st-approval">
            <span className="grow"><b>{labels[s]}</b><br />
              <span className="small muted">{a ? `✅ ${a.name}, ${a.role}, ${chatTime(a.at, tz)}` : 'Not approved yet'}</span></span>
            {mine && slot !== s && <button type="button" className="btn btn-small" disabled={busy} onClick={() => (andy ? void approve(s, !!a) : setSlot(s))}>{a ? 'Take back' : '✅ Approve'}</button>}
          </div>
        );
      })}
      {slot && !andy && (
        <div className="stack">
          <label className="field"><span>Your Insight-IQ password</span><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
          <div className="btn-line">
            <button type="button" className="btn btn-primary" disabled={busy || !pw} onClick={() => void approve(slot, !!r.approvals?.[slot])}>{busy ? 'Checking…' : r.approvals?.[slot] ? 'Take back my approval' : 'Approve'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => { setSlot(null); setPw(''); }}>Cancel</button>
          </div>
        </div>
      )}
      <p className="small muted">The PDF prints "Approved by … on …" for each approval. Without one, it leaves a line to sign by hand.</p>
    </div>
  );
}

/** "Package for the board" (5A, 6A): a summary, the PDF to look at first, then email it or send it on WhatsApp. */
function Package({ org, story, items, onClose, onSent }: { org: Organization; story: StoryOpen; items: Item[]; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const { profile } = useAuth();
  const r = story.report;
  const circle = circleFor(org);
  const [summary, setSummary] = useState(r.summary ?? r.text ?? '');
  const [pdf, setPdf] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [people, setPeople] = useState<BoardPerson[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  useEffect(() => {
    loadBoard(org.id).then((p) => { setPeople(p); setTicked(new Set(p.filter((x) => x.hasEmail && x.name.split(' ')[0] !== (profile?.displayName ?? '').split(' ')[0]).map((x) => x.name))); }).catch((err) => toast.show(friendlyError(err)));
  }, [org.id, profile?.displayName, toast]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  // A new approval or status means the PDF must be made again.
  useEffect(() => { setPdf(null); }, [r.approvals, r.status]);
  const replies = items.filter((m) => !m.opening) as (StoryMessage & { id: string })[];
  const decisions = items.filter((m) => m.decision && !m.deleted).length;

  async function make(): Promise<File> {
    setBusy('pdf');
    try {
      await saveStorySummary(org.id, r.id, summary);
      const role = profile ? chatRole(profile, org.id, circle.type) : '';
      const f = await hopeStoryPdf(org, r, replies, { summary, preparedBy: profile?.displayName || org.name, preparedRole: role, link: appLink(r.id, org.type), faces: story.faces, childPhotos: story.childPhotos, labels: story.labels });
      setPdf(f);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(f));
      return f;
    } finally { setBusy(''); }
  }
  async function email() {
    try {
      const f = pdf ?? await make();
      setBusy('email');
      const to = await emailStoryPdf(org.id, r.id, [...ticked], f);
      toast.show(`Emailed to ${to.join(', ')}.`); onSent();
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  async function whatsapp() {
    try {
      const f = pdf ?? await make();
      const text = `${PHOTO_REPORT_EMOJI[r.kind]} *${r.title}*: the report for ${circle.board} is attached.\n${appLink(r.id, org.type)}`;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [f] })) {
        try { await nav.share({ files: [f], text, title: r.title }); } catch (err) { if ((err as { name?: string }).name !== 'AbortError') throw err; }
      } else {
        downloadFile(f);
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        toast.show('The PDF was downloaded. Attach it in WhatsApp.');
      }
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <section className="card stack st-package">
      <div className="card-head"><h2>📦 Package for {circle.board}</h2><button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Close">✕</button></div>
      <p className="small muted">The PDF has a cover, your summary{r.kind === 'incident' ? ', the incident details' : ''}, the dated conversation, the photos with captions, the files and videos (linked), {decisions} {decisions === 1 ? 'decision' : 'decisions'} and next steps, and a sign-off.</p>
      <label className="field"><span>Summary for {circle.board}</span><textarea rows={5} value={summary} maxLength={3000} onChange={(e) => { setSummary(e.target.value); setPdf(null); }} placeholder="What happened, what it means, and what we will do." /></label>
      <div className="btn-line">
        <button type="button" className="btn" disabled={!!busy} onClick={() => void make().catch((err) => toast.show(friendlyError(err)))}>{busy === 'pdf' ? 'Making the PDF…' : pdf ? '↻ Make it again' : '👁 Preview the PDF'}</button>
        {pdf && <a className="btn btn-quiet" href={preview} target="_blank" rel="noreferrer">Open the PDF</a>}
      </div>
      {preview && <iframe className="st-preview" src={preview} title="The report PDF" />}
      <Approvals org={org} story={story} onDone={onSent} />
      {!people ? <p className="muted small">Loading the names…</p> : (
        <ul className="ph-people">
          {people.map((p) => (
            <li key={p.name}>
              <label className="check"><input type="checkbox" disabled={!p.hasEmail} checked={ticked.has(p.name)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(p.name); else n.delete(p.name); setTicked(n); }} /> {p.name}{!p.hasEmail && <span className="small muted"> (no email)</span>}</label>
            </li>
          ))}
        </ul>
      )}
      <div className="btn-line">
        <button type="button" className="btn btn-primary" disabled={!!busy || ticked.size === 0} onClick={() => void email()}>{busy === 'email' ? 'Emailing…' : `✉️ Email the PDF to ${ticked.size}`}</button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void whatsapp()}>🟢 Send on WhatsApp</button>
      </div>
      {r.emailedOn && <p className="small muted">Last emailed to {r.emailedTo?.join(', ')} on {formatDateKey(r.emailedOn)}.</p>}
    </section>
  );
}

/** A conversation (1A, 2A): the glass room over a blurred photo, the bubbles, and the box to reply. */
function Story({ org, id, told, onBack, onChanged }: { org: Organization; id: string; told: string | null; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [story, setStory] = useState<StoryOpen | null>(null);
  const [error, setError] = useState('');
  const [skew, setSkew] = useState(0);
  const [tell, setTell] = useState(told !== null);
  const [packing, setPacking] = useState(false);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState<[number, number] | null>(null);
  const [scene, setScene] = useState('');
  const [deleting, setDeleting] = useState<'' | 'ask' | 'busy'>('');
  const [reason, setReason] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);
  const picker = useChildPicker(org.id, text, setText, org.type);
  const circle = circleFor(org);
  const hope = circle.type === 'ministry';

  const load = useCallback(async () => {
    try { const s = await openStory(org.id, id); setStory(s); setSkew(s.now - Date.now()); setError(''); } catch (err) { setError(friendlyError(err)); }
  }, [org.id, id]);
  useEffect(() => { void load(); }, [load]);
  // The five-minute delete window closes on its own.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const items = useMemo(() => (story ? storyTimeline(story.report, story.messages) : []), [story]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [items.length]);
  // The first photo, blurred, is the room's background (2A).
  useEffect(() => {
    const first = items.flatMap((m) => (m.deleted ? [] : m.files)).find((f) => f.photo);
    if (!first || !story) return;
    let u = '';
    photoFile(org.id, story.report.id, first).then((f) => { u = URL.createObjectURL(f); setScene(u); }).catch(() => undefined);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [items, org.id, story]);

  if (error) return <><p><button type="button" className="btn btn-quiet" onClick={onBack}>← Photos and wins</button></p><p className="notice notice-warn">{error}</p></>;
  if (!story) return <p className="muted">Opening the conversation…</p>;
  const r = story.report;
  const facts = incidentRows(r.incident);

  const guard = (f: () => Promise<unknown>) => async (): Promise<void> => { try { await f(); await load(); onChanged(); } catch (err) { toast.show(friendlyError(err)); throw err; } };
  async function send() {
    if (!text.trim() && !files.length && !picker.picked.length) return;
    setSending([0, files.length]);
    try {
      const failed = await sayInStory(org.id, id, text, files, (d, of) => setSending([d, of]), picker.picked.map((c) => c.id));
      if (failed.length) toast.show(`${failed.length} did not go: ${failed.join(', ')}`);
      setText(''); setFiles([]); picker.clear(); await load(); onChanged();
    } catch (err) { toast.show(friendlyError(err)); } finally { setSending(null); }
  }
  async function delReport() {
    setDeleting('busy');
    try { await deletePhotoReport(org.id, id, reason); toast.show(hope ? 'Moved to the Bin. It can be put back from Reports → Bin.' : 'Deleted. It can be put back from "Deleted reports" at the foot of Photos and wins.'); onBack(); } catch (err) { toast.show(friendlyError(err)); setDeleting('ask'); }
  }
  async function restore() {
    try { await restorePhotoReport(org.id, id); toast.show('Put back.'); await load(); onChanged(); } catch (err) { toast.show(friendlyError(err)); }
  }
  const now = Date.now() + skew;
  const tz = org.timeZone || 'Africa/Nairobi';
  const status = r.status ?? 'open';
  const lastAt = r.lastAt ?? '';
  const seenBy = Object.entries(r.seen ?? {}).filter(([u, t]) => u !== story.me && lastAt && t >= lastAt).map(([u]) => r.seenNames?.[u]).filter(Boolean) as string[];
  const face = (f: File, name?: string) => void setFace(org.id, f, name).then(load).then(() => toast.show('Photo saved.')).catch((err) => toast.show(friendlyError(err)));

  return (
    <>
      <section className={`st-room${r.kind === 'incident' ? ' incident' : ''}`}>
        {scene ? <img className="st-scene" src={scene} alt="" /> : <div className="st-scene st-scene-default" />}
        <header className="st-head">
          <button type="button" className="st-back" onClick={onBack} aria-label="Back to Photos and wins">←</button>
          <div className="st-title">
            <b>{PHOTO_REPORT_EMOJI[r.kind]} {r.title}</b>
            <small>{r.ref ? `${r.ref} · ` : ''}{kindLabel(r.kind, circle.type)} · {formatDateKey(r.day)} · {items.filter((m) => !m.deleted && !m.system).length} messages</small>
          </div>
          {story.packages && !r.deleted && <button type="button" className="st-pack" onClick={() => setPacking(true)}>📦 Package for {circle.board}</button>}
        </header>
        <div className="st-status">
          <ol className="st-steps" aria-label="Status">
            {STORY_STATUSES.map((st, i) => <li key={st} className={STORY_STATUSES.indexOf(status) >= i ? 'on' : ''}>{STORY_STATUS_LABELS[st]}</li>)}
          </ol>
          {story.packages && !r.deleted && status !== 'sent' && (
            <div className="st-menu">
              {(['open', 'review', 'resolved'] as StoryStatus[]).filter((st) => st !== status).map((st) => (
                <button key={st} type="button" className="st-chip" onClick={() => void guard(() => setStoryStatus(org.id, id, st))().catch(() => undefined)}>Mark {STORY_STATUS_LABELS[st]}</button>
              ))}
            </div>
          )}
        </div>
        {r.reportLabel && <p className="st-day">For the report <Link to={`/hope/reports?report=${r.reportId}`}>{r.reportLabel}</Link></p>}
        {r.deleted && <p className="st-facts">Deleted by {r.deletedByName} on {formatDateKey(r.deletedOn)}{r.deleteReason ? `: ${r.deleteReason}` : '.'}</p>}
        {facts.length > 0 && (
          <details className="st-facts" open>
            <summary><span>⚠️ Incident details{r.incident?.severity ? ` · ${SEVERITY_LABELS[r.incident.severity]}` : ''}</span><span>{r.incident?.parentsTold === true ? 'Parents told' : r.incident?.parentsTold === false ? 'Parents not told yet' : ''}</span></summary>
            <dl>{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            <div className="st-menu">
              {r.followUpDoneAt ? <span className="small">✅ Follow-up done by {r.followUpDoneByName}, {chatTime(r.followUpDoneAt, tz)}</span>
                : <span className="small">Follow-up not done yet{r.startedAt ? `. ${hope ? 'Diana is' : `The ${circle.lead} is`} reminded ${FOLLOW_UP_HOURS} hours after it was reported.` : '.'}</span>}
              {story.packages && !r.deleted && <button type="button" className="st-chip on" onClick={() => void guard(() => setFollowUp(org.id, id, !r.followUpDoneAt))().catch(() => undefined)}>{r.followUpDoneAt ? 'Not done yet' : '✅ Follow-up done'}</button>}
            </div>
          </details>
        )}
        {tell && told !== null && r.senderUid === story.me && <TellEveryone org={org} story={story} emailed={told} onDone={() => setTell(false)} />}
        <div className="st-thread">
          {items.map((m, i) => {
            const day = m.at.slice(0, 10);
            const showDay = i === 0 || items[i - 1]!.at.slice(0, 10) !== day;
            const mine = m.byUid === story.me;
            const sent = Date.parse(m.at);
            const canDelete = !m.opening && !m.deleted && (story.keeps || (mine && now - sent <= UNSAY_MINUTES * 60_000));
            return (
              <div key={m.id} className="st-row">
                {showDay && <span className="st-day">{formatDateKey(localDateKey(new Date(m.at), org.timeZone || 'Africa/Nairobi'))}</span>}
                <Bubble org={org} story={story} m={m} mine={mine} canDelete={canDelete}
                  onFace={mine ? (f) => face(f) : story.keeps ? (f) => face(f, m.byName) : undefined}
                  onRemoveFile={(key) => guard(() => removeStoryFile(org.id, id, key))()}
                  onEdit={(t) => guard(() => editStoryMessage(org.id, id, m.id, t))()}
                  onDelete={() => guard(() => unsayStoryMessage(org.id, id, m.id))()}
                  onDecision={(on) => guard(() => markDecision(org.id, id, m.id, on))()} />
              </div>
            );
          })}
          {seenBy.length > 0 && <p className="st-seen">Seen by {seenBy.map((n) => n.split(' ')[0]).join(', ')}</p>}
          {story.removes && (r.removed?.length ?? 0) > 0 && (
            <details className="st-facts st-removed">
              <summary><span>🗑 {r.removed!.length} {r.removed!.length === 1 ? 'file' : 'files'} taken out</span></summary>
              <ul>{r.removed!.map((x) => (
                <li key={x.file.key}><span>{x.file.name} · by {x.removedByName}, {chatTime(x.removedAt, tz)}</span>
                  <button type="button" className="st-chip" onClick={() => void guard(() => restoreStoryFile(org.id, id, x.file.key))().catch(() => undefined)}>↩︎ Put back</button></li>
              ))}</ul>
            </details>
          )}
          <div ref={end} />
        </div>
        {story.writes ? (
          <div className="st-compose-wrap">
            {picker.panel}
            {picker.chips}
            {files.length > 0 && <div className="st-picked"><Picked files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} /></div>}
            <div className="st-composer">
              <label className="st-ic" aria-label="Add photos, videos or files">📎
                <input type="file" multiple hidden accept={STORY_ACCEPT} onChange={(e) => { setFiles(pickFiles(e.target.files, files, STORY_FILES_MAX, toast.show)); e.target.value = ''; }} />
              </label>
              <button type="button" className="st-ic" aria-label={`Name a ${circle.person}`} onClick={picker.toggle}>{circle.personEmoji}</button>
              <textarea rows={1} value={text} maxLength={STORY_TEXT_MAX} placeholder={`Write a reply… (@ to name a ${circle.person})`} onChange={(e) => setText(e.target.value)} />
              <button type="button" className="st-send" disabled={!!sending || (!text.trim() && !files.length && !picker.picked.length)} onClick={() => void send()}>
                {sending ? (sending[1] ? `${Math.min(sending[0] + 1, sending[1])}/${sending[1]}` : '…') : 'Send'}
              </button>
            </div>
          </div>
        ) : <p className="st-day">Only {circle.readers} and the sender write here.</p>}
      </section>

      {packing && <Package org={org} story={story} items={items} onClose={() => setPacking(false)} onSent={() => { void load(); onChanged(); }} />}

      {story.deletes && (
        <div className="btn-line" style={{ marginTop: 12 }}>
          {r.deleted ? <button type="button" className="btn" onClick={() => void restore()}>↩︎ Put it back</button>
            : deleting ? (
              <div className="stack">
                <label className="field"><span>Why delete the whole report? (optional)</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
                <div className="btn-line">
                  <button type="button" className="btn btn-danger" disabled={deleting === 'busy'} onClick={() => void delReport()}>{deleting === 'busy' ? 'Deleting…' : 'Delete the report'}</button>
                  <button type="button" className="btn btn-quiet" onClick={() => setDeleting('')}>Keep it</button>
                </div>
              </div>
            ) : <button type="button" className="btn btn-quiet" onClick={() => setDeleting('ask')}>🗑 Delete the report</button>}
        </div>
      )}
    </>
  );
}
