import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Anything extra under the words, like a photo picker. */
  children?: ReactNode;
}

export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
