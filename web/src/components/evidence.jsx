// components/evidence.jsx: the pieces every page shares. The evidence states
// of input/03.md, the chain (this console's own element, DESIGN.md), the
// principals as Vault recorded them, and the source of every fact.
import { UserRound, Bot, Workflow, Database, KeyRound, ArrowRight } from 'lucide-react';
import { Mono } from './ui.jsx';

// The page's one ink pane.
export function Hero({ kicker, title, lede, children, id = 'hero-h' }) {
  return (
    <section className="vg-hero obs-hero" aria-labelledby={id}>
      {kicker && <p className="obs-hero__kicker">{kicker}</p>}
      <h2 id={id} className="hero-title">
        {title}
      </h2>
      {lede && <p className="hero-lede">{lede}</p>}
      {children}
    </section>
  );
}

const STATE_CLASS = { Confirmed: 'healthy', Correlated: 'approved', Partial: 'pending', Unmatched: 'rejected', Unknown: 'manual' };
export const STATE_TEXT = {
  Confirmed: 'a direct, tested join',
  Correlated: 'independent sources match on a stable identifier',
  Partial: 'a link is missing, or still inside its window',
  Unmatched: 'the window passed and no source shows a match',
  Unknown: 'the source could not be read',
};

export function EvidenceState({ state }) {
  if (!state || state === 'n/a') return <span className="state-na">not applicable</span>;
  return <span className={`vg-pill vg-pill--${STATE_CLASS[state] || 'manual'}`}>{state}</span>;
}

const LINK_TEXT = { requested: 'Requested', decided: 'Decided', issued: 'Issued', used: 'Used', ended: 'Ended' };
const SOURCE_TEXT = { 'vault-audit': 'Vault audit', postgres: 'PostgreSQL log', application: 'application', 'vault-lease': 'Vault lease lookup' };

// The chain: five panes, joined by a line that says how strong each join is.
export function Chain({ chain }) {
  if (!chain) return null;
  return (
    <ol className="chain" aria-label="The evidence chain">
      {chain.map((l) => (
        <li key={l.link} className={`chain__link chain__link--${(l.state || 'na').replace('/', '').toLowerCase()}`}>
          <div className="chain__head">
            <span className="chain__name">{LINK_TEXT[l.link]}</span>
            <EvidenceState state={l.state} />
          </div>
          <p className="chain__detail">{l.detail}</p>
          {(l.source || l.rule) && (
            <p className="chain__meta">
              {l.source && <span>{SOURCE_TEXT[l.source] || l.source}</span>}
              {l.rule && <span title={l.rule_text}>rule {l.rule}</span>}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

const FLOW = {
  human: { icon: UserRound, text: 'person' },
  workload: { icon: Workflow, text: 'workload' },
  agent_autonomous: { icon: Bot, text: 'agent, as itself' },
  agent_obo: { icon: Bot, text: 'agent, for a person' },
  unknown: { icon: UserRound, text: 'unknown' },
};

export function FlowChip({ flow }) {
  const f = FLOW[flow] || FLOW.unknown;
  const Icon = f.icon;
  return (
    <span className="flow-chip">
      <Icon size={12} aria-hidden="true" />
      {f.text}
    </span>
  );
}

// Who initiated, who acted, what was touched (02's three dimensions).
export function Lanes({ subject, actor, target, kind }) {
  return (
    <ol className="lanes" aria-label="Who initiated, who acted, what was touched">
      <li className="lane">
        <span className="lane__role">{actor ? 'Initiated by' : 'Requested by'}</span>
        <strong className="lane__name">{subject?.name || 'not in the record'}</strong>
        {subject?.entity_id && <Mono>{subject.entity_id}</Mono>}
      </li>
      {actor && (
        <>
          <li className="lane__arrow" aria-hidden="true">
            <ArrowRight size={16} />
          </li>
          <li className="lane">
            <span className="lane__role">Executed by</span>
            <strong className="lane__name">{actor.name}</strong>
            <Mono>{actor.entity_id}</Mono>
          </li>
        </>
      )}
      <li className="lane__arrow" aria-hidden="true">
        <ArrowRight size={16} />
      </li>
      <li className="lane">
        <span className="lane__role">Target</span>
        <strong className="lane__name">
          {kind === 'leased_dynamic' ? <Database size={14} aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />} {kind === 'leased_dynamic' ? 'PostgreSQL credential' : 'KV v2 secret'}
        </strong>
        <Mono>{target}</Mono>
      </li>
    </ol>
  );
}

export function SourceChip({ source, label }) {
  return (
    <span className="source-chip">
      {source}
      {label && <span className="source-chip__label">{label}</span>}
    </span>
  );
}

export const when = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
