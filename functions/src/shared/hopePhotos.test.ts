import { describe, expect, it } from 'vitest';
import {
  canDeletePhotoReport, canSeeAllPhotoReports, canSeePhotoReport, canSendPhotoReport, photoFileName, photoFileTypeOf, photoReportEmail, photoReportWhatsApp,
  builtInFace, canApprove, canRemoveFiles, faceKey, needsFollowUpReminder, storyChanges, storyRef,
  canEditMessage, canPackageStory, canUnsay, canWriteInStory, cleanIncident, incidentRows, storyStartEmail, storyStartWhatsApp, storyTimeline, storyTint,
} from './hopePhotos';

const HOPE = 'hope1';
const user = (o: Record<string, unknown>) => ({ active: true, orgIds: [HOPE], permissions: [] as string[], ...o });
const director = user({ roleId: 'head', displayName: 'Diana Kiunga', permissions: ['people.read', 'attendance.write', 'team.manage'] });
const helper = user({ roleId: 'helper', displayName: 'Mary Helper', permissions: ['people.read', 'attendance.write'] });
const staff = user({ roleId: 'staff', displayName: 'John Staff', permissions: ['people.read', 'people.write', 'attendance.write'] });
const andy = { active: true, allOrgs: true, roleId: 'pastor', displayName: 'Andrew Guya', permissions: ['users.manage', 'people.read'] };
const doreen = { active: true, allOrgs: true, roleId: 'admin', displayName: 'Doreen Mayaka', permissions: ['users.manage'] };
const board = user({ roleId: 'signatory', displayName: "Daniel Ojwang'", permissions: ['pettycash.request'] });
const otherOrgHead = { ...director, orgIds: ['adia'] };

describe('Hope photo reports access (Andy, 2026-11-04)', () => {
  it('lets the Director, staff and helpers send (2A)', () => {
    expect(canSendPhotoReport(director, HOPE)).toBe(true);
    expect(canSendPhotoReport(helper, HOPE)).toBe(true);
    expect(canSendPhotoReport(staff, HOPE)).toBe(true);
    expect(canSendPhotoReport(otherOrgHead, HOPE)).toBe(false);
  });
  it('shows every report only to the Director, the board, Andy and Doreen, not Hope staff (3A)', () => {
    for (const p of [director, andy, doreen, board]) expect(canSeeAllPhotoReports(p, HOPE)).toBe(true);
    for (const p of [helper, staff, otherOrgHead]) expect(canSeeAllPhotoReports(p, HOPE)).toBe(false);
    const r = { orgId: HOPE, senderUid: 'u-helper', deleted: false };
    expect(canSeePhotoReport(helper, 'u-helper', r)).toBe(true);
    expect(canSeePhotoReport(staff, 'u-staff', r)).toBe(false);
  });
  it('lets only the Director, Andy and Doreen delete, and see deleted ones (8A)', () => {
    for (const p of [director, andy, doreen]) expect(canDeletePhotoReport(p, HOPE)).toBe(true);
    for (const p of [board, helper, staff]) expect(canDeletePhotoReport(p, HOPE)).toBe(false);
    const gone = { orgId: HOPE, senderUid: 'u-helper', deleted: true };
    expect(canSeePhotoReport(helper, 'u-helper', gone)).toBe(false);
    expect(canSeePhotoReport(board, 'u-board', gone)).toBe(false);
    expect(canSeePhotoReport(director, 'u-dir', gone)).toBe(true);
  });
  it('a pretend "Andrew Guya" without users.manage is not Andy', () => {
    const fake = user({ roleId: 'staff', displayName: 'Andrew Guya', permissions: ['people.read'] });
    expect(canDeletePhotoReport(fake, HOPE)).toBe(false);
  });
});

describe('Hope photo files (4A)', () => {
  const pad = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  it('knows photos and documents by their first bytes', () => {
    expect(photoFileTypeOf(pad(0xff, 0xd8, 0xff, 0xe0))?.ext).toBe('jpg');
    expect(photoFileTypeOf(pad(0x89, 0x50, 0x4e, 0x47))?.ext).toBe('png');
    expect(photoFileTypeOf(pad(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))?.ext).toBe('webp');
    expect(photoFileTypeOf(pad(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63))).toMatchObject({ ext: 'heic', photo: true });
    expect(photoFileTypeOf(pad(0x25, 0x50, 0x44, 0x46, 0x2d))).toMatchObject({ ext: 'pdf', photo: false });
    expect(photoFileTypeOf(pad(0x50, 0x4b, 0x03, 0x04))?.ext).toBe('docx');
    expect(photoFileTypeOf(pad(0x3c, 0x73, 0x76, 0x67))).toBeNull();
  });
  it('names files safely', () => expect(photoFileName('Sports day: 3/11', 2, 'jpg')).toBe('Sports day- 3-11 2.jpg'));
  it('writes the email and the WhatsApp message', () => {
    const r = { kind: 'incident' as const, title: 'A fall', day: '2026-11-04', text: 'Knee grazed.', senderName: 'Mary', reportLabel: null, files: [{ key: '1', name: 'a.jpg', contentType: 'image/jpeg', size: 1, photo: true }] };
    const e = photoReportEmail(r, 'Freedom Hope Center', 'https://x/y', (k) => k);
    expect(e.subject).toBe('Incident: A fall (Freedom Hope Center)');
    expect(e.text).toContain('1 file is attached.');
    expect(photoReportWhatsApp(r, 'https://x/y', (k) => k)).toContain('*Incident: A fall*');
  });
});

