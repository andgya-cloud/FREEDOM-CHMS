import { describe, expect, it } from 'vitest';
import { attachmentCounts, attachmentDone, attachmentFileName, attachmentLine, markProblem, statusHint } from './attachment';
import { ADIA_BANDS } from './exams';

describe('industrial attachment', () => {
  it('hints the next status from the dates', () => {
    expect(statusHint({ status: 'placed', from: '2026-11-03', to: '2026-12-12' }, '2026-11-19')).toBe('ongoing');
    expect(statusHint({ status: 'placed', from: '2026-11-25', to: null }, '2026-11-19')).toBeNull();
    expect(statusHint({ status: 'placed', from: '2026-09-01', to: '2026-10-31' }, '2026-11-19')).toBe('completed');
    expect(statusHint({ status: 'ongoing', from: '2026-09-15', to: '2026-11-14' }, '2026-11-19')).toBe('completed');
    expect(statusHint({ status: 'ongoing', from: '2026-09-15', to: '2026-11-19' }, '2026-11-19')).toBeNull();
    expect(statusHint({ status: 'not_placed', from: null, to: null }, '2026-11-19')).toBeNull();
    expect(statusHint(undefined, '2026-11-19')).toBeNull();
  });

  it('counts every student, with no record as Not placed', () => {
    expect(attachmentCounts(['a', 'b', 'c', 'd'], {
      a: { status: 'ongoing', logBook: true, assessed: false }, b: { status: 'completed', logBook: true, assessed: true }, c: { status: 'placed', logBook: false, assessed: false },
    })).toEqual({ placed: 1, notPlaced: 1, ongoing: 1, completed: 1, logBooks: 2, assessed: 1 });
  });

  it('checks the mark and prints it with the grade', () => {
    expect(markProblem('')).toBeNull();
    expect(markProblem('78')).toBeNull();
    expect(markProblem('64.5')).toBeNull();
    expect(markProblem('101')).not.toBeNull();
    expect(markProblem('abc')).not.toBeNull();
    expect(attachmentLine({ assessed: true, mark: 78 }, { bands: ADIA_BANDS })).toBe('78 · Credit');
    expect(attachmentLine({ assessed: true, mark: 82 }, { bands: ADIA_BANDS })).toBe('82 · Distinction');
    expect(attachmentLine({ assessed: false, mark: 78 }, { bands: ADIA_BANDS })).toBe('');
    expect(attachmentLine({ assessed: true, mark: null }, { bands: ADIA_BANDS })).toBe('');
  });

  it('is done only when completed and assessed', () => {
    expect(attachmentDone({ status: 'completed', assessed: true })).toBe(true);
    expect(attachmentDone({ status: 'completed', assessed: false })).toBe(false);
    expect(attachmentDone({ status: 'ongoing', assessed: true })).toBe(false);
    expect(attachmentDone(undefined)).toBe(false);
  });

  it('names the files', () => {
    expect(attachmentFileName('Brian Otieno', 'ADIA/ICT/014/2026', 'logbook')).toBe('Log book - Brian Otieno - ADIA-ICT-014-2026.pdf');
    expect(attachmentFileName('Brian Otieno', null, 'form')).toBe('Assessment form - Brian Otieno.pdf');
  });
});
