# Contact Outreach Flow

## What this is

Someone chatting with the AI assistant can trigger a text message to the site owner. The assistant
decides when it makes sense to offer this, so the visitor does not need to find a button or navigate
anywhere. The form itself is generic: it collects whatever contact details the visitor wants to
leave.

This is an **optional** feature. It is powered by Twilio and the `CONTACT_SMS_TO_NUMBER` secret (the
owner's destination number). When those are not configured, the flow runs safely in simulation mode
(no real message is sent).

## The experience

1. The visitor is chatting with the assistant.
2. The conversation reaches a point where contacting the owner makes sense (the visitor asks to get
   in touch, or the assistant judges it is the right moment).
3. The assistant calls `show_contact_form`, which renders a compact in-chat form:
   - **Name** (required)
   - **Phone number** (required): the number the owner can call back on
   - **Company** (optional)
   - **Note** (optional): a short message for the owner
4. The visitor submits the form. This attempts the handoff. There is no separate approval step:
   filling in the form and clicking send is the confirmation.
5. The visitor sees the actual outcome: sent, or a safe simulation when SMS is not configured (and a
   clear error state if a configured send fails).
6. The flow ends cleanly. Tool-description and prompt guidance steer the assistant not to reopen the
   same request in the same turn (best-effort, not a hard block); a new request should only start if
   the visitor explicitly asks again later.

## Cancellation

The form has a cancel button. If the visitor clicks it:

- No SMS is sent.
- The assistant receives a signal that the request was cancelled, so it has context on what
  happened.
- If the visitor asks "what just happened?" the assistant can respond naturally (for example, "You
  decided not to send your details, so no message was sent").
- The visitor can start a new contact request later in the same conversation.

## Same-turn re-entry

Once a contact flow resolves for a visitor message, the assistant should not reopen or re-send it in
the same turn. The serialized tool list stays stable across steps for prompt-cache reuse; the tool
description and prompt guidance tell the model not to reopen a form it already resolved this turn.
This is best-effort steering, not a hard server-side block.

## What the owner receives

A concise, actionable SMS addressed with the owner's name (from the content seam), for example:

```
Contact request for Jordan Ellis
Name: Jane Doe
Company: Acme Robotics
Callback phone: +16045551234
Message: Interested in discussing the senior platform role.
```

If the visitor does not write a note, the app composes a brief relay message from the collected
contact details. The `Company` line is omitted when not provided.

## What the AI knows (and does not)

- The assistant knows it has a tool to send a text and what details to collect.
- The assistant does **not** know the owner's phone number (`CONTACT_SMS_TO_NUMBER`), the Twilio
  credentials, or any dispatch implementation detail. All of that is server-side only.

## Validation

- Empty required fields are blocked with inline errors.
- Phone numbers are validated and normalized (strict E.164) before submission.
- Loading states are shown during submission.
- If Twilio credentials (or `CONTACT_SMS_TO_NUMBER`) are missing, the send is simulated safely, with
  no crash.
- Once the same-turn contact flow resolves, prompt guidance steers the model away from reopening or
  re-sending it (best-effort, not hard-blocked).
- The owner's destination number is never exposed in frontend code, prompts, logs, or tool
  arguments.

Implementation lives in [`worker/contact-handoff.ts`](../worker/contact-handoff.ts) (validation +
Twilio dispatch) and [`shared/contact-handoff.ts`](../shared/contact-handoff.ts) (relay message +
phone normalization).
