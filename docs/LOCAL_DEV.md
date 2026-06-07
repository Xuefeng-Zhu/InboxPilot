# Local Development — Public URLs for Webhook Testing

Twilio (SMS) and Postmark (email) can only POST webhooks to **publicly
reachable HTTPS endpoints**. Localhost is not enough. This guide explains
how to expose your local InboxPilot dev server to the public internet using
a tunnel, and how to point each provider at the resulting URL.

## TL;DR

```bash
# Terminal 1
npm run dev          # Next.js on http://localhost:3000

# Terminal 2
npm run tunnel       # prints a public URL like https://xyz.loca.lt
```

Copy the printed URL into the Twilio / Postmark webhook configuration. Done.

---

## How `npm run tunnel` works

`scripts/tunnel.js` opens a public HTTPS tunnel to your local port and
keeps it open until you hit Ctrl-C. It tries two backends, in order:

| Backend    | When it is used                                      | Notes |
|------------|------------------------------------------------------|-------|
| `localtunnel` | Default. No account, no install.                  | URL changes every restart. No uptime guarantee. Asks for a "tunnel password" (your public IP) the first time you hit it from a browser. |
| `ngrok`    | When `NGROK_AUTHTOKEN` is set in the environment.     | Stable URLs (with paid plan), production-quality, recommended for repeated testing. |

The dev server **does not need to be already running** to start the tunnel,
but webhooks will 502 until it is up. A pre-flight check warns you if the
local port is not responding.

### Common options

```bash
# Tunnel a different port (e.g. for `next dev -p 4000`)
PORT=4000 npm run tunnel

# Use a stable ngrok subdomain (requires a paid ngrok plan)
NGROK_AUTHTOKEN=*** npm run tunnel

# Request a specific localtunnel subdomain (best-effort; the name is
# not guaranteed to be available)
TUNNEL_SUBDOMAIN=inboxpilot-dev npm run tunnel
```

---

## Pointing Twilio at the tunnel

Twilio signs every webhook with HMAC-SHA1 over the **full public URL**,
so once the tunnel URL changes, Twilio must be told the new URL or it
will reject the request with HTTP 401.

### Sandbox / test number

1. Start the dev server and the tunnel (see TL;DR above). Copy the URL.
2. Open the [Twilio Console → Phone Numbers → Manage → Active numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming).
3. Pick the sandbox / test number (or any number you own).
4. Under **Messaging → "A message comes in" webhook**, set the URL to:
   ```
   https://<your-tunnel-url>/api/webhooks/sms/twilio
   ```
   The path is whatever route your local InboxPilot exposes the
   `sms-inbound` function on. If you are running the InsForge function
   directly, the path is `/functions/v1/sms-inbound` against the
   function's host.
5. Method: **HTTP POST**. Leave the fallback URL blank unless you
   also want status callbacks.
6. Save. Twilio will send a test webhook — you should see a 200 in
   your dev server logs and the message appear in your local inbox.

### Status callbacks (delivery receipts)

Same form, but on the **"Status callback"** field. Point it at:
```
https://<your-tunnel-url>/api/webhooks/sms/twilio/status
```
(or `/functions/v1/sms-status` if you are proxying directly).

### Updating the URL when the tunnel restarts

localtunnel URLs change on every restart. After restarting the tunnel:

1. Re-copy the new URL from the terminal output.
2. Paste it into the Twilio number's "A message comes in" field.
3. Save. Twilio re-validates the URL with a single GET — your dev
   server should respond 200 to that GET (most webhook handlers do
   so as a health check).

> Tip: if you restart the tunnel frequently, switch to ngrok with a
> reserved subdomain (`NGROK_AUTHTOKEN=*** npm run tunnel`) and the
> URL will stay the same between restarts.

---

## Pointing Postmark at the tunnel

Postmark inbound webhooks (`/inbound`) are configured per server.

