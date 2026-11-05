import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { downloadFile } from '../../lib/givingPdf';
import {
  addPhotoFiles, deletePhotoReport, emailPhotoReport, isDocFile, isPhotoFile, listPhotoReports, loadBoard, photoFile, restorePhotoReport,
  sendPhotoReport, type BoardPerson, type PhotoList, type StoredPhotoReport,
} from '../../lib/hopePhotos';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import {
  MAX_PHOTO_FILES, PHOTO_REPORT_EMOJI, PHOTO_REPORT_KINDS, PHOTO_REPORT_LABELS, PHOTO_TEXT_MAX, PHOTO_TITLE_MAX, photoReportWhatsApp,
  type PhotoFile, type PhotoReportKind,
} from '../../../functions/src/shared/hopePhotos';
import type { Organization } from '../../state/OrgContext';
import { HopeGate, useHopePage } from './common';
import { useClubs } from '../../state/useHope';
import { WIN_KIND_LABELS } from '../../../functions/src/shared/hopeClubs';

export function HopePhotosPage() {
  return <HopeGate title="Photo reports">{(org) => <Photos org={org} />}</HopeGate>;
}

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

function Photos({ org }: { org: Organization }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { list, error, reload } = usePhotoReports(org.id);
  const openId = params.get('report') ?? '';
  const making = params.get('new') === '1';
  const forReport = params.get('for') ?? '';
  const forLabel = params.get('label') ?? '';
  const open = list?.reports.find((r) => r.id === openId) ?? list?.deleted.find((r) => r.id === openId);
  const [kind, setKind] = useState<PhotoReportKind | 'all'>('all');
  const shown = (list?.reports ?? []).filter((r) => kind === 'all' || r.kind === kind);

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>📷 Photos and wins</h1>
        {list?.sends && !making && <button type="button" className="btn btn-primary" onClick={() => setParams({ new: '1' })}>📷 New report</button>}
      </div>
      <p className="small muted">
        {list?.seesAll ? 'Good news, activities and incidents with photos, sent from the phone.' : 'Only the Director, the board, Andy and Doreen see these reports. You see the ones you sent.'}
      </p>
      {error && <p className="notice notice-warn small">{error}</p>}

      {making && (
        <NewReport org={org} forReport={forReport} forLabel={forLabel}
          onCancel={() => (forReport ? navigate(`/hope/reports?report=${forReport}`) : setParams({}))}
          onSent={(id) => { reload(); if (forReport) navigate(`/hope/reports?report=${forReport}`); else setParams({ report: id }); }} />
      )}

      {open && <ReportDetail key={open.id} org={org} report={open} list={list!} onChanged={reload} onClose={() => setParams({})} />}

      {!list ? (!error && <p className="muted">Loading…</p>) : (
        <>
          {list.reports.length > 0 && !making && (
            <div className="chips" role="radiogroup" aria-label="Show">
              {(['all', ...PHOTO_REPORT_KINDS] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' chip-on' : ''}`} onClick={() => setKind(k)}>
                  {k === 'all' ? 'All' : `${PHOTO_REPORT_EMOJI[k]} ${PHOTO_REPORT_LABELS[k]}`}
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 ? <div className="card"><p>{list.reports.length ? 'None of this kind yet.' : 'No photo reports yet.'}</p></div> : (
            <ul className="link-list">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link to={`/hope/photos?report=${r.id}`} aria-current={r.id === openId ? 'true' : undefined}>
                    <span className="link-title">{PHOTO_REPORT_EMOJI[r.kind]} {r.title} {r.kind === 'incident' && <span className="badge badge-warn">Incident</span>}</span>
                    <span className="link-detail">{formatDateKey(r.day)} · {r.senderName} · {r.files.length} {r.files.length === 1 ? 'file' : 'files'}{r.reportLabel ? ` · for ${r.reportLabel}` : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!making && <ClubWins org={org} />}
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

/** The photos or documents chosen so far, with a small preview of each photo and a × to take one out. */
function Picked({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
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
          {urls[i] ? <img src={urls[i]} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : null}
          <span className="ph-name">{isPhotoFile(f) ? (/\.hei[cf]$/i.test(f.name) ? 'HEIC photo' : '') : `📄 ${f.name}`}</span>
          <button type="button" className="ph-x" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)}>×</button>
        </div>
      ))}
    </div>
  );
}

function FilePicker({ files, setFiles, max }: { files: File[]; setFiles: (f: File[]) => void; max: number }) {
  const toast = useToast();
  return (
    <>
      <Picked files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
      {files.length < max && (
        <label className="btn align-start ph-add">
          📷 {files.length ? 'Add more' : 'Add photos or files'}
          <input type="file" multiple hidden accept="image/*,.heic,.heif,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              const chosen = [...(e.target.files ?? [])].filter((f) => isPhotoFile(f) || isDocFile(f));
              if (chosen.length < (e.target.files?.length ?? 0)) toast.show('Only photos, PDF and Word files can be added.');
              const next = [...files, ...chosen];
              if (next.length > max) toast.show(`Up to ${MAX_PHOTO_FILES} files per report. The first ${max} are kept.`);
              setFiles(next.slice(0, max));
              e.target.value = '';
            }} />
        </label>
      )}
      <p className="small muted">{files.length} of {max} · photos (JPG, PNG, HEIC, WebP) are made smaller on the phone; PDF and Word up to 4 MB.</p>
    </>
  );
}

function NewReport({ org, forReport, forLabel, onCancel, onSent }: { org: Organization; forReport: string; forLabel: string; onCancel: () => void; onSent: (id: string) => void }) {
  const toast = useToast();
  const today = localDateKey(new Date(), org.timeZone || 'Africa/Nairobi');
  const [kind, setKind] = useState<PhotoReportKind>(forReport ? 'activity' : 'win');
  const [title, setTitle] = useState(forReport ? `Photos for ${forLabel}`.slice(0, PHOTO_TITLE_MAX) : '');
  const [day, setDay] = useState(today);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<[number, number] | null>(null);

  async function send() {
    if (!title.trim()) { toast.show('Please give it a title.'); return; }
    if (!files.length && !text.trim()) { toast.show('Add a few words or at least one photo.'); return; }
    setProgress([0, files.length]);
    try {
      const { id, failed } = await sendPhotoReport(org.id, { kind, title: title.trim(), day, text, reportId: forReport || null }, files, (d, of) => setProgress([d, of]));
      toast.show(failed.length ? `Sent, but ${failed.length} ${failed.length === 1 ? 'file' : 'files'} did not go: ${failed.join(', ')}. Open the report to add them again.` : 'Report sent. Thank you!');
      onSent(id);
    } catch (err) { toast.show(friendlyError(err)); } finally { setProgress(null); }
  }

  return (
    <section className="card stack">
      <h2>{forReport ? `Add photos to ${forLabel || 'the report'}` : 'New photo report'}</h2>
      {forReport && <p className="small muted">These photos will be printed at the end of the report's PDF.</p>}
      <div className="ph-kinds" role="radiogroup" aria-label="Kind of report">
        {PHOTO_REPORT_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`ph-kind${kind === k ? ' on' : ''}${k === 'incident' ? ' incident' : ''}`} onClick={() => setKind(k)}>
            <span aria-hidden="true">{PHOTO_REPORT_EMOJI[k]}</span>{PHOTO_REPORT_LABELS[k]}
          </button>
        ))}
      </div>
      {kind === 'incident' && <p className="notice notice-warn small">An incident is seen only by the Director, the board, Andy and Doreen.</p>}
      <label className="field"><span>Title</span><input value={title} maxLength={PHOTO_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'win' ? 'Amani read a whole book' : kind === 'activity' ? 'Sports day' : kind === 'incident' ? 'A child fell in the playground' : ''} /></label>
      <label className="field"><span>Date</span><input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></label>
      <label className="field"><span>What happened (a few lines)</span><textarea rows={4} value={text} maxLength={PHOTO_TEXT_MAX} onChange={(e) => setText(e.target.value)} /></label>
      <FilePicker files={files} setFiles={setFiles} max={MAX_PHOTO_FILES} />
      <div className="btn-line">
        <button type="button" className="btn btn-primary" disabled={!!progress} onClick={() => void send()}>
          {progress ? (progress[1] ? `Sending ${Math.min(progress[0] + 1, progress[1])} of ${progress[1]}…` : 'Sending…') : 'Send report'}
        </button>
        <button type="button" className="btn btn-quiet" disabled={!!progress} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

/** A photo from the report, fetched once; tapping it opens it full size. */
function Thumb({ org, report, file }: { org: Organization; report: StoredPhotoReport; file: PhotoFile }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let u = '';
    photoFile(org.id, report.id, file).then((f) => { u = URL.createObjectURL(f); setUrl(u); }).catch(() => setFailed(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [org.id, report.id, file]);
  if (!file.photo) {
    return <button type="button" className="ph-thumb ph-doc" onClick={() => void photoFile(org.id, report.id, file).then(downloadFile)}>📄<span className="ph-name">{file.name}</span></button>;
  }
  return (
    <a className="ph-thumb" href={url || undefined} target="_blank" rel="noreferrer" aria-label={file.name}>
      {url ? <img src={url} alt="" onError={() => setFailed(true)} /> : <span className="ph-name">{failed ? 'Tap to download' : 'Loading…'}</span>}
      {failed && url && <span className="ph-name">HEIC photo, tap to open</span>}
    </a>
  );
}

function ReportDetail({ org, report, list, onChanged, onClose }: { org: Organization; report: StoredPhotoReport; list: PhotoList; onChanged: () => void; onClose: () => void }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [more, setMore] = useState<File[]>([]);
  const mine = report.senderUid === profile?.uid;

  async function del() {
    setBusy('delete');
    try { await deletePhotoReport(org.id, report.id, reason); toast.show('Moved to the Bin. It can be put back from Reports → Bin.'); onChanged(); onClose(); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  async function restore() {
    setBusy('restore');
    try { await restorePhotoReport(org.id, report.id); toast.show('Put back.'); onChanged(); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  async function addMore() {
    setBusy('add');
    try {
      const failed = await addPhotoFiles(org.id, report.id, more, () => undefined);
      toast.show(failed.length ? `${failed.length} did not go: ${failed.join(', ')}` : 'Added.');
      setMore([]); onChanged();
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }

  return (
    <section className={`card stack${report.kind === 'incident' ? ' ph-incident' : ''}`}>
      <div className="card-head">
        <h2>{PHOTO_REPORT_EMOJI[report.kind]} {report.title}</h2>
        <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="small muted">
        {PHOTO_REPORT_LABELS[report.kind]} · {formatDateKey(report.day)} · sent by {report.senderName}
        {report.reportLabel && <> · for <Link to={`/hope/reports?report=${report.reportId}`}>{report.reportLabel}</Link></>}
      </p>
      {report.deleted && <p className="notice notice-warn small">Deleted by {report.deletedByName} on {formatDateKey(report.deletedOn)}{report.deleteReason ? `: ${report.deleteReason}` : '.'}</p>}
      {report.text && <p className="ph-text">{report.text}</p>}
      {report.files.length > 0 && <div className="ph-grid">{report.files.map((f) => <Thumb key={f.key} org={org} report={report} file={f} />)}</div>}
      {report.emailedOn && <p className="small muted">Emailed to {report.emailedTo?.join(', ')} on {formatDateKey(report.emailedOn)}.</p>}

      {mine && !report.deleted && report.files.length < MAX_PHOTO_FILES && (
        <details className="hr-fold">
          <summary><span>Add more photos or files</span></summary>
          <div className="stack">
            <FilePicker files={more} setFiles={setMore} max={MAX_PHOTO_FILES - report.files.length} />
            {more.length > 0 && <button type="button" className="btn btn-primary align-start" disabled={!!busy} onClick={() => void addMore()}>{busy === 'add' ? 'Adding…' : `Add ${more.length}`}</button>}
          </div>
        </details>
      )}

      {list.seesAll && !report.deleted && <SendOn org={org} report={report} onSent={onChanged} />}

      {list.deletes && (report.deleted ? (
        <button type="button" className="btn align-start" disabled={!!busy} onClick={() => void restore()}>{busy === 'restore' ? 'Putting back…' : '↩︎ Put it back'}</button>
      ) : asking ? (
        <div className="stack">
          <label className="field"><span>Why delete it? (optional)</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="btn-line">
            <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => void del()}>{busy === 'delete' ? 'Deleting…' : 'Delete'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>Keep it</button>
          </div>
        </div>
      ) : <button type="button" className="btn btn-quiet align-start" onClick={() => setAsking(true)}>🗑 Delete</button>)}
    </section>
  );
}

const waNumber = (phone: string) => phone.replace(/\D/g, '').replace(/^0/, '254');

/** Email and WhatsApp to the board, by button only (7A). */
function SendOn({ org, report, onSent }: { org: Organization; report: StoredPhotoReport; onSent: () => void }) {
  const toast = useToast();
  const [people, setPeople] = useState<BoardPerson[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || people) return;
    loadBoard(org.id).then((p) => { setPeople(p); setTicked(new Set(p.filter((x) => x.hasEmail).map((x) => x.name))); }).catch((err) => toast.show(friendlyError(err)));
  }, [open, people, org.id, toast]);
  const link = `${location.origin}/hope/photos?report=${report.id}`;
  const message = photoReportWhatsApp(report, link, formatDateKey);

  async function email() {
    setBusy('email');
    try { const to = await emailPhotoReport(org.id, report.id, [...ticked]); toast.show(`Emailed to ${to.join(', ')}.`); onSent(); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  /** On a phone, the photos go with the message: choose WhatsApp and the board group or person. */
  async function share() {
    setBusy('share');
    try {
      const files = await Promise.all(report.files.map((f) => photoFile(org.id, report.id, f)));
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (files.length && nav.canShare?.({ files, text: message })) {
        try { await nav.share({ files, text: message, title: report.title }); } catch (err) { if ((err as { name?: string }).name !== 'AbortError') throw err; }
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
      }
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }

  if (!open) return <button type="button" className="btn align-start" onClick={() => setOpen(true)}>📤 Send to the board</button>;
  return (
    <div className="stack ph-send">
      <h3>Send to the board</h3>
      {!people ? <p className="muted small">Loading…</p> : (
        <>
          <ul className="ph-people">
            {people.map((p) => (
              <li key={p.name}>
                <label className="check"><input type="checkbox" disabled={!p.hasEmail} checked={ticked.has(p.name)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(p.name); else n.delete(p.name); setTicked(n); }} /> {p.name}{!p.hasEmail && <span className="small muted"> (no email)</span>}</label>
                {p.phone && <a className="btn btn-quiet btn-small" href={`https://wa.me/${waNumber(p.phone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
              </li>
            ))}
          </ul>
          <div className="btn-line">
            <button type="button" className="btn btn-primary" disabled={!!busy || ticked.size === 0} onClick={() => void email()}>{busy === 'email' ? 'Emailing…' : `✉️ Email ${ticked.size}`}</button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => void share()}>{busy === 'share' ? 'Getting photos…' : '🟢 WhatsApp with photos'}</button>
          </div>
          <p className="small muted">Email sends the photos as attachments from the Hope Center's Gmail. "WhatsApp with photos" opens your phone's share menu: choose WhatsApp, then the person or group. The WhatsApp button next to a name sends the message and a link.</p>
        </>
      )}
    </div>
  );
}
