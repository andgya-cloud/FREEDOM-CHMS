# Stage 11: WhatsApp Cloud API automation

## What I built

Some follow-ups can now be sent by the app itself, through Meta's WhatsApp Cloud API, from a new WhatsApp Business number. The "open WhatsApp and tap send" button stays as the fallback and still works for everything.

- **Four message types can be automatic**: first-time visitor welcome, 48-hour check-in, care message after 3 weeks absent, and child absent (to the guardian). Each has three settings in **Settings → WhatsApp automation**: **Off**, **Staff approve each message first**, or **Send by itself**. Everything starts Off.
- **Approve first**: every hour the app looks at open follow-ups. For a type set to approve, it prepares the message and shows it on the follow-up card as "Automatic WhatsApp: Waiting for your approval", with the exact words, who it goes to, and two buttons: **Approve and send** or **Don't send**. The staff member's first name signs the message. When you trust a type, switch it to Send by itself.
- **Who gets a message**: only people who agreed to WhatsApp and have not asked us to stop. A child is never messaged: the message goes to the parent or guardian, who must have agreed. Consent is checked again at the moment of sending.
- **When**: between 08:00 and 20:00 in the campus time zone. The 48-hour check-in waits until the morning it is due. A follow-up that was already messaged by hand is skipped. Approving by hand sends straight away.
- **Delivery tracking**: the follow-up card shows Sent, Delivered, Read, or Not delivered with a plain reason (for example "This number is not on WhatsApp"). If the person replies, it says "They replied".
- **Stop**: if someone replies stop, unsubscribe, cancel, opt out, acha, komesha or simama (the whole message), their WhatsApp consent is switched off on their record, the date is saved, and anything waiting for them is cancelled. The next message to that person would not be sent.
- **Not automatic, ever**: salvation and baptism messages (they reveal belief) and school-fee reminders (a person should check the amount). These stay tap-to-send.
- **Logging**: each automatic message is written to the message log (template, sender "Automatic" or "Grace (automatic)", time). The words are kept on the follow-up card only.
- **Secrets**: the access token, app secret and webhook verify token are stored in Firebase's secret store, never in the code, the database or chat.

## Who can do what

| | Admin | Pastor |
|---|---|---|
| See automatic messages and delivery on follow-ups | yes | yes |
| Approve or cancel a waiting message | yes | yes |
| Create, edit or delete the messages | no one (only the server) | no one |
| Settings → WhatsApp automation | no | yes |

## Part 1: Set up Meta (you do this; about 45 minutes, plus Meta's approval wait)

You need a phone number that is **not** already on WhatsApp or WhatsApp Business (a new SIM is best). The staff phone with the existing number keeps working.

1. Go to **business.facebook.com** and sign in with a Facebook account. Click **Create a business account** (or use the one you have). Fill in Freedom Church Nairobi, and your name and work email.
2. In the business settings, open **Security Center** and start **Business verification** (upload your church registration papers). Meta may take days. You can test with a test number before it finishes, but real people can only be messaged after verification.
3. Go to **developers.facebook.com** → **My Apps** → **Create App** → choose **Business** → name it "Freedom ChMS" → link your business account.
4. In the app, **Add product** → **WhatsApp** → **Set up**. Under **API Setup**, choose **Add phone number**, enter the new number and confirm it with the code sent by SMS or call.
5. On that screen copy the **Phone number ID** (a long number; not the phone number). Paste it into the app: Settings → WhatsApp automation → Phone number ID. Do not turn it on yet.
6. **Token**: business.facebook.com → **Business settings** → **Users** → **System users** → **Add** (name: chms, role: Admin). **Add assets**: select your app, give Full control. Click **Generate new token**: pick your app, set expiry **Never**, tick **whatsapp_business_messaging** and **whatsapp_business_management**. Copy the token somewhere safe for the next 10 minutes. **Do not send it to me or paste it in chat.**
7. **App secret**: developers.facebook.com → your app → **App settings** → **Basic** → **App secret** → **Show**.
8. **Templates**: WhatsApp Manager (business.facebook.com → WhatsApp accounts → your account → **Message templates** → **Create template**). Make four templates. For each: Category as shown, Language **English**, Name exactly as shown in the app (Settings → WhatsApp automation, step 3), body pasted from there, and for the slots {{1}} {{2}}... use the example values the app lists. Submit. Meta normally approves within minutes to a day. Until a template is approved, sending it fails with "Meta has not approved this message template yet".

## Part 2: Put the secrets and jobs on Firebase (one script)

