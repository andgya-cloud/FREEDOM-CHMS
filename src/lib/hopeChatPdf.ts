import type { Organization } from '../state/OrgContext';
import { CHAT_STATUS_LABELS } from '../../functions/src/shared/hopeChats';
import type { PhotoReport, StoryMessage } from '../../functions/src/shared/hopePhotos';
import { hopeStoryPdf } from './hopeStoryPdf';
import type { StoredPhotoReport, StoredStoryMessage } from './hopePhotos';
import { chatFile, type ChatOpen } from './hopeChats';

/**
 * The conversation about a child as an official record (v197, 9A), the same as Photos and wins: a red cover with the
 * reference, status and urgency, the timeline with each speaker's face, the children's cards, the photo gallery, the
 * approvals, a record of changes, and CONFIDENTIAL on every page.
 */
export async function hopeChatPdf(org: Organization, data: ChatOpen, preparedBy = ''): Promise<File> {
  const c = data.chat;
  const [first, ...rest] = data.messages;
  const child = { id: c.childId, name: c.childName, code: c.childCode, className: '' };
  const report = {
    id: c.id, orgId: c.orgId, kind: 'incident', title: `${c.childName}${c.childCode ? ` (${c.childCode})` : ''}`,
    day: (first?.at ?? c.lastAt).slice(0, 10), text: first?.text ?? '', senderUid: c.startedByUid, senderName: c.startedByName, senderRole: first?.byRole ?? '',
    files: first?.files ?? [], children: [child, ...(first?.children ?? [])], startedAt: first?.at ?? c.lastAt, lastAt: c.lastAt,
    ...(first?.editedAt ? { editedAt: first.editedAt, textHistory: first.history ?? [] } : {}),
    ref: c.ref, approvals: c.approvals, removed: c.removed,
    incident: { time: '', place: '', hurt: '', action: '', parentsTold: null, followUp: '', severity: c.severity ?? null },
  } as unknown as StoredPhotoReport & PhotoReport;
  const outcome = c.status === 'closed' || c.status === 'sent'
    ? `${c.closeNote ? `Outcome: ${c.closeNote}${c.closedByName ? ` (${c.closedByName})` : ''}` : 'Resolved.'}`
    : `Still ${CHAT_STATUS_LABELS[c.status].toLowerCase()}. It was started by ${c.startedByName}: ${first?.text ?? ''}`;
  return hopeStoryPdf(org, report, rest as unknown as StoredStoryMessage[] & StoryMessage[], {
    summary: outcome, preparedBy: preparedBy || data.messages.find((m) => m.byUid === data.me)?.byName || c.lastByName, preparedRole: '', link: `${location.origin}/hope/chats/${c.id}`,
    faces: data.faces, childPhotos: data.childPhotos, fetchFile: (f) => chatFile(org.id, c.id, f),
    kindLabel: 'Conversation about a child', statusLabel: CHAT_STATUS_LABELS[c.status], followUp: false,
    fileName: `Conversation - ${c.childName.replace(/[\\/:*?"<>|]+/g, '-')}${c.ref ? ` - ${c.ref}` : ''}.pdf`,
  });
}
