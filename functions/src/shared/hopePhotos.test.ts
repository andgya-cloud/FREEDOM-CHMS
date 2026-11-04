import { describe, expect, it } from 'vitest';
import {
  canDeletePhotoReport, canSeeAllPhotoReports, canSeePhotoReport, canSendPhotoReport, photoFileName, photoFileTypeOf, photoReportEmail, photoReportWhatsApp,
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
