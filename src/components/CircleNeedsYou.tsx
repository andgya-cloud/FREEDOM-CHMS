import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import type { Organization } from '../state/OrgContext';
import { useChats } from '../pages/hope/HopeChatsPage';
import { usePhotoReports } from '../pages/hope/HopePhotosPage';
import { circleOf } from '../../functions/src/shared/circles';
import { isUnread } from '../../functions/src/shared/hopeChats';
import { PHOTO_REPORT_EMOJI } from '../../functions/src/shared/hopePhotos';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/**
 * "Needs you" on ADIA's and Freedom Church's Today (Andy, 2026-11-07, 9A), in the Hope Centre's clean white cards:
 * the urgent conversations about a student or member (one line each, with the latest words), the conversations with
 * new messages, and the reports with new messages. Readers only; everyone else gets the "Send a report" button.
 */
/** The counts behind "Needs you", shared with the church's "Needs you today" list. Null until loaded. */
export function useCircleNeeds(org: Organization) {
  const me = useAuth().profile?.uid ?? '';
  const circle = circleOf(org.type);
  const chats = useChats(org.id).list;
  const reports = usePhotoReports(org.id).list;
  const { urgent, unread, fresh, incidents } = useMemo(() => {
    const open = (chats?.reader ? chats.chats : []).filter((c) => c.status === 'open');
    const byPerson = new Map<string, typeof open>();
    for (const c of open) byPerson.set(c.childId, [...(byPerson.get(c.childId) ?? []), c]);
    const urgent = [...byPerson.values()].map((list) => {
      const latest = [...list].sort((x, y) => y.lastAt.localeCompare(x.lastAt))[0]!;
      return { id: latest.id, who: latest.childName, many: list.length, line: latest.lastText ? `${latest.lastByName.split(' ')[0]}: ${latest.lastText}` : 'Not yet handled' };
    });
    const unread = (chats?.reader ? chats.chats : []).filter((c) => (c.status === 'open' || c.status === 'handling') && isUnread(c, me)).length;
    const live = (reports?.reports ?? []).filter((r) => r.status !== 'sent');
    const fresh = live.filter((r) => r.lastAt && (!r.seen?.[me] || r.seen[me]! < r.lastAt));
    const incidents = live.filter((r) => r.kind === 'incident' && r.status !== 'resolved').length;
    return { urgent, unread, fresh, incidents };
  }, [chats, reports, me]);
  if (!chats || !reports) return null;
  return { circle, urgent, unread, fresh, incidents, reader: reports.seesAll || chats.reader, sends: reports.sends };
}

export function CircleNeedsYou({ org, offerSend = false }: { org: Organization; offerSend?: boolean }) {
  const needs = useCircleNeeds(org);
  if (!needs) return null;
  const { circle, urgent, unread, fresh, incidents } = needs;
  if (!needs.reader) {
    // Staff send a report from here (the church's Today has no job buttons).
    return offerSend && needs.sends ? (
      <section className="card circle-send"><Link to={`${circle.photosPath}?new=1`} className="btn">📷 Send a report or good news</Link></section>
    ) : null;
  }
  const total = urgent.length + unread + fresh.length + incidents;
  return (
    <section className="ht-needs nu circle-needs" aria-label="Needs you">
      <div className="nu-head"><h2>Needs you</h2>
        <div className="nu-pills"><Link className="nu-pill" to={`${circle.photosPath}?new=1`}>📷 New report</Link><Link className="nu-pill" to={circle.vaultPath}>🔒 Conversations</Link></div></div>
      {total === 0 && <div className="nu-card nu-c-blue"><p className="muted">✅ Nothing needs you right now. <Link to={circle.photosPath}>Photos and wins ›</Link></p></div>}
      {urgent.length > 0 && (
        <div className="nu-card nu-c-red nu-urgent">
          <div className="nu-urgent-top">
            <span className="nu-dot" aria-hidden="true" />
            <span className="grow"><b>{urgent.length === 1 ? `1 ${circle.person} has an ` : `${urgent.length} ${circle.people} have an `}<em>urgent</em> conversation</b><span>Not yet handled. Tap a name to open it.</span></span>
          </div>
          <ul className="nu-urgent-list">
            {urgent.map((u) => (
              <li key={u.id}><Link to={u.many > 1 ? circle.vaultPath : `${circle.chatsPath}/${u.id}`}>
                <span className="avatar circle-face" aria-hidden="true">{initials(u.who)}</span>
                <span className="grow"><b>{u.who}</b><span>{u.many > 1 ? `${u.many} conversations · ` : ''}{u.line}</span></span>
                <span className="nu-go" aria-hidden="true">›</span>
              </Link></li>
            ))}
          </ul>
        </div>
      )}
      {(unread > 0 || fresh.length > 0 || incidents > 0) && (
        <div className="nu-grid">
          {unread > 0 && (
            <Link to={circle.vaultPath} className="nu-card nu-tile nu-c-violet">
              <span className="nu-tile-top"><span aria-hidden="true">🔒</span><span className="nu-label">Private conversations</span></span>
              <b className="nu-big">{unread}</b><span className="nu-sub">with new messages</span><span className="nu-open">Open ›</span>
            </Link>
          )}
          {fresh.length > 0 && (
            <Link to={fresh.length === 1 ? `${circle.photosPath}?report=${fresh[0]!.id}` : circle.photosPath} className="nu-card nu-tile nu-c-blue">
              <span className="nu-tile-top"><span aria-hidden="true">📷</span><span className="nu-label">Photos and wins</span></span>
              <b className="nu-big">{fresh.length}</b>
              <span className="nu-sub">{fresh.length === 1 ? `${PHOTO_REPORT_EMOJI[fresh[0]!.kind]} ${fresh[0]!.title}` : 'reports with new messages'}</span>
              <span className="nu-open">Open ›</span>
            </Link>
          )}
          {incidents > 0 && (
            <Link to={circle.photosPath} className="nu-card nu-tile nu-c-gold">
              <span className="nu-tile-top"><span aria-hidden="true">⚠️</span><span className="nu-label">Incidents</span></span>
              <b className="nu-big">{incidents}</b><span className="nu-sub">not resolved yet</span><span className="nu-open">Open ›</span>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
