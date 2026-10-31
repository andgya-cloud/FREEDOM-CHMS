import { describe, expect, it } from 'vitest';
import {
  canEditCount, compareCounts, countdownText, defaultDeadline, endOfDay, inventoryCountId, itemsFromSheet, lateDays, lateNote, needsReminder, type InventoryItem,
} from './inventory.js';

const item = (name: string, over: Partial<InventoryItem> = {}): InventoryItem => ({ id: name, name, category: '', quantity: 1, unit: 'pcs', condition: 'good', location: '', tag: '', remarks: '', ...over });

describe('inventory', () => {
  it('names one count per department, cohort and phase', () => {
    expect(inventoryCountId('Cohort 4', 'ict', 'start')).toBe('Cohort-4_ict_start');
  });
  it('sets the usual deadlines, never in the past', () => {
    expect(defaultDeadline('start', '2026-10-01', '2026-10-05', null)).toBe('2026-10-19');
    expect(defaultDeadline('end', '2026-10-01', null, '2026-12-05')).toBe('2026-11-28');
    expect(defaultDeadline('start', '2026-10-29', '2026-09-01', null)).toBe('2026-11-12');
  });
  it('closes at the end of the deadline unless reopened', () => {
    const c = { status: 'open' as const, deadline: '2026-11-02', reopenUntil: null };
    expect(canEditCount(c, '2026-11-02')).toBe(true);
    expect(canEditCount(c, '2026-11-03')).toBe(false);
    expect(canEditCount({ ...c, reopenUntil: '2026-11-05' }, '2026-11-04')).toBe(true);
    expect(canEditCount({ ...c, status: 'submitted' }, '2026-11-01')).toBe(false);
    expect(endOfDay('2026-11-02').toISOString()).toBe('2026-11-02T20:59:59.000Z');
  });
  it('counts down the last five days and reminds once a day', () => {
    expect(countdownText('2026-11-05', '2026-11-02')).toBe('due in 3 days');
    expect(countdownText('2026-11-02', '2026-11-02')).toBe('due today');
    expect(countdownText('2026-11-02', '2026-11-04')).toBe('closed 2 days ago');
    const c = { status: 'open' as const, deadline: '2026-11-05', remindedOn: null };
    expect(needsReminder(c, '2026-10-30')).toBe(false);
    expect(needsReminder(c, '2026-10-31')).toBe(true);
    expect(needsReminder({ ...c, remindedOn: '2026-10-31' }, '2026-10-31')).toBe(false);
    expect(needsReminder(c, '2026-11-06')).toBe(false);
  });
  it('prints how late a form was and who reopened it', () => {
    expect(lateDays('2026-11-02', '2026-11-02')).toBe(0);
    expect(lateNote({ deadline: '2026-11-02', reopens: [{ reason: 'Was sick', byName: 'Felix', grantedByName: 'Doreen', until: '2026-11-06', at: '2026-11-04' }] }, '2026-11-05'))
      .toBe('Submitted late by 3 days (deadline 2 Nov 2026). Reopened by Doreen on 4 Nov 2026 until 6 Nov 2026. Reason given: Was sick.');
    expect(lateNote({ deadline: '2026-11-02' }, '2026-11-01')).toBe('');
  });
  it('compares the end of a cohort with its start', () => {
    const start = [item('Computer', { tag: 'ADIA-001' }), item('Chair', { quantity: 20 }), item('Projector'), item('Kettle')];
    const end = [item('Desktop computer', { tag: 'adia-001', condition: 'poor' }), item('Chair', { quantity: 18 }), item('Projector', { condition: 'missing' }), item('Printer')];
    const d = compareCounts(start, end);
    expect(d.worse.map((x) => [x.name, x.was, x.now])).toEqual([['Desktop computer', 'Good', 'Poor']]);
    expect(d.fewer.map((x) => [x.name, x.was, x.now])).toEqual([['Chair', '20 pcs', '18 pcs']]);
    expect(d.missing.map((x) => x.name)).toEqual(['Projector', 'Kettle']);
    expect(d.added.map((x) => x.name)).toEqual(['Printer']);
  });
  it('reads the paper form\'s columns from Excel', () => {
    let n = 0;
    const rows = [['INVENTORY REGISTER'], ['Description Item', 'Quantity', 'Condition (Good/Fair/Poor)', 'Location', 'Serial/Tag No.', 'Remarks'],
      ['Sewing machine', '5', 'Fair', 'Room 2', 'SM-01', ''], ['', '', '', '', '', ''], ['Iron box', 2, 'broken', '', '', 'Needs repair']];
    const r = itemsFromSheet(rows, () => `i${++n}`)!;
    expect(r.items.map((i) => [i.name, i.quantity, i.condition, i.location, i.tag, i.unit])).toEqual([
      ['Sewing machine', 5, 'fair', 'Room 2', 'SM-01', 'pcs'], ['Iron box', 2, 'broken', '', '', 'pcs']]);
    expect(itemsFromSheet([['a', 'b']], () => 'x')).toBeNull();
  });
});
