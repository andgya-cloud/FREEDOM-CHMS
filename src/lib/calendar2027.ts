import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { createStamps } from './records';
import { trackWrite } from './sync';
import { endsOnFor, type EventType, type Repeat } from '../../functions/src/shared/calendar';

/**
 * Freedom Church's 2027 calendar (Freedom_Church_Calendar_2027_v2.pdf, Andy 2026-11-14), added in one tap.
 * Weekly Freedom 252 classes are left out: they already show from the class register ("Also show → Classes").
 * Reminders: 1 day before for church events; none for public holidays, theme months and church-year days.
 */
interface Row {
  id: string;
  title: string;
  type: EventType;
  date: string;
  endDate?: string;
  start?: string;
  end?: string;
  notes?: string;
  repeat?: Repeat;
  repeatUntil?: string;
  skipDates?: string[];
  remind?: boolean;
}

const HOLIDAY = 'Public holiday in Kenya.';
const holiday = (id: string, date: string, title: string, notes = HOLIDAY): Row => ({ id, title, type: 'other', date, notes, remind: false });
const day = (id: string, date: string, title: string, type: EventType = 'service', notes?: string): Row => ({ id, title, type, date, notes, remind: true });
const churchYear = (id: string, date: string, title: string): Row => ({ id, title, type: 'service', date, remind: false });
const month = (id: string, date: string, endDate: string, title: string): Row => ({ id, title, type: 'other', date, endDate, notes: 'Theme of the month.', remind: false });

// Monthly prayer and fasting (Thursday and Friday), then Corporate Prayer on Saturday.
const FASTS: [string, string, string][] = [
  ['2027-02-25', '2027-02-26', '2027-02-27'], ['2027-03-25', '2027-03-26', '2027-03-27'], ['2027-04-29', '2027-04-30', '2027-05-01'],
  ['2027-05-27', '2027-05-28', '2027-05-29'], ['2027-06-24', '2027-06-25', '2027-06-26'], ['2027-07-29', '2027-07-30', '2027-07-31'],
  ['2027-08-26', '2027-08-27', '2027-08-28'], ['2027-09-23', '2027-09-24', '2027-09-25'], ['2027-10-28', '2027-10-29', '2027-10-30'],
  ['2027-11-25', '2027-11-26', '2027-11-27'],
];

