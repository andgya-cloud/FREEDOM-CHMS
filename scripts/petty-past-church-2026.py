import datetime as dt
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

NAVY = PatternFill('solid', fgColor='1F3A5F'); GOLD = PatternFill('solid', fgColor='F3E7C4'); LIGHT = PatternFill('solid', fgColor='F5F7FA')
WHITE = Font(bold=True, color='FFFFFF'); BOLD = Font(bold=True); thin = Side(style='thin', color='D0D5DD')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
REQ = "Daniel Ojwang'"; ANDY = 'Andrew Guya'; DOREEN = 'Doreen Mayaka'; ELIAS = 'Elias Omondi'
months = [(2026, m) for m in range(1, 11)]
def month_end(y, m): return (dt.date(y, m + 1, 1) if m < 12 else dt.date(y + 1, 1, 1)) - dt.timedelta(days=1)

entries = []  # (date, order, category, note, payee, items[(desc, price)], kind)
for y, m in months:
    d = dt.date(y, m, 1)
    while d.month == m:
        if d.weekday() == 6:
            entries.append((d, 0, 'Staff Payments', '', 'Habert', [(f'Band appreciation, Sunday {d.day} {d.strftime("%B %Y")}', 21700)], 'band'))
        d += dt.timedelta(days=1)
    e = month_end(y, m); mn = e.strftime('%B %Y')
    entries.append((e, 1, 'Staff Payments', '', 'Solomon Njogu; Purity Kaare', [(f'Solomon Njogu, caretaker, {mn}', 15000), (f'Purity Kaare, caretaker, {mn}', 4000)], 'care'))
    entries.append((e, 2, 'Hospitality', '', 'Media team', [(f'Morning refreshments for the Media team, {mn}', 2000)], 'tea'))
    entries.append((e, 3, 'Other', 'Security', 'Audas', [(f'Audas, security, {mn}', 10000)], 'sec'))
entries.sort(key=lambda x: (x[0], x[1]))

big_alt = [DOREEN, ELIAS]; small_pairs = [(DOREEN, ELIAS), (ELIAS, ANDY), (ANDY, DOREEN)]
bi = si = 0
wb = Workbook()
summary = wb.active; summary.title = 'Summary'
up = wb.create_sheet('Upload'); mi = wb.create_sheet('Money in'); rd = wb.create_sheet('Read me')

cols = ['Voucher no.', 'Date', 'Requester', 'Category', 'Category note', 'Item', 'Qty', 'Unit price (KES)', 'Amount (KES)', 'Paid to', 'M-Pesa code', 'Family Bank ref. no.', 'Approver 1', 'Approver 2']
up.append(cols)
per_month = {}
for n, (d, _, cat, note, payee, items, kind) in enumerate(entries, start=1):
    num = f'FCN-{n:05d}'
    total = sum(p for _, p in items)
    if total > 10000:
        a1, a2 = ANDY, big_alt[bi % 2]; bi += 1
    else:
        a1, a2 = small_pairs[si % 3]; si += 1
    for desc, price in items:
        up.append([num, d, REQ, cat, note or None, desc, 1, price, price, payee, None, None, a1, a2])
    pm = per_month.setdefault((d.year, d.month), {'band': 0, 'care': 0, 'tea': 0, 'sec': 0, 'n': 0, 'first': num})
    pm[kind] += total; pm['n'] += 1; pm['last'] = num

def style_head(ws, row=1):
    for c in ws[row]:
        c.fill = NAVY; c.font = WHITE; c.alignment = Alignment(vertical='center', wrap_text=True); c.border = BOX
    ws.row_dimensions[row].height = 30
style_head(up)
for r in up.iter_rows(min_row=2):
    for c in r: c.border = BOX
    r[1].number_format = 'dd mmm yyyy'; r[7].number_format = '#,##0'; r[8].number_format = '#,##0'
widths = [12, 13, 15, 15, 13, 46, 6, 15, 14, 26, 14, 18, 15, 15]
for i, w in enumerate(widths, 1): up.column_dimensions[get_column_letter(i)].width = w
up.freeze_panes = 'A2'; up.auto_filter.ref = f'A1:N{up.max_row}'

