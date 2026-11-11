import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOrg } from '../state/OrgContext';
import { useAuth } from '../state/AuthContext';
import { canKeepAccounts } from '../../functions/src/shared/permissions';
import { helpFor } from '../lib/pageHelp';
import { roleRedirect } from '../lib/roleAccess';
import { canOpen, confident, findTopics, GUIDE, isWhereAmI, NO_ACCESS, orgKind, topicPath, topicSteps, type Access, type GuideTopic, type OrgKind } from '../lib/guide';
import { aiGuide } from '../lib/aiWrite';
import { AI_MARK } from './Ai';
import { VoiceButton } from './VoiceButton';

interface Answer { id: number; q: string; text: string; topic?: GuideTopic; open?: boolean; steps?: string[]; byAi?: boolean; others?: GuideTopic[] }

const POPULAR: Record<OrgKind, string[]> = {
  church_campus: ['visitor', 'service', 'giving-record', 'petty-new', 'reach', 'signout'],
  college: ['register', 'exams', 'students', 'petty-new', 'fees', 'signout'],
  ministry: ['hope-register', 'child-new', 'children', 'petty-new', 'gate', 'signout'],
};

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
function say(text: string) {
  if (!canSpeak) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-GB';
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

/**
 * "Just ask Andy" (Andy, 2026-11-11, 1A-8A): a gold button on every page for everyone who signs in. It says where you
 * are, answers "how do I…?" from the app's own map (free, works offline), and asks the AI only for questions the map
 * cannot place. "Take me there" opens the page; an area the person's role does not include gets a kind "ask Mr Andrew".
 * Typing and speaking cost the same (the phone turns speech into words), so both are here, and answers can be read aloud.
 */
export function JustAskAndy() {
  const { current } = useOrg();
  const { can, profile } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [spoken, setSpoken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const kind = orgKind(current?.type);
  const here = helpFor(pathname, kind === 'college');
  const access: Access = useMemo(() => ({
    can, keeper: canKeepAccounts(profile), roleBlocks: (p: string) => roleRedirect(profile, p) != null,
  }), [can, profile]);
  const first = (profile?.displayName ?? '').split(' ')[0] ?? '';

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [answers, busy]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel(); }, []);

  if (!current || !profile) return null;
  const org = current;

  const popular = POPULAR[kind].map((id) => GUIDE.find((t) => t.id === id)!).filter((t) => t && canOpen(t, kind, access)).slice(0, 4);
  const add = (a: Omit<Answer, 'id'>, voice: boolean) => {
    setAnswers((list) => [...list.slice(-5), { ...a, id: (list[list.length - 1]?.id ?? 0) + 1 }]);
    if (voice) say([a.text, ...(a.open ? a.steps ?? [] : [])].join(' '));
  };

  function fromTopic(question: string, t: GuideTopic, byAi = false, text?: string): Omit<Answer, 'id'> {
    const ok = canOpen(t, kind, access);
    return ok
      ? { q: question, topic: t, open: true, steps: topicSteps(t, kind), text: text ?? `${t.title}: ${t.where}`, byAi }
      : { q: question, topic: t, open: false, text: text ?? NO_ACCESS(t.title), byAi };
  }

  async function ask(question: string, voice = spoken) {
    const text = question.trim();
    if (!text || busy) return;
    setQ('');
    setSpoken(false);
    if (isWhereAmI(text)) {
      add({ q: text, open: true, steps: here.steps, text: `You are on ${here.title}, in ${org.name}. Here is what you can do on this page.` }, voice);
      return;
    }
    const matches = findTopics(text, kind);
    if (confident(matches)) { add(fromTopic(text, matches[0]!.topic), voice); return; }
    const others = matches.slice(0, 3).map((m) => m.topic);
    if (!navigator.onLine) {
      add({ q: text, others, text: others.length ? 'I am offline, so here is my best guess. Is it one of these?' : 'I am offline and could not place that question. Try other words, or one of the buttons below.' }, voice);
      return;
    }
    setBusy(true);
    try {
      const list = GUIDE.filter((t) => t.orgs.includes(kind)).map((t) => ({
        k: t.id,
        line: `${t.title} | ${t.where} | ${topicSteps(t, kind).join(' ')} | ${canOpen(t, kind, access) ? 'open' : 'no access'}`,
      }));
      const r = await aiGuide(org.id, text, org.name, here.title, list);
      const t = GUIDE.find((x) => x.id === r.topic);
      add(t ? fromTopic(text, t, true, r.answer) : { q: text, text: r.answer, byAi: true, others }, voice);
    } catch (err) {
      add({ q: text, others, text: err instanceof Error ? err.message : 'I could not answer just now.' }, voice);
    } finally {
      setBusy(false);
    }
  }

  function go(t: GuideTopic) {
    setOpen(false);
    navigate(topicPath(t, kind));
  }

  return (
    <>
      {!open && <button type="button" className="jaa-fab no-print" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span aria-hidden="true">{AI_MARK}</span> <span className="jaa-fab-long">Just ask Andy</span><span className="jaa-fab-short">Ask Andy</span>
      </button>}
      {open && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="sheet jaa-sheet" role="dialog" aria-modal="true" aria-labelledby="jaa-h" onClick={(e) => e.stopPropagation()}>
            <div className="jaa-head">
              <h2 id="jaa-h"><span className="ai-label">{AI_MARK}</span> Just ask Andy</h2>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <p className="small muted">Hi{first ? ` ${first}` : ''}, I’m the guide Andy built into this app. Ask me how to do anything, or where something is.</p>

            <div className="jaa-here" aria-label="Where you are">
              <span className="small muted">You are here</span>
              <b>{org.name} › {here.title}</b>
            </div>

            <div className="jaa-thread" aria-live="polite">
              {answers.map((a) => (
                <div key={a.id} className="jaa-turn">
                  <p className="jaa-q">{a.q}</p>
                  <div className={`jaa-a${a.byAi ? ' ai-box' : ''}${a.open === false ? ' jaa-locked' : ''}`}>
                    {a.open === false && <span className="jaa-lock" aria-hidden="true">🔒 </span>}
                    <p>{a.text}</p>
                    {a.open && a.steps && <ol className="jaa-steps">{a.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
                    <div className="row-actions">
                      {a.open && a.topic && topicPath(a.topic, kind).split('?')[0] !== pathname && (
                        <button type="button" className="btn btn-ai-solid btn-small" onClick={() => go(a.topic!)}>Take me there →</button>
                      )}
                      {canSpeak && <button type="button" className="btn btn-quiet btn-small" onClick={() => say([a.text, ...(a.open ? a.steps ?? [] : [])].join(' '))}>🔊 Read aloud</button>}
                    </div>
                    {a.others && a.others.length > 0 && (
                      <div className="jaa-chips">{a.others.map((t) => <button key={t.id} type="button" className="btn btn-ai btn-small" onClick={() => add(fromTopic(t.title, t), false)}>{t.title}</button>)}</div>
                    )}
                    {a.byAi && <small className="ai-note">{AI_MARK} Answered by AI from the app’s own guide.</small>}
                  </div>
                </div>
              ))}
              {busy && <p className="small muted">{AI_MARK} Thinking…</p>}
              <div ref={end} />
            </div>

            {answers.length === 0 && (
              <div className="jaa-chips">
                <button type="button" className="btn btn-ai btn-small" onClick={() => void ask('Where am I?', false)}>Where am I?</button>
                {popular.map((t) => <button key={t.id} type="button" className="btn btn-ai btn-small" onClick={() => add(fromTopic(t.title, t), false)}>{t.title}</button>)}
              </div>
            )}

            <form className="jaa-ask" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
              <label className="field">
                <span className="sr-only">Your question</span>
                <input value={q} onChange={(e) => { setQ(e.target.value); setSpoken(false); }} placeholder="For example: how do I add a visitor?" maxLength={300} enterKeyHint="send" />
              </label>
              <div className="row-actions">
                <VoiceButton value={q} onChange={(t) => { setQ(t); setSpoken(true); }} label="Speak" />
                <button type="submit" className="btn btn-ai-solid" disabled={busy || !q.trim()}>Ask</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
