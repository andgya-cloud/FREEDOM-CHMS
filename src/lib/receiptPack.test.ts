import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

// A 1×1 PNG and a one-page PDF stand in for receipts that reached the device.
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const files: Record<string, string | null> = { a: png, c: null };
vi.mock('./pettyCashWrites', () => ({ receiptData: async (_org: string, id: string) => files[id] ?? null }));
vi.mock('./givingPdf', () => ({ downloadFile: () => {} }));

describe('receipt packs', () => {
  it('puts a contents page, then each receipt, and counts the ones not on this device', async () => {
    const one = await PDFDocument.create();
    one.addPage();
    files.b = `data:application/pdf;base64,${Buffer.from(await one.save()).toString('base64')}`;
    const { buildReceiptPack } = await import('./receiptPack');
    const { bytes, missing } = await buildReceiptPack('ADIA Training Centre', 'Receipts for October 2026', [
      { number: 'ADIA-00012', requesterName: 'Elias Omondi', amount: 'KES 2,000', category: 'Transport', status: 'Complete', items: [{ description: 'Fuel' }, { description: 'Parking' }],
        receipts: [{ id: 'a', name: 'till.png', type: 'image/png', itemIndex: 1, uploadedByName: 'Elias' }, { id: 'b', name: 'invoice.pdf', type: 'application/pdf', uploadedByName: 'Elias' }, { id: 'c', name: 'later.jpg', type: 'image/jpeg', uploadedByName: 'Elias' }] },
      { number: 'ADIA-00013', requesterName: 'Doreen Mayaka', amount: 'KES 500', category: 'Other', status: 'Approved · receipt needed', items: [], receipts: [] },
    ], 'adia');
    const pack = await PDFDocument.load(bytes);
    expect(pack.getPageCount()).toBe(3);
    expect(missing).toBe(1);
  });
});
