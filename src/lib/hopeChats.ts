import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { uploadInParts } from './hopePhotos';
import type { ApprovalSlot, PhotoFile, Severity } from '../../functions/src/shared/hopePhotos';
import type { ChatMessage, ChatStatus, HopeChat } from '../../functions/src/shared/hopeChats';

export type StoredChat = HopeChat & { id: string };
export type StoredMessage = ChatMessage & { id: string };
type Action = 'summary' | 'list' | 'start' | 'raise' | 'messages' | 'upload' | 'uploadPart' | 'uploadDone' | 'send' | 'file' | 'status' | 'board' | 'email' | 'edit' | 'removeFile' | 'restoreFile' | 'severity' | 'approve';
const call = <R,>(data: Record<string, unknown> & { orgId: string; action: Action }) =>
  httpsCallable<typeof data, R>(functions, 'hopeChats', { timeout: 120_000 })(data).then((r) => r.data);

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const chatSummary = (orgId: string) => call<{ reader: boolean; urgent: number; unread: number }>({ orgId, action: 'summary' });
export interface ChatList { reader: boolean; closer: boolean; raiser: boolean; chats: StoredChat[] }
export const listChats = (orgId: string, childId?: string) => call<ChatList>({ orgId, action: 'list', ...(childId ? { childId } : {}) });
export const startChat = (orgId: string, childId: string, text: string, raise = false, severity?: Severity) => call<{ id: string; emailed: string[] }>({ orgId, action: raise ? 'raise' : 'start', childId, text, ...(severity ? { severity } : {}) });
export interface ChatOpen {
  chat: StoredChat; messages: StoredMessage[]; closer: boolean; me: string; keeps: boolean;
  childPhotos: Record<string, string>; faces: Record<string, string>; approves: Record<ApprovalSlot, boolean>;
}
export const openChat = (orgId: string, id: string) => call<ChatOpen>({ orgId, action: 'messages', id });
export const editChatMessage = (orgId: string, id: string, messageId: string, text: string) => call({ orgId, action: 'edit', id, messageId, text });
export const removeChatFile = (orgId: string, id: string, key: string) => call({ orgId, action: 'removeFile', id, key });
export const restoreChatFile = (orgId: string, id: string, key: string) => call({ orgId, action: 'restoreFile', id, key });
export const setChatSeverity = (orgId: string, id: string, severity: Severity) => call({ orgId, action: 'severity', id, severity });
export const approveChat = (orgId: string, id: string, slot: ApprovalSlot, proof: string, undo = false) => call({ orgId, action: 'approve', id, slot, proof, undo });
export const setChatStatus = (orgId: string, id: string, status: ChatStatus, note = '') => call({ orgId, action: 'status', id, status, note });
export interface BoardPerson { name: string; hasEmail: boolean; phone: string }
export const chatBoard = (orgId: string) => call<{ people: BoardPerson[] }>({ orgId, action: 'board' }).then((r) => r.people);

/** Sends a message: each photo is made smaller, videos and documents go in parts (2A), then the message with them. */
export async function sendChatMessage(orgId: string, id: string, text: string, files: File[], progress?: (done: number, of: number) => void, childIds: string[] = []) {
  const up: PhotoFile[] = [];
  for (let i = 0; i < files.length; i++) {
    progress?.(i, files.length);
    up.push(await uploadInParts('hopeChats', orgId, id, files[i]!));
  }
  return call<{ at: string }>({ orgId, action: 'send', id, text, files: up, childIds });
}

const cache = new Map<string, Promise<File>>();
export function chatFile(orgId: string, id: string, f: PhotoFile): Promise<File> {
  const k = `${orgId}/${id}/${f.key}`;
  let p = cache.get(k);
  if (!p) {
    p = call<{ contentType: string; file: string }>({ orgId, action: 'file', id, key: f.key })
      .then((r) => new File([Uint8Array.from(atob(r.file), (c) => c.charCodeAt(0))], f.name, { type: r.contentType || f.contentType }));
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return p;
}

export async function emailChat(orgId: string, id: string, names: string[], pdf: File) {
  return call<{ sentTo: string[] }>({ orgId, action: 'email', id, names, pdf: await toBase64(pdf) }).then((r) => r.sentTo);
}