describe('Photos and wins as conversations (Andy, 2026-11-06)', () => {
  const r = { orgId: HOPE, senderUid: 'u-helper', deleted: false };
  it('lets the Director, the sender, the board, Andy and Doreen write (4A); not other staff', () => {
    expect(canWriteInStory(director, 'u-dir', r)).toBe(true);
    expect(canWriteInStory(helper, 'u-helper', r)).toBe(true);
    expect(canWriteInStory(board, 'u-board', r)).toBe(true);
    expect(canWriteInStory(andy, 'u-andy', r)).toBe(true);
    expect(canWriteInStory(staff, 'u-staff', r)).toBe(false);
    expect(canWriteInStory(director, 'u-dir', { ...r, deleted: true })).toBe(false);
  });
  it('lets the writer delete within five minutes; after that only Andy or Doreen', () => {
    const at = '2026-11-06T09:00:00.000Z';
    const t = Date.parse(at);
    const m = { byUid: 'u-dir', at };
    expect(canUnsay(director, 'u-dir', m, t + 4 * 60_000)).toBe(true);
    expect(canUnsay(director, 'u-dir', m, t + 6 * 60_000)).toBe(false);
    expect(canUnsay(board, 'u-board', m, t + 60_000)).toBe(false);
    expect(canUnsay(andy, 'u-andy', m, t + 9e9)).toBe(true);
    expect(canUnsay(doreen, 'u-doreen', m, t + 9e9)).toBe(true);
    expect(canUnsay(andy, 'u-andy', { ...m, deleted: true }, t)).toBe(false);
  });
  it('lets only the writer edit, at any time', () => {
    expect(canEditMessage('u-dir', { byUid: 'u-dir' })).toBe(true);
    expect(canEditMessage('u-andy', { byUid: 'u-dir' })).toBe(false);
    expect(canEditMessage('u-dir', { byUid: 'u-dir', deleted: true })).toBe(false);
  });
  it('lets the Director, Andy and Doreen package it for the board (6A)', () => {
    for (const p of [director, andy, doreen]) expect(canPackageStory(p, HOPE)).toBe(true);
    for (const p of [board, helper]) expect(canPackageStory(p, HOPE)).toBe(false);
  });
  it('gives each person their own tint (2A)', () => {
    expect(storyTint('Diana Kiunga')).toBe('#038241');
    expect(storyTint('Andrew Guya')).toBe('#1f2a5c');
    expect(storyTint('Doreen Mayaka')).toBe('#c99a3c');
    expect(storyTint('Mary Helper', 'u1')).toBe(storyTint('Mary Helper', 'u1'));
  });
  it('knows Office files and videos (3A)', () => {
    const pad = (...b: number[]) => new Uint8Array([...b, ...new Array(24).fill(0)]);
    const zip = pad(0x50, 0x4b, 0x03, 0x04);
    expect(photoFileTypeOf(zip, 'Budget.xlsx')?.ext).toBe('xlsx');
    expect(photoFileTypeOf(zip, 'Talk.PPTX')?.ext).toBe('pptx');
    expect(photoFileTypeOf(zip, 'Letter.docx')?.ext).toBe('docx');
    expect(photoFileTypeOf(pad(0xd0, 0xcf, 0x11, 0xe0), 'old.xls')?.ext).toBe('xls');
    const ftyp = (brand: string) => pad(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, ...[...brand].map((c) => c.charCodeAt(0)));
    expect(photoFileTypeOf(ftyp('isom'))).toMatchObject({ ext: 'mp4', video: true, photo: false });
    expect(photoFileTypeOf(ftyp('qt  '))).toMatchObject({ ext: 'mov', contentType: 'video/quicktime' });
    expect(photoFileTypeOf(ftyp('heic'))?.photo).toBe(true);
  });
  it('keeps the incident details tidy (7A)', () => {
    const i = cleanIncident({ time: '14:30', place: ' Playground ', hurt: 'Amani', action: 'First aid', parentsTold: true, followUp: '', extra: 1 })!;
    expect(i).toEqual({ time: '14:30', place: 'Playground', hurt: 'Amani', action: 'First aid', parentsTold: true, followUp: '', severity: null });
    expect(cleanIncident({ severity: 'high' })?.severity).toBe('high');
    expect(cleanIncident({ severity: 'huge' })?.severity).toBeNull();
    expect(cleanIncident({ time: '25:00' })?.time).toBe('');
    expect(incidentRows(i).map(([k]) => k)).toEqual(['Time', 'Where', 'Who was hurt', 'What was done', 'Parents told']);
  });
  it('puts the opening first, then the replies by time', () => {
    const rep = { orgId: HOPE, kind: 'win' as const, title: 'Book', day: '2026-11-06', text: 'Amani read', files: [], reportId: null, reportLabel: null, senderUid: 'u', senderName: 'Diana Kiunga', deleted: false, startedAt: '2026-11-06T08:00:00Z' };
    const t = storyTimeline(rep, [{ id: 'b', text: '2', byUid: 'x', byName: 'X', byRole: '', at: '2026-11-06T10:00:00Z', files: [] }, { id: 'a', text: '1', byUid: 'x', byName: 'X', byRole: '', at: '2026-11-06T09:00:00Z', files: [] }]);
    expect(t.map((m) => m.id)).toEqual(['opening', 'a', 'b']);
  });
  it('writes the start email and the WhatsApp note with the link', () => {
    const rep = { kind: 'incident' as const, title: 'A fall', day: '2026-11-06', senderName: 'Diana Kiunga' };
    const e = storyStartEmail(rep, 'Andrew', 'https://x/y', (k) => k);
    expect(e.subject).toBe('Incident: A fall (Freedom Hope Center)');
    expect(e.text).toContain('Dear Andrew');
    expect(e.text).toContain('https://x/y');
    expect(storyStartWhatsApp(rep, 'https://x/y')).toContain('https://x/y');
  });
});

