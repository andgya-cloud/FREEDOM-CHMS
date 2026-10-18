import { Link } from 'react-router-dom';
import type { Organization } from '../state/OrgContext';
import type { Gift } from '../state/useGiving';
import { formatMoney } from '../../functions/src/shared/giving';
import { formatDateKey } from '../../functions/src/shared/datetime';
import { paymentLabel, receiptNumberFor } from '../lib/givingPdf';

export function GiftRow({ org, gift, fundName, showGiver = true }: { org: Organization; gift: Gift; fundName: string; showGiver?: boolean }) {
  return (
    <li className="row">
      <Link to={`/giving/${org.id}/${gift.id}`} className="row-main">
        <span className="row-title">
          {formatMoney(gift.amountCents, org.currency || 'KES')}
          {showGiver && <span> · {gift.giverName}</span>}
          {gift.status === 'void' && <span className="badge badge-muted">Void</span>}
          {gift.status === 'unassigned' && <span className="badge badge-warn">Unassigned</span>}
          {gift.status === 'confirmed' && !gift.receiptNumber && <span className="badge badge-warn">Receipt number pending</span>}
        </span>
        <span className="row-detail">
          {formatDateKey(gift.date)} · {fundName} · {paymentLabel(gift)}{gift.status !== 'unassigned' ? ` · ${receiptNumberFor(org, gift)}` : ''}
        </span>
      </Link>
    </li>
  );
}