1. Start the tunnel and copy the URL.
2. Open the [Postmark Servers dashboard](https://account.postmarkapp.com/servers).
3. Pick the server (or create a new "InboxPilot Dev" server for safety).
4. Go to **Settings → Inbound** (or **Streams → Inbound** depending on
   the UI version) and set the webhook URL to:
   ```
   https://<your-tunnel-url>/api/webhooks/email/postmark
   ```
   (or `/functions/v1/email-inbound` if you are proxying directly).
5. Save. Postmark will POST a verification challenge — the handler
   must echo back the challenge token to confirm ownership. (See
   `insforge/functions/email-inbound/index.ts` for the verification
   code path.)
6. Send a test email to the server's inbound address and watch the
   local InboxPilot inbox for the new conversation.

### Updating the URL when the tunnel restarts

Same as Twilio: re-copy the new URL, paste it into the Postmark
server's inbound webhook field, and save. Postmark re-validates on
save.

---

## Verifying the full loop

After both ends are configured, run through this checklist:

- [ ] `npm run dev` is running, `http://localhost:3000` returns 200.
- [ ] `npm run tunnel` is running and printed a URL like
      `https://abc.loca.lt`.
- [ ] The local URL responds through the tunnel:
      `curl -i https://<url>/` returns the same thing as
      `curl -i http://localhost:3000/`.
- [ ] The Twilio number is pointed at `<url>/api/webhooks/sms/twilio`.
- [ ] The Postmark server's inbound webhook is pointed at
      `<url>/api/webhooks/email/postmark`.
- [ ] Send a real SMS to the Twilio number from your phone → message
      appears in the InboxPilot inbox within ~2s.
- [ ] Send a real email to the Postmark inbound address → message
      appears in the InboxPilot inbox.

If the SMS / email does not arrive, check the dev server logs first.
A 401 means the Twilio signature did not match (most often: the URL
in the Twilio console and the URL the server saw differ by a trailing
slash, query string, or `http` vs `https`). A 404 means the org-id
lookup failed for the receiving phone/email.

---

## Automated test

The same loop is reproduced in CI by
[`__tests__/twilio-webhook-tunnel.test.ts`](../__tests__/twilio-webhook-tunnel.test.ts):

```bash
npm run test:webhook-tunnel
```

That test:
1. Spins up a local HTTP server that runs the same Twilio-adapter
   verification + `InboundMessageService` pipeline the deployed
   `sms-inbound` function uses.
2. Opens a `localtunnel` to that local port.
3. Computes a valid Twilio HMAC-SHA1 signature for the tunnel URL.
4. POSTs a realistic Twilio payload to the **tunnel** URL (not to
   localhost directly).
5. Asserts the local server processed the webhook end-to-end (message
   created, conversation opened, AI job enqueued, audit log written).

Use it as a reference implementation when wiring your own webhook
handler behind a tunnel.

---

## Troubleshooting

**`localtunnel` shows a "tunnel password" page in the browser.**
That's the anti-abuse interstitial. Enter the public IP it shows
(any string works) and the tunnel becomes reachable from that IP.
Webhook POSTs from Twilio/Postmark are not browser requests, so they
will not see this page.

**Tunnel URL keeps changing.**
Either use `ngrok` with `NGROK_AUTHTOKEN` set, or reserve a
localtunnel subdomain with `TUNNEL_SUBDOMAIN=...` (best-effort, not
guaranteed).

**Webhook returns 401 from the dev server.**
The Twilio/Postmark signature was computed over a different URL than
the one the server saw. Re-check the URL in the provider console —
it must match exactly, including protocol and trailing slash.

**Webhook returns 502 / connection refused.**
The tunnel is up but the local dev server is not. Start `npm run dev`
in another terminal, or restart the tunnel so its pre-flight check
can warn you at startup.

**Webhook returns 404 from the dev server.**
The org-id lookup failed. The receiving phone number (Twilio) or
inbound address (Postmark) is not registered in the `sms_phone_numbers`
or `email_addresses` tables. See `docs/DATABASE.md` for the seed
data, or add a row via the InsForge dashboard.
