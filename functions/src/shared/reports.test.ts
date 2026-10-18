import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { periodFor, type MetricsInput } from './metrics';
import { budgetFor, buildReport, changeText, reportCsv, reportFileName, reportPdf, reportsDue, trendOf } from './reports';

const WEEK = periodFor('weekly', '2026-10-12');

function input(): MetricsInput {
  const sunday = { id: '2026-10-18_sunday', date: '2026-10-18', type: 'service', headcounts: { adults: 90, teens: 10, children: 20 } };
  const lastSunday = { id: '2026-10-11_sunday', date: '2026-10-11', type: 'service', headcounts: { adults: 80, teens: 10, children: 10 } };
  return {
    regularWeeks: 3,
    now: Date.parse('2026-10-19T04:00:00Z'),
    events: [sunday, lastSunday],
    marks: [],
    people: [
      { id: 'grace', fullName: 'Grace Muthoni', status: 'visitor', firstVisitDate: '2026-10-18' },
      { id: 'john', fullName: 'John Otieno', status: 'member', firstVisitDate: null },
    ],
    stages: [
      { personId: 'grace', stageId: 'salvation', status: 'completed', date: '2026-10-18' },
      { personId: 'john', stageId: 'baptism', status: 'completed', date: '2026-10-11' },
    ],
    programs: [], cohorts: [], enrollments: [], groups: [], groupMembers: [], teamMembers: [],
    gifts: [{ personId: 'john', date: '2026-10-18', amountCents: 500_000, fundId: 'tithe' }],
    followUps: [
      { personId: 'grace', personName: 'Grace Muthoni', reason: 'salvation', status: 'open', dueAt: Date.parse('2026-10-19T20:59:00Z'), createdAt: null, doneAt: null, lastMessageAt: null },
      { personId: 'grace', personName: 'Grace Muthoni', reason: 'checkin_48h', status: 'open', dueAt: Date.parse('2026-10-18T20:59:00Z'), createdAt: null, doneAt: null, lastMessageAt: null },
    ],
  };
}

const ctx = { orgId: 'nairobi', orgName: 'Freedom Church Nairobi', currency: 'KES', fundNames: { tithe: 'Tithes' }, monthlyBudgetCents: 5_200_000 };

describe('building a report', () => {
  const parts = buildReport(input(), 'weekly', WEEK, ctx);

  it('keeps names of the saved and baptised, and all giving, out of the main report', () => {
    const main = JSON.stringify(parts.report);
    expect(parts.report.headlines.current.salvations).toBe(1);
    expect(parts.report.scorecard.salvations).toEqual({ count: 1 });
    expect(main).not.toContain('"giving"');
    expect(main).not.toContain('totalCents');
    expect(parts.report.followUpsDue.map((f) => f.reason)).toEqual(['checkin_48h']);
    expect(parts.pastoral.salvations).toEqual([{ personId: 'grace', name: 'Grace Muthoni', date: '2026-10-18' }]);
    expect(parts.pastoral.baptisms).toEqual([]); // John's baptism was the week before
    expect(parts.pastoral.followUpsDue.map((f) => f.reason)).toEqual(['salvation']);
  });

  it('compares with last week and lists the visitors', () => {
    expect(parts.report.label).toBe('Week of 12/10/2026 to 18/10/2026');
    expect(parts.report.headlines.current.attendance).toBe(120);
    expect(parts.report.headlines.previous.attendance).toBe(100);
    expect(parts.report.headlines.previous.baptisms).toBe(1);
    expect(parts.report.changes).toContain('Service attendance is up 20% on last week (120, was 100).');
    expect(parts.report.visitors).toEqual([{ personId: 'grace', name: 'Grace Muthoni', date: '2026-10-18' }]);
    expect(parts.report.trend).toHaveLength(12);
  });

  it('puts giving in the pastor\'s part, against a weekly share of the monthly budget', () => {
    expect(parts.giving.current.totalCents).toBe(500_000);
    expect(parts.giving.budgetCents).toBe(1_200_000);
    expect(budgetFor('monthly', 5_200_000)).toBe(5_200_000);
    expect(budgetFor('weekly', null)).toBeNull();
  });

  it('exports to CSV with giving and names only when given those parts', () => {
    const plain = reportCsv(parts.report);
    expect(plain).toContain('First-time visitors,1,0,0');
    expect(plain).toContain('Grace Muthoni,18/10/2026');
    expect(plain).not.toContain('Total giving');
    expect(plain).not.toContain('Salvations,Date');
    const full = reportCsv(parts.report, parts.pastoral, parts.giving);
    expect(full).toContain('Giving,Total giving,"KES 5,000",KES 0,KES 0');
    expect(full).toContain('Giving,Against budget,"42% of KES 12,000"');
    expect(full).toContain('Salvations,Date\r\nGrace Muthoni,18/10/2026');
  });

  it('stops spreadsheet formulas in names', () => {
    const p = input();
    p.people[0]!.fullName = '=HYPERLINK("x")';
    const csv = reportCsv(buildReport(p, 'weekly', WEEK, ctx).report);
    expect(csv).toContain(`"'=HYPERLINK(""x"")",18/10/2026`);
  });

  it('makes a PDF, with a file name for the period', () => {
    const pdf = reportPdf(jsPDF, parts.report, parts.pastoral, parts.giving);
    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(reportFileName(parts.report, 'pdf')).toBe('Freedom-Church-Nairobi-weekly-report-2026-10-12.pdf');
    expect(reportFileName({ ...parts.report, type: 'monthly', from: '2026-10-01' }, 'csv')).toBe('Freedom-Church-Nairobi-monthly-report-2026-10.csv');
  });
});

describe('when reports are due', () => {
  it('makes last week\'s report on a Monday and last month\'s on the 1st', () => {
    expect(reportsDue('2026-10-19')).toEqual([{ type: 'weekly', period: WEEK }]);
    expect(reportsDue('2026-10-20')).toEqual([]);
    expect(reportsDue('2026-10-01')).toEqual([{ type: 'monthly', period: { from: '2026-09-01', to: '2026-09-30' } }]);
    // 1 February 2027 is a Monday: both.
    expect(reportsDue('2027-02-01').map((d) => d.type)).toEqual(['weekly', 'monthly']);
  });
});

describe('trend arrows', () => {
  it('says which way a number moved, in words', () => {
    expect(trendOf(12, 10)).toBe('up');
    expect(trendOf(8, 10)).toBe('down');
    expect(trendOf(null, 10)).toBe('none');
    expect(changeText(12, 10, 'last week')).toBe('Up 20% on last week');
    expect(changeText(40, 45.5, 'last year', '%')).toBe('-5.5 points on last year');
    expect(changeText(3, 0, 'last week')).toBe('Up from none last week');
    expect(changeText(5, 5, 'last week')).toBe('Same as last week');
  });
});
