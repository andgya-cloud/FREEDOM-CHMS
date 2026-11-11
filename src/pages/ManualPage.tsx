import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { canKeepAccounts } from '../../functions/src/shared/permissions';
import {
  MANUAL_CONTACTS, MANUAL_HOW, MANUAL_PARTS, MANUAL_PRIVACY, MANUAL_PROBLEMS, MANUAL_ROLES, MANUAL_TOPICS, MANUAL_VERSION, MANUAL_WELCOME, MANUAL_WORDS,
  type ManualPartKey, type ManualTopic,
} from '../lib/manualData';
import { manualPartFor } from '../lib/manual';
import './manual.css';

/** **bold** in the manual's words becomes bold on screen, as in the printed book. */
function Md({ children }: { children: string }) {
  return <>{children.split(/\*\*(.+?)\*\*/g).map((s, i) => (i % 2 ? <b key={i}>{s}</b> : <Fragment key={i}>{s}</Fragment>))}</>;
}

function useManualScope() {
  const { profile } = useAuth();
  const { current, organizations } = useOrg();
  const keeper = canKeepAccounts(profile);
  const here = manualPartFor(current?.type);
  // People who work in more than one place can read the other places' parts too.
  const places = new Set<ManualPartKey>([here]);
  for (const o of organizations) places.add(manualPartFor(o.type));
  const order: ManualPartKey[] = ['start', here, ...(['church', 'adia', 'hope'] as const).filter((k) => k !== here && places.has(k)), 'shared', ...(keeper ? (['admin'] as const) : [])];
  return { order, here, keeper, roleId: profile?.roleId };
}

const HELP: [string, string, string][] = [
  ['roles', 'Find your role', 'The pages for your job'],
  ['problems', 'Common problems and fixes', 'Passwords, saving, the camera and more'],
  ['words', 'Word list', 'What the app’s words mean'],
  ['privacy', 'Privacy and care', 'Keeping people’s details safe'],
  ['contacts', 'Who to contact', 'Who can help with what'],
  ['welcome', 'Welcome and how to use this manual', 'A word from Pastor Andrew, and the signs used'],
];

/**
 * The user manual inside the app (Andy, 2026-11-11): the same pages and pictures as the printed manual, with the
 * parts for the places a person works in, a search box and Find your role.
 */
export function ManualPage() {
  const { id } = useParams();
  const scope = useManualScope();
  if (!id) return <ManualHome scope={scope} />;
  if (HELP.some((h) => h[0] === id)) return <ManualHelp id={id} scope={scope} />;
  const t = MANUAL_TOPICS.find((x) => x.id === id);
  if (!t || (t.part === 'admin' && !scope.keeper)) return <Navigate to="/manual" replace />;
  return <ManualTopicPage t={t} scope={scope} />;
}

type Scope = ReturnType<typeof useManualScope>;

