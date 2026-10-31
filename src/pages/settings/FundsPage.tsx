import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useFunds, type Fund } from '../../state/useGiving';
import { addStandardFunds, saveFund } from '../../lib/givingWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { OrgGate } from '../../components/OrgGate';
import { fundIdFor, PAYBILL_NUMBER } from '../../../functions/src/shared/giving';

/**
 * The funds gifts are given to. M-Pesa givers type the fund after the # in
 * the account (FCC#Tithes), so each fund can also list other spellings.
 */
export function FundsPage() {
  return <OrgGate title="Funds">{(org) => <Funds org={org} />}</OrgGate>;
}

function Funds({ org }: { org: Organization }) {
  const { funds, loading } = useFunds(org.id);
  const toast = useToast();
  const saved = useSavedMessage();
  const [editing, setEditing] = useState<Fund | 'new' | null>(null);

  return (
    <div className="page narrow">
      <p><Link to="/giving">← Giving</Link></p>
      <div className="page-head">
        <h1>Funds</h1>
        {funds.length > 0 && !editing && <button type="button" className="btn btn-quiet" onClick={() => setEditing('new')}>New fund</button>}
      </div>
      <p className="muted small">Givers on Paybill {PAYBILL_NUMBER} type the fund after the #, for example FCC#Tithes or FCC#Building. The import matches it to a fund by its name or any other spelling listed here, ignoring capitals and a plural "s".</p>

      {loading && funds.length === 0 ? <p className="muted">Loading…</p> : funds.length === 0 && !editing ? (
        <div className="card">
          <p>No funds yet.</p>
          <button type="button" className="btn btn-primary" onClick={() => {
            addStandardFunds(org.id, []).catch((err) => toast.show(friendlyError(err)));
            toast.show(saved('Tithes and Offerings added'));
          }}>Add Tithes and Offerings</button>
          <p className="hint">You can add more funds, such as Building or Missions, afterwards. <button type="button" className="btn btn-quiet" onClick={() => setEditing('new')}>Or start with a different fund.</button></p>
        </div>
      ) : (
        <ul className="link-list">
          {funds.map((f) => (
            <li key={f.id}>
              <button type="button" className="row-button" onClick={() => setEditing(f)}>
                <span className="link-title">{f.name}{!f.active && <span className="badge badge-muted">Not in use</span>}</span>
                <span className="link-detail">FCC#{f.name.replace(/\s+/g, '')}{f.aliases.length ? ` · also ${f.aliases.join(', ')}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && <FundForm org={org} fund={editing === 'new' ? null : editing} taken={funds.map((f) => f.id)} onDone={() => setEditing(null)} />}
    </div>
  );
}

function FundForm({ org, fund, taken, onDone }: { org: Organization; fund: Fund | null; taken: string[]; onDone: () => void }) {
  const toast = useToast();
  const saved = useSavedMessage();
  const [name, setName] = useState(fund?.name ?? '');
  const [aliases, setAliases] = useState(fund?.aliases.join(', ') ?? '');
  const [active, setActive] = useState(fund?.active ?? true);
  const [error, setError] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = fund?.id ?? fundIdFor(name);
    if (name.trim().length < 2) return setError('Enter a name of at least 2 letters.');
    if (!fund && (id.length < 2 || taken.includes(id))) return setError('There is already a fund with this name.');
    saveFund(org.id, id, { name, aliases: aliases.split(','), active }, !!fund).catch((err) => toast.show(friendlyError(err)));
    toast.show(saved(fund ? 'Fund saved' : `${name.trim()} added`));
    onDone();
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{fund ? `Edit ${fund.name}` : 'New fund'}</h2>
      <label className="field"><span>Name</span><input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="For example Building" /></label>
      <label className="field">
        <span>Other spellings (optional)</span>
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="For example Build, Construction" />
        <small className="hint">Separate with commas. Up to 10.</small>
      </label>
      {fund && (
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>In use (unticked funds stay in past records and reports, but can't be chosen for new gifts)</span>
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn btn-primary">{fund ? 'Save' : 'Add fund'}</button>
      </div>
    </form>
  );
}
