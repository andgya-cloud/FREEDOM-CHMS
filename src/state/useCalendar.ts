import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { ESTIMATE } from '../lib/firestoreOptions';
import { useAuth } from './AuthContext';
import { usePeople } from './PeopleContext';
import type { Organization } from './OrgContext';
import {
  addDays, daysInMonth, occurrences, serviceSlots, weekdayOf, type CalendarEvent, type EventType,
} from '../../functions/src/shared/calendar';

/** One thing drawn on the calendar on one day: an event's occurrence, or a date the app already knows. */
export interface CalItem {
  key: string;
  orgId: string;
  title: string;
  type: EventType;
  allDay: boolean;
  /** The day this occurrence starts, and the day it ends. */
  date: string;
  endDate: string;
  start: string | null;
  end: string | null;
  place: string;
  event?: CalendarEvent;
  auto?: { kind: AutoKind; link?: string; detail?: string };
}

export type AutoKind = 'birthdays' | 'services' | 'classes' | 'close';
export const AUTO_LAYERS: { id: AutoKind; label: string }[] = [
  { id: 'services', label: 'Sunday services' },
  { id: 'classes', label: 'Classes (Freedom 252)' },
  { id: 'birthdays', label: 'Birthdays' },
  { id: 'close', label: 'Petty cash month close' },
];

/** Each place's colour on the calendar (1A). */
export function orgColour(org: Pick<Organization, 'type'> | undefined): string {
  return org?.type === 'college' ? '#b8862f' : org?.type === 'ministry' ? '#0e8f95' : '#3d8b5a';
}
export function orgShort(org: Pick<Organization, 'type' | 'name'> | undefined): string {
  return org?.type === 'college' ? 'ADIA' : org?.type === 'ministry' ? 'Hope' : org?.type === 'church_campus' ? 'Church' : org?.name ?? '';
}

/** Every event of the given places, live (from the device cache when offline). */
export function useCalendarEvents(orgIds: string[]): { events: CalendarEvent[]; loading: boolean; error: string } {
  const [byOrg, setByOrg] = useState<Record<string, CalendarEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const key = orgIds.join(',');
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    setByOrg({});
    if (!ids.length) { setLoading(false); return; }
    setLoading(true);
    let waiting = ids.length;
    const stops = ids.map((orgId) => onSnapshot(query(collection(db, 'organizations', orgId, 'calendar'), where('deletedAt', '==', null)), (snap) => {
      setByOrg((m) => ({ ...m, [orgId]: snap.docs.map((d) => ({ id: d.id, ...d.data(ESTIMATE) }) as CalendarEvent) }));
      waiting -= 1;
      if (waiting <= 0) setLoading(false);
      setError('');
    }, (err) => { setError(err.code); setLoading(false); }));
    return () => stops.forEach((s) => s());
  }, [key]);
  const events = useMemo(() => Object.values(byOrg).flat(), [byOrg]);
  return { events, loading, error };
}

/** The events' occurrences between from and to, earliest first. */
export function expandEvents(events: CalendarEvent[], from: string, to: string): CalItem[] {
  const out: CalItem[] = [];
  for (const e of events) {
    if (e.deletedAt) continue;
    for (const o of occurrences(e, from, to)) {
      out.push({ key: `${e.orgId}/${e.id}/${o.date}`, orgId: e.orgId, title: e.title, type: e.type, allDay: e.allDay, date: o.date, endDate: o.endDate, start: e.start, end: e.end, place: e.place, event: e });
    }
  }
  return sortItems(out);
}

export function sortItems(items: CalItem[]): CalItem[] {
  return items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.start ?? '').localeCompare(b.start ?? '') || a.title.localeCompare(b.title));
}

interface ClassRow { id: string; date: string; name: string; type: string; programId?: string | null; deletedAt?: unknown }

/** Programme classes (such as Freedom 252) of one place in the days shown. */
function useClasses(orgIds: string[], from: string, to: string, on: boolean): Record<string, ClassRow[]> {
  const [rows, setRows] = useState<Record<string, ClassRow[]>>({});
  const key = orgIds.join(',');
  useEffect(() => {
    const ids = on && key ? key.split(',') : [];
    setRows({});
    if (!ids.length) return;
    const stops = ids.map((orgId) => onSnapshot(query(collection(db, 'organizations', orgId, 'events'), where('date', '>=', from), where('date', '<=', to)), (snap) => {
      setRows((m) => ({ ...m, [orgId]: snap.docs.map((d) => ({ id: d.id, ...d.data(ESTIMATE) }) as ClassRow) }));
    }, () => undefined));
    return () => stops.forEach((s) => s());
  }, [key, from, to, on]);
  return rows;
}

