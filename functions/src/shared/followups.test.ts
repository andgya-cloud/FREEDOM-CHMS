import { describe, expect, it } from 'vitest';
import {
  absenceToFollowUp,
  DEFAULT_TEMPLATES,
  endOfLocalDay,
  isEscalated,
  isOverdue,
  recipientFor,
  renderTemplate,
  unknownFields,
  whatsappLink,
  withDefaults,
  type Contact,
} from './followups';

const TZ = 'Africa/Nairobi';

describe('due dates and escalation', () => {
  it('makes tasks due at the end of the local day', () => {
    // 18 Oct 2026, 22:30 in Nairobi is 19:30 UTC
    const now = new Date('2026-10-18T19:30:00Z');
    expect(endOfLocalDay(now, TZ).toISOString()).toBe('2026-10-18T20:59:00.000Z');
    expect(endOfLocalDay(now, TZ, 2).toISOString()).toBe('2026-10-20T20:59:00.000Z');
    // 01:00 on the 19th in Nairobi is still the 18th in UTC
    expect(endOfLocalDay(new Date('2026-10-18T22:00:00Z'), TZ).toISOString()).toBe('2026-10-19T20:59:00.000Z');
  });

  it('escalates to the pastor 3 days after the due date', () => {
    const due = new Date('2026-10-10T20:59:00Z');
    expect(isOverdue(due, new Date('2026-10-10T20:00:00Z'))).toBe(false);
    expect(isOverdue(due, new Date('2026-10-11T08:00:00Z'))).toBe(true);
    expect(isEscalated(due, new Date('2026-10-13T20:00:00Z'))).toBe(false);
    expect(isEscalated(due, new Date('2026-10-13T21:00:00Z'))).toBe(true);
    expect(isEscalated(null)).toBe(false);
  });
});

describe('care after 3 weeks absent', () => {
  const sundays = (dates: string[]) => dates.map((date) => ({ date, status: 'present' }));
  const regular = sundays(['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20']);

  it('flags a regular attender 21 days after their last visit, once per absence', () => {
    expect(absenceToFollowUp(regular, new Date('2026-10-10T09:00:00Z'), TZ)).toBeNull(); // 20 days
    expect(absenceToFollowUp(regular, new Date('2026-10-11T09:00:00Z'), TZ)).toBe('2026-09-20');
    expect(absenceToFollowUp(regular, new Date('2026-10-30T09:00:00Z'), TZ)).toBe('2026-09-20');
  });

  it('leaves out occasional visitors and people long gone', () => {
    expect(absenceToFollowUp(sundays(['2026-09-13', '2026-09-20']), new Date('2026-10-12T09:00:00Z'), TZ)).toBeNull();
    expect(absenceToFollowUp(regular, new Date('2026-11-16T09:00:00Z'), TZ)).toBeNull();
    expect(absenceToFollowUp([], new Date(), TZ)).toBeNull();
  });

  it('counts only attended marks', () => {
    const marks = [...regular, { date: '2026-10-04', status: 'absent' }];
    expect(absenceToFollowUp(marks, new Date('2026-10-11T09:00:00Z'), TZ)).toBe('2026-09-20');
  });
});

describe('templates', () => {
  it('fills in merge fields and tidies missing ones', () => {
    expect(renderTemplate('Hi {first_name}, see you {service_time}!', { first_name: 'Grace', service_time: 'Sunday 10:00' }))
      .toBe('Hi Grace, see you Sunday 10:00!');
    expect(renderTemplate('Hi {first_name} {staff_name}, welcome.', { first_name: 'Grace', staff_name: '' })).toBe('Hi Grace, welcome.');
    expect(renderTemplate('Keep {unknown}', {})).toBe('Keep {unknown}');
  });

  it('spots typos in merge fields', () => {
    expect(unknownFields('Hi {first_name} and {frist_name}')).toEqual(['frist_name']);
  });

  it('has all eight starting templates, and keeps edited ones', () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.id)).toEqual([
      'visitor_welcome', 'checkin_48h', 'care_absent', 'salvation_followup', 'baptism_invite', 'program_reminder', 'giving_receipt', 'fee_reminder',
    ]);
    const merged = withDefaults([{ id: 'visitor_welcome', name: 'Welcome', body: 'Karibu {first_name}!' }]);
    expect(merged).toHaveLength(8);
    expect(merged[0]!.body).toBe('Karibu {first_name}!');
  });

  it('opens WhatsApp with the number and message', () => {
    expect(whatsappLink('+254712345678', 'Hi Grace & co')).toBe('https://wa.me/254712345678?text=Hi%20Grace%20%26%20co');
  });
});

describe('who a message goes to', () => {
  const agreed = { given: true, stoppedAt: null };
  const adult: Contact = { id: 'a', fullName: 'Grace Wanjiku', phone: '+254712345678', whatsapp: '+254712345679', whatsappConsent: agreed };
  const child: Contact = { id: 'c', fullName: 'Baraka Otieno', status: 'child', phone: null, whatsappConsent: agreed, guardianId: 'g' };
  const guardian: Contact = { id: 'g', fullName: 'Mary Otieno', phone: '+254722000111', whatsappConsent: agreed };

  it('uses the WhatsApp number, then the phone', () => {
    expect(recipientFor(adult, null)).toMatchObject({ ok: true, phone: '+254712345679', viaGuardian: false });
    expect(recipientFor({ ...adult, whatsapp: null }, null)).toMatchObject({ ok: true, phone: '+254712345678' });
  });

  it('honours consent and a request to stop', () => {
    expect(recipientFor({ ...adult, whatsappConsent: { given: false } }, null)).toMatchObject({ ok: false });
    const stopped = recipientFor({ ...adult, whatsappConsent: { given: false, stoppedAt: '2026-10-01' } }, null);
    expect(stopped.ok === false && stopped.reason).toMatch(/asked us to stop/);
  });

  it('never messages a child: it goes to the guardian', () => {
    expect(recipientFor(child, guardian)).toMatchObject({ ok: true, phone: '+254722000111', viaGuardian: true });
    expect(recipientFor(child, null)).toMatchObject({ ok: false });
    expect(recipientFor(child, { ...guardian, whatsappConsent: { given: false } })).toMatchObject({ ok: false });
  });
});