export const CALENDAR_2027: Row[] = [
  // Every week and every month
  { id: 'bible-study', title: 'Bible Study + Prayer', type: 'meeting', date: '2027-01-06', start: '20:00', end: '21:00', repeat: 'weekly', repeatUntil: '2027-12-08', skipDates: ['2027-01-13', '2027-01-20', '2027-01-27'], notes: 'Every Wednesday. Not during the 21 days of prayer and fasting in January.', remind: false },
  { id: 'communion', title: 'Communion', type: 'service', date: '2027-01-03', repeat: 'monthlyWeekday', repeatUntil: '2027-12-05', notes: 'First Sunday of every month.', remind: true },

  // January
  holiday('new-year', '2027-01-01', "New Year's Day"),
  { id: '21-days', title: '21 Days of Prayer & Fasting', type: 'other', date: '2027-01-09', endDate: '2027-01-29', notes: 'Daily online prayer and Bible study, 8 to 9 pm. The fast begins Saturday 9 January and ends Friday 29 January.', remind: true },
  day('corp-jan', '2027-01-30', 'Corporate Prayer', 'meeting'),

  // February
  month('m-feb', '2027-02-01', '2027-02-28', 'Relationship Month'),
  day('dream-feb', '2027-02-06', 'Dream Team · Team Building', 'training'),
  churchYear('ash', '2027-02-10', 'Ash Wednesday'),
  day('couples', '2027-02-13', "Couples' Dinner", 'celebration'),
  { id: 'valentine', title: "Valentine's Day", type: 'celebration', date: '2027-02-14', remind: false },
  { id: 'usa-men', title: "Freedom USA Men's Mission Team", type: 'outreach', date: '2027-02-18', endDate: '2027-02-27', remind: true },

  // March
  holiday('idd', '2027-03-10', 'Idd-ul-Fitr', 'Public holiday in Kenya. The date is confirmed by the government gazette.'),
  day('dedication-mar', '2027-03-14', 'Child Dedication'),
  day('kem-mar', '2027-03-14', 'Kingdom Excellence in the Marketplace', 'meeting'),
  day('elam', '2027-03-21', 'Guest speaker: Dr. Rev. Paul Elam (Michigan, USA)'),
  churchYear('palm', '2027-03-21', 'Palm Sunday'),
  holiday('good-friday', '2027-03-26', 'Good Friday'),
  day('easter', '2027-03-28', 'Easter Sunday'),
  holiday('easter-monday', '2027-03-29', 'Easter Monday'),

  // April
  month('m-apr', '2027-04-01', '2027-04-30', 'Groups Month'),
  day('men-apr', '2027-04-04', "Men's Sunday"),
  day('vbs-apr', '2027-04-09', 'VBS (Vacation Bible School)', 'outreach'),
  day('women-apr', '2027-04-11', "Women's Sunday"),
  day('youth-apr', '2027-04-18', 'Youth Sunday'),
  day('baptism-apr', '2027-04-24', 'Water Baptism'),
  day('kids-apr', '2027-04-25', 'Kids Sunday'),

  // May
  holiday('labour', '2027-05-01', 'Labour Day'),
  day('worship-may', '2027-05-02', 'Worship Team Sunday'),
  churchYear('ascension', '2027-05-06', 'Ascension Day'),
  day('mothers', '2027-05-09', "Mother's Day", 'celebration'),
  churchYear('pentecost', '2027-05-16', 'Pentecost Sunday'),

  // June
  holiday('madaraka', '2027-06-01', 'Madaraka Day'),
  { id: 'serve-week', title: 'Serve Week', type: 'outreach', date: '2027-06-06', endDate: '2027-06-13', notes: 'Tangibly serving our community, meeting felt needs.', remind: true },
  { id: 'comms-class', title: 'Communication Master Class', type: 'training', date: '2027-06-08', repeat: 'weekly', repeatUntil: '2027-07-13', notes: 'Six Tuesday classes, 8 June to 13 July.', remind: true },
  day('fathers', '2027-06-20', "Father's Day", 'celebration'),

  // July
  day('kem-jul', '2027-07-11', 'Kingdom Excellence in the Marketplace', 'meeting'),
  day('nines', '2027-07-25', 'THE NINES'),

  // August
  day('baptism-aug', '2027-08-07', 'Water Baptism'),
  day('vbs-aug', '2027-08-13', 'VBS (Vacation Bible School)', 'outreach'),
  day('f252-grad', '2027-08-15', 'Freedom 252 Graduation', 'celebration'),
  day('dedication-aug', '2027-08-22', 'Child Dedication'),
  day('conference', '2027-08-22', 'Freedom Conference'),

  // September
  month('m-sep', '2027-09-01', '2027-09-30', 'Groups Month'),
  day('men-sep', '2027-09-05', "Men's Sunday"),
  day('women-sep', '2027-09-12', "Women's Sunday"),
  day('youth-sep', '2027-09-19', 'Youth Sunday'),
  day('kids-sep', '2027-09-26', 'Kids Sunday'),

  // October
  day('worship-oct', '2027-10-03', 'Worship Team Sunday'),
  holiday('utamaduni', '2027-10-10', 'Utamaduni Day'),
  holiday('utamaduni-obs', '2027-10-11', 'Utamaduni Day (observed)'),
  holiday('mashujaa', '2027-10-20', 'Mashujaa Day'),
  day('baptism-oct', '2027-10-23', 'Water Baptism'),

  // November
  day('kem-nov', '2027-11-14', 'Kingdom Excellence in the Marketplace', 'meeting'),
  day('dream-nov', '2027-11-20', 'Dream Team · Team Building', 'training'),
  churchYear('advent', '2027-11-28', 'Advent Sunday'),

  // December
  day('christmas-sun', '2027-12-12', 'Christmas Sunday'),
  holiday('jamhuri', '2027-12-12', 'Jamhuri Day'),
  holiday('jamhuri-obs', '2027-12-13', 'Jamhuri Day (observed)'),
  holiday('christmas', '2027-12-25', 'Christmas Day'),
  holiday('boxing', '2027-12-26', 'Boxing Day'),
  holiday('boxing-obs', '2027-12-27', 'Boxing Day (observed)'),

  ...FASTS.flatMap(([thu, fri, sat]): Row[] => [
    { id: `fast-${thu.slice(5, 7)}`, title: 'Prayer & Fasting', type: 'other', date: thu, endDate: fri, notes: 'Monthly prayer and fasting, Thursday and Friday.', remind: false },
    day(`corp-${thu.slice(5, 7)}`, sat, 'Corporate Prayer', 'meeting'),
  ]),
];

export const CALENDAR_2027_PREFIX = 'fc2027-';

/** Adds every 2027 entry to the church's calendar in one go. Fixed ids, so the same entry is never added twice. */
export function addCalendar2027(orgId: string, byName: string): Promise<unknown> {
  const batch = writeBatch(db);
  for (const r of CALENDAR_2027) {
    const allDay = !r.start;
    const base = {
      title: r.title, type: r.type, allDay, date: r.date, endDate: r.endDate ?? r.date,
      start: r.start ?? null, end: r.end ?? null, place: '', inCharge: '', notes: r.notes ?? '',
      repeat: r.repeat ?? 'none', repeatUntil: r.repeatUntil ?? null,
      reminders: r.remind ? [1440] : [], remindAll: false, invited: [], invitedNames: {},
    };
    batch.set(doc(db, 'organizations', orgId, 'calendar', CALENDAR_2027_PREFIX + r.id), {
      orgId, ...base, endsOn: endsOnFor(base), skipDates: r.skipDates ?? [], seriesId: null, seriesDate: null, responses: {},
      createdByName: byName.slice(0, 120), ...createStamps(),
    });
  }
  return trackWrite(batch.commit());
}
