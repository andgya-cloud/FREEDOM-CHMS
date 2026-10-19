import type { Organization } from '../state/OrgContext';
import { formatDateKey } from '../../functions/src/shared/datetime';
import type { HopeReportDoc } from '../../functions/src/shared/hope';
import { header, newPdf, GREY, INK } from './givingPdf';
import { drawTable } from './schoolPdf';

/** The Hope Center report as a PDF, made on the device. The monthly one has counts only: no names, no codes. */
export async function hopeReportPdf(org: Organization, r: HopeReportDoc): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const m = r.metrics;
  const pc = (v: number | null) => (v == null ? '–' : `${v}%`);
  header(pdf, org, `${r.type === 'weekly' ? 'Weekly attendance and follow-up' : 'Monthly'} report: ${r.label}`);
  let y = 38;
  const section = (title: string) => {
    if (y > h - 40) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...INK);
    pdf.text(title, 14, y);
    y += 7;
  };
  const note = (text: string) => { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...GREY); pdf.text(text, 14, y); y += 6; };
  if (r.audience === 'counts') note('Numbers only. No child is named in this report.');
  else note('For the pastor. Contains children\'s names: do not share.');
  y += 2;
  section('The numbers');
  y = drawTable(pdf, y, [{ label: 'Measure', x: 14 }, { label: 'Value', x: w - 14, align: 'right' }], [
    ['Children registered', String(m.registered)], ['Children active', String(m.active)], ['Came in the last 8 weeks', String(m.attendingLast8Weeks)],
    ['Newly registered in the period', String(m.newlyRegistered)], ['Children attending regularly (3 in 4 sessions)', pc(m.consistencyRate)],
    ['Still here 6 months after joining', pc(m.retentionRate)], ['In one programme', String(m.reachOne)], ['In two or more programmes', String(m.reachTwoPlus)],
    ['Of those known, in school', pc(m.schoolEnrolmentRate)], ['Absence follow-ups that reached a guardian', pc(m.guardianContactRate)],
    ['Absence follow-ups still open', String(m.openAbsenceFollowUps)], ['Children with consent missing', String(m.consentMissing)],
  ], h - 30);
  y += 4;
  section('Saturday meals');
  y = drawTable(pdf, y, [{ label: 'Measure', x: 14 }, { label: 'Value', x: w - 14, align: 'right' }], [
    ['Meals served', String(m.meals.total)], ['Saturdays', String(m.meals.sessions)], ['Average per Saturday', String(m.meals.averagePerSession ?? '–')],
    ['New children', String(m.meals.newChildren)], ['Returning children', String(m.meals.returningChildren)],
  ], h - 30);
  y += 4;
  section('Programmes');
  y = drawTable(pdf, y, [{ label: 'Programme', x: 14 }, { label: 'Children', x: 110, align: 'right' }, { label: 'Sessions', x: 145, align: 'right' }, { label: 'Average present', x: w - 14, align: 'right' }],
    m.byProgramme.map((p) => [p.name, String(p.children), String(p.sessions), String(p.averageAttendance ?? '–')]), h - 30);
  if (r.audience === 'pastor') {
    y += 4;
    section('Guardians to call');
    if (r.followUps?.length) {
      drawTable(pdf, y, [{ label: 'Code', x: 14 }, { label: 'Child', x: 40 }, { label: 'Programme', x: 110 }, { label: 'Missed since', x: w - 14, align: 'right' }],
        r.followUps.map((f) => [f.code, f.name, f.programme, f.since ? formatDateKey(f.since) : '']), h - 30);
    } else note('No follow-ups are open.');
  }
  return new File([pdf.output('blob')], `Hope Center ${r.type} report ${r.label}.pdf`, { type: 'application/pdf' });
}
