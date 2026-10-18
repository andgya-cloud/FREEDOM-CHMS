# Stage 5: Giving and receipts

## What I built

- **Funds.** Settings → Funds. One tap adds Tithes and Offerings. More funds (for example Building or Missions) can be added with no code. Each fund can list other spellings, because M-Pesa givers type the fund themselves after the # (FCC#Tithe, FCC#BUILDING, FCC#building fund all work). A fund no longer used can be switched off; it stays in past records and reports.
- **Record gift.** From Today or the Giving page. Cash, M-Pesa, bank and cheque are on the same screen: amount, date, fund, who gave (pick someone in the system, or type a name, or Anonymous), and for M-Pesa the transaction code from the SMS. A code that is already recorded is refused before saving, so a payment can't be counted twice.
- **Import the Paybill 222118 statement.** Download the statement from the M-Pesa portal as Excel (.xlsx) or CSV and choose it on Giving → Import M-Pesa statement.
  - Only completed money-in lines are read. Failed payments, charges and a line repeated in the file are left out, each with the reason shown.
  - Payments already in the app (same M-Pesa code) are skipped, so the same statement can be imported again safely.
  - The fund comes from the account reference: the text after the #.
  - The person is **suggested** from the phone number and name on the statement. A full phone number that matches a record is a strong suggestion; a hidden number (2547\*\*\*\*\*\*78) needs the name to match as well. Two people with the same name are never guessed between. Staff confirm suggestions one by one, or all at once with **Accept suggested matches**.
  - Before importing, the screen shows the statement total, what is already in the app, and what is new. After importing it checks that **statement total = already in the app + imported now** and says "Totals match", or shows the difference.
  - A payment typed in by hand with a different amount from the statement is listed, so it can be voided and entered again.
- **Unassigned.** Payments without a confirmed person or fund wait here, with the statement name, phone, account reference and possible matches. Pick the person (or add them as a new person in one tap, or confirm with the name only) and the fund, then **Confirm**. The receipt follows straight away.
- **Receipts.**
  - Every confirmed gift gets the next number for its organization and year, for example FCN-2026-000123. The server gives the numbers one at a time, so they are always in order and never reused, even when several phones save gifts offline at once.
  - A gift saved offline shows a provisional number (FCN-PROVISIONAL-ABC123) until it syncs, then the official number.
  - **Share receipt** opens the phone's share sheet (choose WhatsApp), or downloads the PDF on a computer. **Print** opens it for printing.
  - The receipt shows the organization, number, date, giver, fund, amount in KES, the M-Pesa code or method, and who received it.
  - **Void.** Amounts, dates and codes can't be edited. A mistake is voided with a reason: the gift and its receipt number stay on record, marked void, and leave every total. **Enter it again, corrected** fills in a new gift from the voided one.
- **Fund ledger and monthly summary** (Giving → Monthly summary, for staff with financial reports).
  - Totals for the month by fund and by method, and what is still in Unassigned. Void gifts are not counted.
  - **Check against the Paybill statement**: the M-Pesa total in the app (confirmed plus unassigned) against the statement lines imported for that month. It says "Matches", or shows the difference and lists the payments behind it: on the statement but not in the app, recorded with a different amount, or in the app but not on the statement.
  - The page can be printed.
- **Giving statements** (the pastor).
  - On a person's record: their giving this year, recent gifts, and **Share giving statement** for any dates.
  - Giving → Giving statements: everyone who gave in a period, each with a Share button, and **Download all statements** as one PDF with a page each. In January it opens on the whole of last year and the Giving page flags that year-end statements are ready.
  - A gift recorded with a name only can be linked to the person's record later (the receipt keeps its name), so it appears on their statement.
- **Who sees what.** Per-person giving (gift lists, statements, receipts) is for the pastor and any staff given "Giving history per person" in their account. Other staff who record gifts see only the gifts they recorded or confirmed, and the Unassigned list. The fund ledger is for staff with "Financial reports". The server rules enforce all of this, not only the screens.
- **Offline.** Gifts are saved on the device first, like check-in. If the server later refuses one (the same M-Pesa code was recorded on another phone while both were offline), it is never lost and never overwrites the other record: it appears at the top of the Giving page under **A gift needs checking**, with its details, for staff to check and mark checked. Importing a statement needs internet, because every code is checked with the server first.

## What I tested here

- **Automated tests pass:**
  - 20 unit tests for giving: reading amounts, funds from account references, M-Pesa codes, receipt numbers, the ledger (including voids and the Unassigned queue), reading a sample statement (totals, dates, skipped lines with reasons), and matching payments to people.
  - 28 server-rule tests for giving. They check that the same M-Pesa code can't be recorded twice, that the amount with each code matches its gift, that amounts, dates, methods and codes can't change, that giver and fund are fixed once a receipt is numbered, that voiding needs a reason and nothing changes after, that a voided payment can be entered again, that staff see only their own gifts and the queue, that receipts and the ledger are pastor and finance only, and that nobody can write receipts, the ledger or the counter from the app.
- **Browser run on local Firebase, phone-sized screen, as the pastor:**
  1. Added Tithes and Offerings, then Building Fund with "Building" as another spelling.
  2. Recorded a cash gift of KES 1,500 from Jane. It got **FCN-2026-000001**; the receipt PDF showed every field.
  3. Typed in Jane's M-Pesa payment QJK1AAAA01 (KES 1,000). It got FCN-2026-000002. Typing the same code again was refused before saving.
  4. Imported a sample statement with 7 lines: 4 completed payments (KES 7,000), a charge, a failed payment, and a repeated line. It showed 2 lines left out with reasons, 1 payment already in the app (KES 1,000) and 3 new (KES 6,000). Peter (hidden phone digits plus name) and Mary (full phone) were suggested; John Kamau was not in the system. Funds were filled in from FCC#Offerings, FCC#Tithe and fcc#building.
  5. After **Accept 2 suggested matches** and Import: **"Totals match. Statement KES 7,000 = already in the app KES 1,000 + imported now KES 6,000."** Peter and Mary got receipts; John went to Unassigned.
  6. In Unassigned I tapped **Add John Kamau as a new person**; his payment was confirmed and got its receipt.
  7. Importing the same statement again found nothing new.
  8. Monthly summary for October 2026: KES 8,500 in 5 gifts, by fund and method, and **"Matches"** against the statement's KES 7,000 of M-Pesa.
  9. **With the internet off**, I recorded KES 200 anonymous cash. It showed **FCN-PROVISIONAL-…**, and FCN-2026-000006 once back online.
  10. Still offline, I typed in Peter's M-Pesa code QJK1AAAA02, which the import had already recorded. Back online, the server refused it and the Giving page showed **"A gift needs checking"** with its details. Peter's imported payment was untouched.
  11. Jane's record showed KES 2,500 this year in 2 gifts, and her statement PDF listed both with totals per fund. Giving statements listed 4 people and noted the 1 name-only gift.

## Notes

- Receipt numbers restart at 000001 each year, per organization, using the organization's receipt prefix (Settings → Organizations).
- Old Excel files (.xls) and PDF statements can't be read: save as .xlsx or CSV.
- The suggestions never confirm a person by themselves; staff always confirm.
- I did not have a real Paybill statement, so the import reads the column names the M-Pesa portal uses (Receipt No., Completion Time, Details, Transaction Status, Paid In, Other Party Info, A/C No.) and falls back to the Details text. If your file looks different, send me its column headings (not the payments) and I'll adjust it.