mi.append(['Date', 'Amount (KES)', 'Note'])
for (y, m), pm in sorted(per_month.items()):
    tot = pm['band'] + pm['care'] + pm['tea'] + pm['sec']
    mi.append([dt.date(y, m, 1), tot, f'Petty cash for {dt.date(y, m, 1).strftime("%B %Y")}'])
style_head(mi)
for r in mi.iter_rows(min_row=2):
    for c in r: c.border = BOX
    r[0].number_format = 'dd mmm yyyy'; r[1].number_format = '#,##0'
for i, w in enumerate([14, 15, 34], 1): mi.column_dimensions[get_column_letter(i)].width = w
mi.freeze_panes = 'A2'

summary.append(['Freedom Church Nairobi · Petty cash, January to October 2026'])
summary['A1'].font = Font(bold=True, size=14, color='1F3A5F')
summary.append(['Past monthly expenses, requested by Daniel Ojwang\' and approved by two of Andrew Guya, Doreen Mayaka and Elias Omondi.'])
summary['A2'].font = Font(italic=True, color='555555')
summary.append([])
summary.append(['Month', 'Vouchers', 'Band appreciation (Habert)', 'Caretakers (Solomon, Purity)', 'Media refreshments', 'Security (Audas)', 'Total paid out', 'Money in', 'Balance'])
style_head(summary, 4)
g = {'band': 0, 'care': 0, 'tea': 0, 'sec': 0, 'tot': 0}
for (y, m), pm in sorted(per_month.items()):
    tot = pm['band'] + pm['care'] + pm['tea'] + pm['sec']
    for k in ('band', 'care', 'tea', 'sec'): g[k] += pm[k]
    g['tot'] += tot
    summary.append([dt.date(y, m, 1).strftime('%B %Y'), f"{pm['first']} to {pm['last']} ({pm['n']})", pm['band'], pm['care'], pm['tea'], pm['sec'], tot, tot, 0])
summary.append(['Total', f'FCN-00001 to FCN-{len(entries):05d} ({len(entries)})', g['band'], g['care'], g['tea'], g['sec'], g['tot'], g['tot'], 0])
for r in summary.iter_rows(min_row=5, max_row=summary.max_row):
    for c in r: c.border = BOX
    for c in r[2:]: c.number_format = '#,##0'
for c in summary[summary.max_row]: c.font = BOLD; c.fill = GOLD
for i, w in enumerate([16, 30, 16, 18, 14, 14, 15, 14, 11], 1): summary.column_dimensions[get_column_letter(i)].width = w
summary.row_dimensions[4].height = 45

notes = [
 'How to use this file',
 '1. Check the Upload sheet. Add M-Pesa codes or Family Bank reference numbers if you have them (optional).',
 '2. In Freedom ChMS, open Petty Cash > Reports > Balance sheet > Add past months, and choose this file.',
 '3. Andrew Guya, Doreen Mayaka or Elias Omondi confirms with their name and PIN.',
 '',
 'Rules the upload checks',
 '• Rows with the same Voucher no. are one requisition (the caretakers share one voucher each month).',
 '• Requester: Daniel Ojwang\'. Two different approvers, never the requester.',
 '• Above KES 10,000 Andrew Guya must be one of the two approvers (band and caretakers alternate Doreen and Elias with him).',
 '• Refreshments and security rotate: Doreen + Elias, Elias + Andrew, Andrew + Doreen.',
 '• Band: every Sunday (43 Sundays). Others: last day of each month.',
 '• Money in: on the 1st of each month, exactly what was paid out that month, so today\'s petty cash balance is not changed.',
 '• Requisitions already made in the app move up after FCN-%05d (so today\'s FCN-00001 becomes FCN-%05d).' % (len(entries), len(entries) + 1),
 '• Only the Upload and Money in sheets are read. Keep their column headings as they are.',
 '• Uploading the same file again adds nothing twice.',
]
for t in notes: rd.append([t])
rd['A1'].font = Font(bold=True, size=13, color='1F3A5F'); rd['A6'].font = Font(bold=True, size=13, color='1F3A5F')
rd.column_dimensions['A'].width = 120
for ws in (summary, up, mi, rd): ws.sheet_view.showGridLines = ws is not rd and ws is not summary
path = '/mnt/project-files/petty-past/Freedom-Church-petty-cash-Jan-Oct-2026.xlsx'
wb.save(path)
print(len(entries), g, path)