describe('Official conversations (Andy, 2026-11-06, v193)', () => {
  it('lets only Andy and Doreen take out photos (1A)', () => {
    expect(canRemoveFiles(andy)).toBe(true);
    expect(canRemoveFiles(doreen)).toBe(true);
    expect(canRemoveFiles(director)).toBe(false);
    expect(canRemoveFiles(board)).toBe(false);
  });
  it('numbers the reports (4A)', () => expect(storyRef(2026, 14)).toBe('FHC-2026-014'));
  it('keeps each approval to the right people (7A)', () => {
    expect(canApprove(director, HOPE, 'director')).toBe(true);
    expect(canApprove(board, HOPE, 'director')).toBe(false);
    expect(canApprove(board, HOPE, 'board')).toBe(true);
    expect(canApprove(andy, HOPE, 'board')).toBe(true);
    expect(canApprove(helper, HOPE, 'board')).toBe(false);
  });
  it('reminds about an incident follow-up after 48 hours, once (8A)', () => {
    const t = Date.parse('2026-11-06T09:00:00Z');
    const r = { kind: 'incident' as const, deleted: false, startedAt: '2026-11-06T09:00:00Z', status: 'open' as const };
    expect(needsFollowUpReminder(r, t + 47 * 3_600_000)).toBe(false);
    expect(needsFollowUpReminder(r, t + 49 * 3_600_000)).toBe(true);
    expect(needsFollowUpReminder({ ...r, followUpDoneAt: 'x' }, t + 49 * 3_600_000)).toBe(false);
    expect(needsFollowUpReminder({ ...r, reminderSentAt: 'x' }, t + 49 * 3_600_000)).toBe(false);
    expect(needsFollowUpReminder({ ...r, kind: 'win' }, t + 49 * 3_600_000)).toBe(false);
    expect(needsFollowUpReminder({ ...r, status: 'resolved' }, t + 49 * 3_600_000)).toBe(false);
  });
  it('lists the changes for the PDF (9A)', () => {
    const c = storyChanges(
      { senderName: 'Diana Kiunga', editedAt: '2026-11-06T10:00:00Z', textHistory: [{ text: 'a', at: '' }], removed: [{ messageId: 'm', removedByName: 'Andrew Guya', removedAt: '2026-11-06T11:00:00Z', file: { key: 'k', name: 'p.jpg', contentType: 'image/jpeg', size: 1, photo: true } }] },
      [{ text: '', byUid: 'x', byName: 'Elias Omondi', byRole: '', at: '2026-11-06T09:30:00Z', files: [], deleted: true, deletedByName: 'Doreen Mayaka', deletedAt: '2026-11-06T12:00:00Z' },
        { text: 'x', byUid: 'y', byName: 'Bot', byRole: '', at: '2026-11-06T09:40:00Z', files: [], system: true }],
    );
    expect(c.map((x) => x.text)).toEqual([
      'Diana Kiunga edited the opening message (1 earlier version kept).',
      'Andrew Guya took out the file "p.jpg".',
      'Doreen Mayaka deleted a message from Elias Omondi.',
    ]);
  });
  it('keys faces by plain name', () => expect(faceKey("Daniel Ojwang'")).toBe('danielojwang'));
});

describe('Built-in stakeholder photos (Andy, 2026-11-06)', () => {
  it('finds each person by name and other spellings', () => {
    expect(builtInFace('Diana Kiunga')).toBe('/people/dianakiunga.jpg');
    expect(builtInFace('Doreen Guya')).toBe('/people/doreenmayaka.jpg');
    expect(builtInFace('Doreen Mayaka')).toBe('/people/doreenmayaka.jpg');
    expect(builtInFace("Daniel Ojwang'")).toBe('/people/danielojwang.jpg');
    expect(builtInFace('Dorothy Mohart')).toBe('/people/dorothymohat.jpg');
    expect(builtInFace('Ronald Awili')).toBe('');
  });
});
