import { describe, expect, it } from 'vitest';
import {
  AUTO_TEMPLATES, buildParams, cleanParam, digitsOf, failureHint, isSendingHour, isStopMessage, metaNameFor, modeFor, nextStatus, previewText,
  readyToSend, sendingReady, sendPayload, withWhatsAppDefaults,
} from './whatsapp.js';
import { DEFAULT_TEMPLATES } from './followups.js';

const TZ = 'Africa/Nairobi';

describe('automatic message types', () => {
  it('never include salvation, baptism or fee reminders', () => {
    const ids = AUTO_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(['visitor_welcome', 'checkin_48h', 'care_absent', 'child_absent']);
    for (const bad of ['salvation_followup', 'baptism_invite', 'fee_reminder']) expect(ids).not.toContain(bad);
  });
  it('have a slot in the body for every field, in order, and a valid Meta name', () => {
    for (const t of AUTO_TEMPLATES) {
      const slots = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(slots).toEqual(t.fields.map((_, i) => i + 1));
      expect(t.example).toHaveLength(t.fields.length);
      expect(t.metaName).toMatch(/^[a-z0-9_]{1,60}$/);
    }
  });
  it('exist as app templates too, so staff can still send them by hand', () => {
    const app = new Set(DEFAULT_TEMPLATES.map((t) => t.id));
    for (const t of AUTO_TEMPLATES) expect(app.has(t.id)).toBe(true);
  });
});

describe('settings', () => {
  it('are off until switched on and set up', () => {
    const s = withWhatsAppDefaults(null);
    expect(s.enabled).toBe(false);
    expect(sendingReady(s)).toBe(false);
    expect(sendingReady(withWhatsAppDefaults({ enabled: true, phoneNumberId: '1234567890' }))).toBe(true);
    expect(sendingReady(withWhatsAppDefaults({ enabled: true, phoneNumberId: '' }))).toBe(false);
  });
  it('treat unknown or missing modes as off', () => {
    const s = withWhatsAppDefaults({ modes: { care_absent: 'auto', checkin_48h: 'approve', fee_reminder: 'auto', visitor_welcome: 'banana' as never } });
    expect(modeFor(s, 'care_absent')).toBe('auto');
    expect(modeFor(s, 'checkin_48h')).toBe('approve');
    expect(modeFor(s, 'fee_reminder')).toBe('off');
    expect(modeFor(s, 'visitor_welcome')).toBe('off');
    expect(modeFor(s, 'child_absent')).toBe('off');
  });
  it('use the suggested Meta name unless one is saved', () => {
    expect(metaNameFor(withWhatsAppDefaults({}), 'care_absent')).toBe('care_message');
    expect(metaNameFor(withWhatsAppDefaults({ metaNames: { care_absent: ' care_v2 ' } }), 'care_absent')).toBe('care_v2');
  });
});

describe('timing', () => {
  it('only sends between 08:00 and 20:00 Nairobi time', () => {
    expect(isSendingHour(new Date('2026-10-19T04:59:00Z'), TZ)).toBe(false); // 07:59
    expect(isSendingHour(new Date('2026-10-19T05:00:00Z'), TZ)).toBe(true); // 08:00
    expect(isSendingHour(new Date('2026-10-19T16:59:00Z'), TZ)).toBe(true); // 19:59
    expect(isSendingHour(new Date('2026-10-19T17:00:00Z'), TZ)).toBe(false); // 20:00
  });
  it('holds the 48-hour check-in until its due day', () => {
    const due = new Date('2026-10-21T20:59:00Z'); // end of 21 Oct in Nairobi
    expect(readyToSend('checkin_48h', due, new Date('2026-10-20T20:00:00Z'))).toBe(false);
    expect(readyToSend('checkin_48h', due, new Date('2026-10-21T06:59:00Z'))).toBe(true);
    expect(readyToSend('care_absent', due, new Date('2026-10-01T00:00:00Z'))).toBe(true);
  });
});

describe('what is sent', () => {
  it('fills the slots in order and tidies them', () => {
    const p = buildParams('child_absent', { first_name: 'Mary', staff_name: '', campus: 'Freedom Hope Center', child_name: 'Baraka\nOtieno' });
    expect(p).toEqual(['Mary', 'the team', 'Freedom Hope Center', 'Baraka Otieno']);
    expect(previewText('child_absent', p)).toContain('We have missed Baraka Otieno at our sessions');
  });
  it('never sends an empty slot', () => {
    expect(cleanParam('   ', 'x')).toBe('-');
    expect(cleanParam(null, 'service_time')).toBe('Sunday');
    expect(buildParams('nope', {})).toEqual([]);
  });
  it('builds the Cloud API payload with digits only', () => {
    const body = sendPayload('+254712345678', 'care_message', 'en', ['Grace', 'Pastor Andy', 'Freedom']);
    expect(body.to).toBe('254712345678');
    expect(body.type).toBe('template');
    expect(body.template.components[0]!.parameters).toEqual([{ type: 'text', text: 'Grace' }, { type: 'text', text: 'Pastor Andy' }, { type: 'text', text: 'Freedom' }]);
    expect(JSON.stringify(body)).not.toMatch(/token|secret/i);
  });
});

describe('delivery updates', () => {
  it('only move forward, and a failure never hides a delivery', () => {
    expect(nextStatus('queued', 'sent')).toBe('sent');
    expect(nextStatus('sent', 'delivered')).toBe('delivered');
    expect(nextStatus('read', 'delivered')).toBe('read');
    expect(nextStatus('delivered', 'sent')).toBe('delivered');
    expect(nextStatus('sent', 'failed')).toBe('failed');
    expect(nextStatus('delivered', 'failed')).toBe('delivered');
    expect(nextStatus('failed', 'delivered')).toBe('delivered');
  });
  it('explain common failures in plain words', () => {
    expect(failureHint(131026)).toMatch(/not on WhatsApp/);
    expect(failureHint(132001)).toMatch(/approved/);
    expect(failureHint(undefined)).toMatch(/could not deliver/);
  });
});

describe('stop replies', () => {
  it('recognise a stop however it is written', () => {
    for (const t of ['STOP', ' stop ', 'Stop.', 'unsubscribe', 'Acha', 'opt out']) expect(isStopMessage(t)).toBe(true);
  });
  it('ignore ordinary replies', () => {
    for (const t of ['Please do not stop praying for us', 'thanks', 'Stop by on Sunday', '', null]) expect(isStopMessage(t)).toBe(false);
  });
  it('keys a number by its digits', () => expect(digitsOf('+254 712-345678')).toBe('254712345678'));
});