/**
 * Dates the app already knows (8A): Sunday services from each church's service times, programme classes such as
 * Freedom 252, birthdays (one line per day), and petty cash month close on the last day of each month.
 */
export function useAutoItems(orgs: Organization[], from: string, to: string, layers: Set<AutoKind>): CalItem[] {
  const { can } = useAuth();
  const { people } = usePeople();
  const seesPeople = can('people.read');
  const seesClasses = seesPeople || can('attendance.write');
  const seesClose = can('pettycash.request') || can('pettycash.approve') || can('pettycash.authorize') || can('finance.reports') || can('users.manage');
  const classOrgs = orgs.filter((o) => o.type !== 'college').map((o) => o.id);
  const classes = useClasses(classOrgs, from, to, seesClasses && layers.has('classes'));

  return useMemo(() => {
    const out: CalItem[] = [];
    const days: string[] = [];
    for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push(d);

    if (layers.has('services')) {
      for (const org of orgs.filter((o) => o.type === 'church_campus')) {
        const slots = serviceSlots(org.serviceTimes?.length ? org.serviceTimes : ['Sunday 10:00']);
        for (const d of days) {
          for (const s of slots.filter((x) => x.weekday === weekdayOf(d))) {
            out.push({ key: `auto/svc/${org.id}/${d}/${s.time}`, orgId: org.id, title: s.weekday === 0 ? 'Sunday service' : `Service (${s.name})`, type: 'service', allDay: false, date: d, endDate: d, start: s.time, end: null, place: '', auto: { kind: 'services', link: '/attendance', detail: 'From the service times in Settings. Take attendance on the day.' } });
          }
        }
      }
    }
    if (layers.has('classes') && seesClasses) {
      for (const org of orgs) {
        for (const c of classes[org.id] ?? []) {
          if (c.deletedAt || c.type !== 'class' || !c.programId) continue;
          out.push({ key: `auto/cls/${org.id}/${c.id}`, orgId: org.id, title: c.name, type: 'training', allDay: false, date: c.date, endDate: c.date, start: c.programId === 'freedom_252' ? '20:00' : null, end: c.programId === 'freedom_252' ? '21:00' : null, place: c.programId === 'freedom_252' ? 'Google Meet' : '', auto: { kind: 'classes', link: '/programs', detail: 'A programme class. Open Programmes for the register.' } });
        }
      }
    }
    if (layers.has('birthdays') && seesPeople) {
      const shownOrgs = new Set(orgs.filter((o) => o.type === 'church_campus').map((o) => o.id));
      const byDay = new Map<string, string[]>();
      for (const p of people) {
        if (!p.birthday || !shownOrgs.has(p.orgId) || p.status === 'inactive') continue;
        byDay.set(p.birthday, [...(byDay.get(p.birthday) ?? []), p.firstName || p.fullName]);
      }
      for (const d of days) {
        const names = byDay.get(d.slice(5)) ?? [];
        if (!names.length) continue;
        const orgId = [...shownOrgs][0] ?? '';
        out.push({ key: `auto/bd/${d}`, orgId, title: names.length === 1 ? `🎂 ${names[0]}'s birthday` : `🎂 ${names.length} birthdays`, type: 'celebration', allDay: true, date: d, endDate: d, start: null, end: null, place: '', auto: { kind: 'birthdays', link: '/', detail: names.sort().join(', ') } });
      }
    }
    if (layers.has('close') && seesClose && orgs.length) {
      // One line for every place, so three places do not fill the last day of the month.
      const names = orgs.map((o) => o.name).join(', ');
      for (const d of days) {
        const y = Number(d.slice(0, 4));
        const m = Number(d.slice(5, 7));
        if (Number(d.slice(8, 10)) !== daysInMonth(y, m)) continue;
        out.push({ key: `auto/close/${d}`, orgId: orgs[0]!.id, title: 'Petty cash month close', type: 'deadline', allDay: true, date: d, endDate: d, start: null, end: null, place: '', auto: { kind: 'close', link: '/finance', detail: `Close the month in Financial statements once the bank statement is in (${names}).` } });
      }
    }
    return out;
  }, [orgs, from, to, layers, classes, people, seesPeople, seesClasses, seesClose]);
}

/** This person's email reminder choice (on unless they switched it off). */
export function useEmailReminders(uid: string | undefined): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'calendarPrefs', uid), (s) => setOn(s.get('email') !== false), () => undefined);
  }, [uid]);
  return on;
}
