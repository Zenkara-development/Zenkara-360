# Connecting External Forms to CRMITdesk

Any form tool that can send an HTTP POST after a submission can create leads or tickets in CRMITdesk. This guide covers Google Forms, Zoho Forms, Zapier/Make, and plain HTML forms.

## What you need (from Admin → Web Forms)

For the CRMITdesk form you want to feed, copy two things from its card:

1. **Endpoint URL** — `https://crm-itdesk-server.onrender.com/api/public/forms/<FORM_ID>/submit`
   (take the `<FORM_ID>` from the public link shown on the card: `.../form/<FORM_ID>`)
2. **Webhook intake token** — the `wfk_...` value ("Copy token" button)

The token goes in an `x-intake-token` HTTP header. It proves the request comes from *your* integration and lifts the per-IP rate limit (webhook traffic all arrives from one provider IP, which would otherwise be throttled). Requests without it still work but are rate-limited like anonymous visitors. If the token ever leaks, press **Rotate** on the form card and update your integrations.

## Accepted fields (JSON body)

| Field     | Required            | Notes                                             |
|-----------|---------------------|---------------------------------------------------|
| `name`    | yes                 | Contact's full name                               |
| `email`   | yes                 | Used to reuse an existing contact when it matches |
| `phone`   | no                  |                                                   |
| `company` | no                  | Lead forms — goes into the lead notes             |
| `subject` | no (ticket: title)  | Ticket forms — becomes the ticket title           |
| `message` | no                  | Lead notes / ticket description                   |

Everything is sanitized server-side (HTML stripped, length-capped). A submission creates a Contact + Lead or Contact + Ticket and runs your workflows — so an AI Auto-Assign rule will route it to the right department and person automatically.

---

## Google Forms (Apps Script)

Google Forms has no native webhooks, so a small script forwards each response.

1. Open your Google Form → three-dot menu → **Apps Script**.
2. Paste this, filling in the three constants at the top:

```javascript
// ── CRMITdesk web-to-lead/web-to-ticket bridge ──────────────────────
const ENDPOINT = 'https://crm-itdesk-server.onrender.com/api/public/forms/YOUR_FORM_ID/submit';
const INTAKE_TOKEN = 'wfk_paste_your_token_here';

// Map your Google Form question titles (left) to CRMITdesk fields (right).
// Match the titles EXACTLY as they appear in your form.
const QUESTION_MAP = {
  'Your name':          'name',
  'Email address':      'email',
  'Phone number':       'phone',
  'Company':            'company',
  'Subject':            'subject',
  'How can we help?':   'message',
};
// ────────────────────────────────────────────────────────────────────

function onFormSubmit(e) {
  const payload = {};
  e.response.getItemResponses().forEach(function (ir) {
    const field = QUESTION_MAP[ir.getItem().getTitle()];
    if (field) payload[field] = String(ir.getResponse());
  });
  if (!payload.name || !payload.email) return; // both are required

  UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-intake-token': INTAKE_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}
```

3. In the Apps Script editor: **Triggers** (clock icon) → **Add Trigger** → function `onFormSubmit`, event source **From form**, event type **On form submit** → Save (approve the permission prompt).
4. Submit a test response — it should appear in CRMITdesk within seconds.

## Zoho Forms (native webhook — no code)

1. Open your form in Zoho Forms → **Integrations** → **Webhooks** → configure a webhook.
2. **Webhook URL**: your endpoint URL from above. **Method**: POST. **Content type / format**: JSON.
3. **Headers**: add `x-intake-token` = your `wfk_...` token.
4. **Parameters / payload mapping**: map your Zoho fields to parameter names `name`, `email`, `phone`, `company`, `subject`, `message` (only `name` and `email` are required).
5. Save and submit a test entry.

Typeform, Jotform, and Tally work the same way — each has a "Webhooks" integration where you set the URL, a header, and field names.

## Zapier / Make / n8n

Use the trigger for your form tool ("New form response"), then the generic HTTP/webhook action:

- **POST** to your endpoint URL
- Header `x-intake-token`: your token
- JSON body with `name`, `email`, and any of the other fields mapped from the trigger

## Plain HTML / custom site (fetch)

```html
<script>
async function sendToCRM(form) {
  const r = await fetch('https://crm-itdesk-server.onrender.com/api/public/forms/YOUR_FORM_ID/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: form.name.value,
      email: form.email.value,
      phone: form.phone.value,
      message: form.message.value,
    }),
  });
  return r.ok;
}
</script>
```

Note: do **not** put the intake token in browser-side code — anything in a web page is public. Browser submissions should omit it (they're rate-limited per visitor IP, which is what you want). The token is only for server-to-server senders like Apps Script, Zoho, and Zapier. For plain websites, the simplest option remains embedding CRMITdesk's own hosted form with the iframe snippet from the Web Forms page.

## Quick test with curl

```bash
curl -X POST 'https://crm-itdesk-server.onrender.com/api/public/forms/YOUR_FORM_ID/submit' \
  -H 'Content-Type: application/json' \
  -H 'x-intake-token: wfk_your_token' \
  -d '{"name":"Test Person","email":"test@example.com","message":"Hello from curl"}'
```

Expected reply: `{"ok":true,"message":"Thanks — ..."}` and a new lead/ticket in the app.

## Limits

- With a valid token: 600 submissions/hour per form.
- Without a token: 10 per 10 minutes per visitor IP, 60/hour per form.
- Rotating a token takes effect immediately; the old token then counts as anonymous.