1. Do the usual update first: download `freedom-chms.tar.gz` and `redeploy.sh`, then run `bash ~/Downloads/redeploy.sh` (this puts the new app and rules live; answer **No** to the old africa-south1 deletion question as before).
2. Download `whatsapp-setup.sh` and run `bash ~/Downloads/whatsapp-setup.sh`.
   - Paste the access token when asked (nothing shows as you type). Press Enter.
   - Paste the app secret. Press Enter.
   - The script shows a **verify token**. Copy it. Press Enter.
   - It stores the three secrets and puts three jobs live. If Firebase asks to enable a Google service (Secret Manager), say yes.
3. In Meta: your app → **WhatsApp** → **Configuration** → **Webhook** → **Edit**:
   - Callback URL: `https://africa-south1-freedom-chms.cloudfunctions.net/whatsappWebhook` (the script prints it)
   - Verify token: the one the script showed. Click **Verify and save**.
   - Under **Webhook fields**, **Subscribe** to **messages**.
4. In the app: Settings → WhatsApp automation. Tick **Allow automatic WhatsApp messages**. Set the types you want to **Staff approve each message first**. Save.

## Test it (about 20 minutes, after Part 1 and 2)

1. Add yourself as a visitor with your own WhatsApp number and tick that you agreed to WhatsApp messages.
2. Wait for the top of the next hour (or tomorrow morning if it is after 20:00). Open Follow-ups: your welcome shows "Waiting for your approval" with the words.
3. Tap **Approve and send**. A few seconds later your phone gets the message and the card says Sent, then Delivered, then Read.
4. Reply "Amen". The card says "They replied".
5. Add a second visitor for a friend, wait for the card, approve it, and have them reply **STOP**. Open their record: WhatsApp consent is off and the stop date is set. Their waiting messages are cancelled.
6. Break it on purpose: type a wrong template name in Settings and approve another. The card says "Not delivered" with the reason, and the WhatsApp button still works.

## What I tested here

Automated: 16 tests of the message rules (hours, templates, slots, status order, stop words, failure reasons); 11 new permission tests (staff can approve or cancel a waiting message but not create, edit or delete one, nobody can read the server-side lookups, only the pastor saves the settings, unknown message types are rejected); everything earlier still passes (196 unit, 175 permission tests). On local Firebase with a stand-in for Meta: nothing queued at night; welcome waits for approval; the child message went to the guardian automatically with the right template name and slots and the right number and token; people without consent, salvation follow-ups and a not-yet-due check-in were not queued; approving sent the message signed by the approver; delivery updates, a late "delivered" after "read", a failure with its reason, a reply, STOP, a wrong signature (refused) and Meta's verification handshake all behaved; after STOP nothing further was queued for that guardian.

## What I could not test

The real Meta service: the real token, template approval, the live webhook and a message arriving on a real phone. I cannot reach Meta from here. The first live message is the real test (steps above). The hourly schedule on the live project is also checked after you deploy (it runs from Europe like the other schedules).

## Decisions I made (tell me if you want any changed)

- **Messages Meta approves are what is sent.** The app fills slots in the approved text; the wording on screen is a faithful preview. If you change the words in Meta, the preview in the app will not know, so keep Meta's text and the app's text the same.
- **Hours** 08:00 to 20:00 local. Approvals outside those hours send immediately.
- **Template names** are suggestions you can change in Settings (for example if Meta rejects a name).
- **Stop** only matches numbers the app has messaged, and only a message that is just the keyword. A longer reply that happens to include "stop" is a normal reply.
- **Staff name**: automatic messages sent without approval say "the team" where a staff name would go; approved ones carry the approver's first name.
- **Up to 50 messages per campus per hour** are prepared, to keep a mistake small.
- **The 24-hour window**: Meta allows free-form replies only within 24 hours of the person writing. This stage sends templates only; there is no inbox or free chat.
- **Cost**: Meta charges per conversation (a utility template to a Kenyan number is a few cents of a dollar). Check their current price list. The app has no cost counter.
- **Erasing a person** removes their automatic messages too. The number lookup used to match a stop reply is a small server record that is not erased, but only names the record that no longer exists.

## Still open from earlier stages

Two-step sign-in (needs the Identity Platform upgrade), backups go to Firebase Storage not Google Drive, report emails need the Trigger Email extension, the lawyer or data protection officer review (now including WhatsApp consent wording), and the exam-body candidate list template. Not built: Daraja M-Pesa, camera and QR scanning, donors and sponsors.
