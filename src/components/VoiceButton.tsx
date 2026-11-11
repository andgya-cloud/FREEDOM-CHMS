import { useEffect, useRef, useState } from 'react';

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start: () => void; stop: () => void;
};
const Speech = (typeof window !== 'undefined'
  ? (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition
  : undefined);

/**
 * Speak instead of typing (Andy, 2026-11-11, 3A). The phone's own speech-to-text writes the words; nothing goes to
 * the AI and nothing is counted. Hidden on phones and browsers that cannot do it.
 */
export function VoiceButton({ value, onChange, label = 'Speak' }: { value: string; onChange: (text: string) => void; label?: string }) {
  const [on, setOn] = useState(false);
  const [problem, setProblem] = useState('');
  const rec = useRef<Recognition | null>(null);
  useEffect(() => () => rec.current?.stop(), []);
  if (!Speech) return null;
  function start() {
    setProblem('');
    const base = value.trim();
    const r = new Speech!();
    r.lang = 'en-KE';
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) if (e.results[i]!.isFinal) parts.push(e.results[i]![0]!.transcript);
      const text = parts.join(' ').trim();
      if (text) onChange(base ? `${base} ${text}` : text);
    };
    r.onerror = (e) => setProblem(e.error === 'not-allowed' ? 'Please allow the microphone for this site.' : 'The phone could not hear that. Please try again.');
    r.onend = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  }
  return (
    <span className="voice">
      <button type="button" className={`btn btn-small${on ? ' btn-ai-solid' : ' btn-quiet'}`} aria-pressed={on} onClick={() => (on ? rec.current?.stop() : start())}>
        {on ? '■ Stop' : `🎤 ${label}`}
      </button>
      {problem && <span className="small error">{problem}</span>}
    </span>
  );
}
