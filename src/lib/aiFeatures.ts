import type { Permission } from '../../functions/src/shared/permissions';

/**
 * Every place the helper works (Andy, 2026-11-11, 1A-6A), so the AI Helper page, the menu signposts and the tips all
 * read one list. Each person sees only the ones their role already allows (6A).
 */
export type AiSection = 'giving' | 'petty' | 'more' | 'reports' | 'school' | 'exams' | 'followups';
export interface AiFeature {
  id: string;
  title: string;
  detail: string;
  to: string;
  orgTypes: string[];
  anyOf: Permission[];
  /** The menu button that leads there, for the gold signpost. */
  section: AiSection;
}

const ALL = ['church_campus', 'college', 'ministry'];
const REPORT_READERS: Permission[] = ['pastoral.read', 'finance.reports', 'settings.manage'];

export const AI_FEATURES: AiFeature[] = [
  { id: 'notice', title: 'Write a WhatsApp notice', detail: 'Type a few lines; the helper writes the group message.', to: '/notice', orgTypes: ['church_campus'], anyOf: ['pastoral.read', 'followups.manage', 'settings.manage'], section: 'more' },
  { id: 'followup', title: 'Write follow-up messages', detail: 'On any WhatsApp message, tap "Write it for me" to make it personal.', to: '/follow-ups', orgTypes: ['church_campus'], anyOf: ['pastoral.read'], section: 'followups' },
  { id: 'payer', title: 'Who sent this payment?', detail: 'For M-Pesa payments with no name, the helper suggests the member. You confirm.', to: '/giving/unassigned', orgTypes: ['church_campus'], anyOf: ['gifts.write'], section: 'giving' },
  { id: 'church-brief', title: 'Monday briefing', detail: 'Each weekly report starts with what went well, what dropped and what to do.', to: '/reports', orgTypes: ['church_campus'], anyOf: REPORT_READERS, section: 'more' },
  { id: 'sort', title: 'Sort bank lines', detail: 'In Financial statements, the helper suggests a category for unsorted lines.', to: '/finance', orgTypes: ALL, anyOf: ['finance.reports', 'pettycash.approve', 'pettycash.authorize', 'users.manage'], section: 'petty' },
  { id: 'school-brief', title: 'School report briefing', detail: 'Weekly school reports start with a plain-words briefing for the Principal.', to: '/school/reports', orgTypes: ['college'], anyOf: ['finance.reports', 'settings.manage'], section: 'school' },
  { id: 'remarks', title: 'Draft exam remarks', detail: 'In Exam Records, Reports: the helper drafts a remark for each student from the marks.', to: '/school/exams', orgTypes: ['college'], anyOf: ['exams.manage', 'users.manage'], section: 'exams' },
  { id: 'hope-brief', title: 'Weekly report briefing', detail: 'Each weekly report starts with a short briefing, from counts only.', to: '/hope/reports', orgTypes: ['ministry'], anyOf: REPORT_READERS, section: 'reports' },
];

export function aiFeaturesFor(orgType: string | undefined, can: (p: Permission) => boolean): AiFeature[] {
  if (!orgType) return [];
  return AI_FEATURES.filter((f) => f.orgTypes.includes(orgType) && f.anyOf.some((p) => can(p)));
}
export const aiSectionsFor = (features: AiFeature[]) => new Set(features.map((f) => f.section));

/** "Shown once" tips (5A): remembered on this device only. */
const TIP_KEY = 'aiTipsSeen';
export function tipSeen(id: string): boolean {
  try { return (JSON.parse(localStorage.getItem(TIP_KEY) ?? '[]') as string[]).includes(id); } catch { return true; }
}
export function markTipSeen(id: string) {
  try {
    const seen = new Set(JSON.parse(localStorage.getItem(TIP_KEY) ?? '[]') as string[]);
    seen.add(id);
    localStorage.setItem(TIP_KEY, JSON.stringify([...seen]));
  } catch { /* private window */ }
}
