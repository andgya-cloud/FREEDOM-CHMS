import { useState, type FormEvent } from 'react';
import { CleanupButton } from '../../components/CleanupDialog';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useFunds, useGift } from '../../state/useGiving';
import { linkGiftToPerson, updateGiftNotes, voidGift } from '../../lib/givingWrites';
import { PersonPicker } from '../../components/PersonPicker';
import { WhatsAppSheet } from '../../components/WhatsAppSheet';
import { usePeople } from '../../state/PeopleContext';
import { openForPrinting, paymentLabel, receiptNumberFor, receiptPdf, shareOrDownload } from '../../lib/givingPdf';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { formatMoney, GIFT_METHOD_LABELS } from '../../../functions/src/shared/giving';
import { formatDateKey, formatDateTime } from '../../../functions/src/shared/datetime';
import { formatPhone } from '../../../functions/src/shared/phone';

/** One gift and its receipt: share on WhatsApp, print, add a note, or void it. */
export function GiftPage() {
  const { orgId = '', giftId = '' } = useParams();
  const { organizations } = useOrg();
  const { can } = useAuth();
  const org = organizations.find((o) => o.id === orgId);
  const { gift, loading, error } = useGift(orgId, giftId);
  const { funds } = useFunds(orgId);
  const toast = useToast();
  const saved = useSavedMessage();
  const navigate = useNavigate();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ id: string | null; name: string } | null>(null);
  const [whatsapp, setWhatsapp] = useState(false);
  const { byId } = usePeople();
  const justSaved = !!(useLocation().state as { justSaved?: boolean } | null)?.justSaved;

  if (!org || !gift) {
    return (
      <div className="page narrow">
        <p><Link to="/giving">← Giving</Link></p>
        <p>{loading ? 'Loading…' : error === 'permission-denied' ? 'Only the pastor, or the person who recorded it, can open this gift.' : 'This gift was not found.'}</p>
      </div>
    );
  }

  const fundName = funds.find((f) => f.id === gift.fundId)?.name ?? 'No fund yet';
  const number = receiptNumberFor(org, gift);
  const canReceipt = gift.status !== 'unassigned' && (can('receipts.issue') || can('giving.person.read'));
  const giver = gift.personId ? byId(gift.personId) : undefined;

  async function receipt(action: 'share' | 'print') {
    setBusy(true);
    try {
      const file = await receiptPdf(org!, gift!, fundName);
      if (action === 'print') openForPrinting(file);
      else if ((await shareOrDownload(file, `Receipt ${number} from ${org!.name}`)) === 'downloaded') toast.show('Receipt downloaded. Send it on WhatsApp as a document.');
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function submitVoid(e: FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) return;
    voidGift(org!.id, gift!.id, reason).catch((err) => toast.show(friendlyError(err)));
    setVoiding(false);
    toast.show(saved('Gift voided. It no longer counts in the totals'));
  }

  function enterAgain() {
    navigate('/giving/new', {
      state: {
        prefill: {
          method: gift!.method, amountCents: gift!.amountCents, date: gift!.date, fundId: gift!.fundId, personId: gift!.personId,
          giverName: gift!.giverName, mpesaCode: gift!.mpesaCode, phone: gift!.phone, accountRef: gift!.accountRef, notes: '',
        },
        replaces: gift!.id,
      },
    });
  }

  const details: [string, React.ReactNode][] = [
    ['Receipt number', gift.status === 'unassigned' ? 'Given once a person and fund are chosen' : gift.receiptNumber ?? <>{number} <span className="muted small">(the official number comes when this device is online)</span></>],
    ['Date', formatDateKey(gift.date)],
    ['Given by', gift.personId ? <Link to={`/people/${org.id}/${gift.personId}`}>{gift.giverName}</Link> : gift.giverName || 'Not known yet'],
    ['Fund', fundName],
    ['Payment', paymentLabel(gift)],
    ['Received by', gift.receivedByName],
  ];
  if (gift.phone) details.push(['Phone', gift.phone.includes('*') ? gift.phone : formatPhone(gift.phone.startsWith('+') ? gift.phone : `+${gift.phone}`)]);
  if (gift.accountRef) details.push(['Account reference', gift.accountRef]);
  if (gift.createdAt) details.push(['Recorded', formatDateTime(gift.createdAt.toDate(), org.timeZone)]);
  if (gift.status === 'void') details.push(['Voided', `${gift.voidReason ?? ''}${gift.voidedAt ? ` (${formatDateTime(gift.voidedAt.toDate(), org.timeZone)})` : ''}`]);

  return (
    <div className="page narrow">
      <p><Link to="/giving">← Giving</Link></p>
      <div className="person-head">
        <div>
          <h1>{formatMoney(gift.amountCents, org.currency || 'KES')}</h1>
          {gift.status === 'void' && <span className="badge badge-muted">Void</span>}
          {gift.status === 'unassigned' && <span className="badge badge-warn">Unassigned</span>}
          <span className="muted small"> {GIFT_METHOD_LABELS[gift.method]}</span>
        </div>
        <CleanupButton orgId={orgId} kind="gift" id={giftId} back="/giving" />
      </div>

      {justSaved && gift.status !== 'void' && (
        <div className="notice notice-ok just-saved no-print">
          <b>Saved.</b>
          {giver && canReceipt && gift.status === 'confirmed' && <button type="button" className="btn btn-primary" onClick={() => setWhatsapp(true)}>Say thank you to {giver.firstName} on WhatsApp</button>}
          <Link className="btn" to="/giving/new">Record another</Link>
        </div>
      )}

      {gift.status === 'unassigned' && (
        <div className="notice">This payment needs {gift.unassignedReason === 'fund' ? 'a fund' : gift.unassignedReason === 'person' ? 'a person' : 'a person and a fund'}. <Link to="/giving/unassigned">Open the Unassigned list</Link></div>
      )}

      <section className="card">
        <dl className="details">
          {details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          {gift.notes && <div><dt>Notes</dt><dd>{gift.notes}</dd></div>}
        </dl>
        {canReceipt && (
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void receipt('share')}>Share receipt</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void receipt('print')}>Print</button>
            {giver && gift.status === 'confirmed' && <button type="button" className="btn" onClick={() => setWhatsapp(true)}>WhatsApp thank-you</button>}
          </div>
        )}
        {whatsapp && giver && (
          <WhatsAppSheet
            org={org}
            person={giver}
            templateId="giving_receipt"
            templateIds={['giving_receipt']}
            giftId={gift.id}
            fields={{ receipt_number: gift.receiptNumber ?? number, amount: formatMoney(gift.amountCents, org.currency || 'KES'), fund: fundName, date: formatDateKey(gift.date) }}
            onClose={() => setWhatsapp(false)}
          />
        )}
      </section>

      {gift.status !== 'void' && can('gifts.write') && (
        <section className="card">
          {note === null ? (
            <button type="button" className="btn btn-quiet align-start" onClick={() => setNote(gift.notes)}>{gift.notes ? 'Change the note' : 'Add a note'}</button>
          ) : (
            <form className="form" onSubmit={(e) => {
              e.preventDefault();
              updateGiftNotes(org.id, gift.id, note).catch((err) => toast.show(friendlyError(err)));
              setNote(null);
            }}>
              <label className="field"><span>Note</span><input autoFocus value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <div className="dialog-actions">
                <button type="button" className="btn btn-quiet" onClick={() => setNote(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save note</button>
              </div>
            </form>
          )}

          {gift.status === 'confirmed' && !gift.personId && (link === null ? (
            <button type="button" className="btn btn-quiet align-start" onClick={() => setLink({ id: null, name: gift.giverName })}>Link to a person's record</button>
          ) : (
            <form className="form" onSubmit={(e) => {
              e.preventDefault();
              if (!link.id) return;
              linkGiftToPerson(org.id, gift.id, link.id).catch((err) => toast.show(friendlyError(err)));
              setLink(null);
              toast.show(saved('Linked. It now shows on their giving statement'));
            }}>
              <PersonPicker label="Person" value={link} onChange={setLink} orgId={org.id} hint="The receipt keeps the name it was issued with." />
              <div className="dialog-actions">
                <button type="button" className="btn btn-quiet" onClick={() => setLink(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!link.id}>Link</button>
              </div>
            </form>
          ))}

          {!voiding ? (
            <button type="button" className="btn btn-quiet danger-text align-start" onClick={() => setVoiding(true)}>Void this gift</button>
          ) : (
            <form className="form" onSubmit={submitVoid}>
              <p>Voiding takes the gift out of every total. The record{gift.receiptNumber ? ` and receipt ${gift.receiptNumber}` : ''} stay, marked void. Amounts, dates and codes can't be edited, so to correct a mistake, void it and enter it again.</p>
              <label className="field"><span>Reason</span><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: wrong amount typed" /></label>
              <div className="dialog-actions">
                <button type="button" className="btn btn-quiet" onClick={() => setVoiding(false)}>Cancel</button>
                <button type="submit" className="btn btn-danger" disabled={reason.trim().length < 3}>Void gift</button>
              </div>
            </form>
          )}
        </section>
      )}

      {gift.status === 'void' && can('gifts.write') && (
        <button type="button" className="btn align-start" onClick={enterAgain}>Enter it again, corrected</button>
      )}
    </div>
  );
}