function ManualHome({ scope }: { scope: Scope }) {
  const [q, setQ] = useState('');
  const visible = MANUAL_TOPICS.filter((t) => scope.order.includes(t.part));
  const found = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return null;
    return visible.filter((t) => {
      const hay = [t.title, t.purpose, t.where, ...t.steps, t.tip ?? '', t.see ?? ''].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [q, visible]);
  const mine = MANUAL_ROLES.find((r) => r.roleId === scope.roleId);

  return (
    <div className="page manual">
      <header className="man-head">
        <h1>User manual</h1>
        <p className="muted">How to do each job in Freedom ChMS, step by step, with a picture of the screen.</p>
        <input type="search" className="man-search" placeholder="Search the manual, for example: receipt" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the manual" />
      </header>

      {found ? (
        <section>
          <h2 className="man-h2">{found.length === 0 ? 'Nothing found. Try another word, or press Just ask Andy.' : `${found.length} found`}</h2>
          <TopicList topics={found} showPart />
        </section>
      ) : (
        <>
          {mine && (
            <section className="card man-mine">
              <span className="small muted">Your role</span>
              <b>{mine.role}: {mine.does}</b>
              {mine.jobs.filter((j) => MANUAL_TOPICS.some((t) => t.id === j && scope.order.includes(t.part))).length > 0 && (
                <ul className="man-chips">
                  {mine.jobs.map((j) => MANUAL_TOPICS.find((t) => t.id === j)).filter((t): t is ManualTopic => !!t && scope.order.includes(t.part)).map((t) => (
                    <li key={t.id}><Link to={`/manual/${t.id}`}>{t.title}</Link></li>
                  ))}
                </ul>
              )}
              {mine.remember.length > 0 && <ul className="small man-remember">{mine.remember.map((r) => <li key={r}>{r}</li>)}</ul>}
            </section>
          )}
          {scope.order.map((k) => {
            const P = MANUAL_PARTS[k];
            const list = visible.filter((t) => t.part === k);
            return (
              <details key={k} className="card man-part" style={{ ['--c' as string]: P.color }} open={k === 'start' || k === scope.here}>
                <summary><span className="man-n">{P.n}</span><b>{P.title}</b><span className="small muted">{P.intro}</span></summary>
                <TopicList topics={list} />
              </details>
            );
          })}
          <section>
            <h2 className="man-h2">Help</h2>
            <ul className="link-list">
              {HELP.map(([id, title, detail]) => (
                <li key={id}><Link to={`/manual/${id}`}><span className="link-title">{title}</span><span className="link-detail">{detail}</span></Link></li>
              ))}
            </ul>
          </section>
          <p className="small muted man-foot">Manual version {MANUAL_VERSION}. The pictures come from a test copy of the app with made up people. If a step no longer matches the app, tell Mr Andrew.</p>
        </>
      )}
    </div>
  );
}

function TopicList({ topics, showPart }: { topics: ManualTopic[]; showPart?: boolean }) {
  return (
    <ul className="link-list man-list">
      {topics.map((t) => (
        <li key={t.id}>
          <Link to={`/manual/${t.id}`}>
            <span className="link-title">{t.title}</span>
            <span className="link-detail">{showPart ? `${MANUAL_PARTS[t.part].title}. ` : ''}{t.purpose}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Crumb({ part, label }: { part?: ManualPartKey; label?: string }) {
  return (
    <p className="man-crumb small">
      <Link to="/manual">← User manual</Link>
      {part && <span style={{ color: MANUAL_PARTS[part].color }}> · {MANUAL_PARTS[part].n}: {MANUAL_PARTS[part].title}</span>}
      {label && <span> · {label}</span>}
    </p>
  );
}

function ManualTopicPage({ t, scope }: { t: ManualTopic; scope: Scope }) {
  const list = MANUAL_TOPICS.filter((x) => scope.order.includes(x.part));
  const ordered = scope.order.flatMap((k) => list.filter((x) => x.part === k));
  const i = ordered.findIndex((x) => x.id === t.id);
  const prev = i > 0 ? ordered[i - 1] : null;
  const next = i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : null;
  const box = (kind: string, title: string, text?: string) => text && <div className={`man-box ${kind}`}><b>{title}</b><p><Md>{text}</Md></p></div>;

  return (
    <div className="page manual" key={t.id}>
      <Crumb part={t.part} />
      <div className={`man-topic${t.wide ? ' wide' : ''}`}>
        <div className="man-text">
          <h1>{t.title}</h1>
          <p className="man-purpose">{t.purpose}</p>
          <dl className="man-facts">
            <dt>Who can do it</dt><dd>{t.who}</dd>
            <dt>Where to find it</dt><dd>{t.where}</dd>
          </dl>
          {box('before', 'Before you begin', t.before)}
          <ol className="man-steps">
            {t.steps.map((s, n) => <li key={n}><span className="man-dot" aria-hidden="true">{n + 1}</span><span><Md>{s}</Md></span></li>)}
          </ol>
          {box('see', 'What you will see', t.see)}
          {box('tip', 'Tip', t.tip)}
          {box('warn', 'Warning', t.warn)}
        </div>
        {t.img && (
          <figure className={`man-shot ${t.wide ? 'desk' : 'phone'}`}>
            <img src={t.img} alt={`The ${t.title} screen, with numbered circles that match the steps`} loading="lazy" />
            <figcaption className="small muted">{t.wide ? 'On a computer' : 'On a phone'}. The red numbers match the steps.</figcaption>
          </figure>
        )}
      </div>
      <nav className="man-pager" aria-label="Manual pages">
        {prev ? <Link to={`/manual/${prev.id}`} className="btn btn-quiet">← {prev.title}</Link> : <span />}
        {next ? <Link to={`/manual/${next.id}`} className="btn btn-quiet">{next.title} →</Link> : <span />}
      </nav>
    </div>
  );
}

function Table({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <div className="man-table card">
      <div className="man-tr man-th"><b>{head[0]}</b><b>{head[1]}</b></div>
      {rows.map(([a, b]) => <div key={a} className="man-tr"><span><Md>{a}</Md></span><span><Md>{b}</Md></span></div>)}
    </div>
  );
}

function ManualHelp({ id, scope }: { id: string; scope: Scope }) {
  const title = HELP.find((h) => h[0] === id)![1];
  let body: ReactNode = null;
  if (id === 'roles') {
    body = (
      <>
        <p>Your role decides which pages you see. Mr Andrew or Doreen gives each person a role when they make their account.</p>
        {MANUAL_ROLES.map((r) => (
          <details key={r.roleId} className="card man-role" open={r.roleId === scope.roleId}>
            <summary><b>{r.role}</b>{r.roleId === scope.roleId && <span className="man-you small">You</span>}<span className="small muted">{r.does}</span></summary>
            {r.menu && <p className="small"><b>Your menu:</b> {r.menu}</p>}
            <ul className="man-chips">
              {r.jobs.map((j) => MANUAL_TOPICS.find((t) => t.id === j)).filter((t): t is ManualTopic => !!t && scope.order.includes(t.part)).map((t) => (
                <li key={t.id}><Link to={`/manual/${t.id}`}>{t.title}</Link></li>
              ))}
            </ul>
            {r.remember.length > 0 && <ul className="small man-remember">{r.remember.map((x) => <li key={x}>{x}</li>)}</ul>}
          </details>
        ))}
      </>
    );
  } else if (id === 'problems') {
    body = <><Table head={['If this happens', 'Do this']} rows={MANUAL_PROBLEMS} /><div className="man-box tip"><b>Tip</b><p>Press <b>Just ask Andy</b> and describe the problem in your own words. It knows every page of the app.</p></div></>;
  } else if (id === 'words') {
    body = <Table head={['Word', 'What it means']} rows={MANUAL_WORDS} />;
  } else if (id === 'contacts') {
    body = <><Table head={['For', 'Contact']} rows={MANUAL_CONTACTS} /><p>Open Freedom ChMS at <b>freedom-chms.web.app</b> on any phone or computer.</p></>;
  } else if (id === 'privacy') {
    body = (
      <>
        <p>{MANUAL_PRIVACY.intro}</p>
        {MANUAL_PRIVACY.sections.map((s) => (
          <section key={s.h} className="card"><h2 className="man-h2">{s.h}</h2><ul>{s.items.map((x) => <li key={x}><Md>{x}</Md></li>)}</ul></section>
        ))}
        <div className="man-box warn"><b>Warning</b><p>{MANUAL_PRIVACY.warn}</p></div>
      </>
    );
  } else if (id === 'welcome') {
    body = (
      <>
        <section className="card man-letter">{MANUAL_WELCOME.map((p) => <p key={p}><Md>{p}</Md></p>)}<p className="man-sign">Pastor Andrew Guya<br /><span className="small muted">Campus Pastor, Freedom Church Nairobi</span></p></section>
        <h2 className="man-h2">Every manual page looks the same</h2>
        <Table head={['Part of the page', 'What it tells you']} rows={MANUAL_HOW} />
        <h2 className="man-h2">Signs used</h2>
        <div className="man-box before"><b>Before you begin</b><p>Something to have ready before you start.</p></div>
        <div className="man-box see"><b>What you will see</b><p>How you know the job worked.</p></div>
        <div className="man-box tip"><b>Tip</b><p>A quicker or better way to do it.</p></div>
        <div className="man-box warn"><b>Warning</b><p>Take care. A mistake here can affect a person, money or private records.</p></div>
        <p>The sign-in page and the top of the menu show <b>Insight-IQ</b>, the system Freedom ChMS is built on. It is the same app.</p>
      </>
    );
  }
  return (
    <div className="page manual narrow">
      <Crumb label="Help" />
      <h1>{title}</h1>
      {body}
    </div>
  );
}
