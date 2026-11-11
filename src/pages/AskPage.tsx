import { useState } from 'react';
import { useOrg } from '../state/OrgContext';
import { useToast } from '../state/ToastContext';
import { aiWrite } from '../lib/aiWrite';
import { AI_MARK, AiBox } from '../components/Ai';
import { VoiceButton } from '../components/VoiceButton';

const EXAMPLES: Record<string, string[]> = {
  church_campus: ['How many first-time visitors came last month?', 'Is Sunday attendance going up or down?', 'How many salvations this year so far?'],
  college: ['What is the attendance rate this month?', 'How much in fees is still owed?', 'Which department has the most students?'],
  ministry: ['How many children came in the last 8 weeks?', 'Is attendance more regular than last month?', 'How many absence follow-ups are open?'],
};

/**
 * Ask the app (Andy, 2026-11-11, idea 9, 4A): a leader types or speaks a question and the helper answers from the
 * numbers of the latest weekly and monthly reports only. Never names, never private notes.
 */
export function AskPage() {
  const { current } = useOrg();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function ask(question = q) {
    if (!current || question.trim().length < 4) return;
    setBusy(true);
    try { setAnswer({ q: question, a: await aiWrite({ orgId: current.id, kind: 'ask', context: question }) }); }
    catch (err) { toast.show(err instanceof Error ? err.message : 'The helper could not answer.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="page narrow">
      <h1><span className="ai-label">{AI_MARK}</span> Ask the app</h1>
      <p className="lead">Ask a question about the numbers. The helper answers from the latest weekly and monthly reports.</p>
      <label className="field">
        <span className="label-row">Your question <VoiceButton value={q} onChange={setQ} /></span>
        <textarea rows={3} maxLength={500} value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example: how many visitors came back in October?" />
      </label>
      <button type="button" className="btn btn-ai-solid align-start" disabled={busy || q.trim().length < 4} onClick={() => void ask()}>{AI_MARK} {busy ? 'Thinking…' : 'Ask'}</button>
      <div className="chips">
        {(EXAMPLES[current?.type ?? ''] ?? EXAMPLES.church_campus!).map((x) => <button key={x} type="button" className="chip" disabled={busy} onClick={() => { setQ(x); void ask(x); }}>{x}</button>)}
      </div>
      {answer && <AiBox title={answer.q} note="Answered by AI from the report numbers. Check the report if it matters."><p>{answer.a}</p></AiBox>}
    </div>
  );
}
