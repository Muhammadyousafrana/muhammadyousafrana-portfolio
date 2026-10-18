import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { resumeViewModel } from '@/data/resume'
import { formatContactPhoneForDisplay } from '@shared/contact-handoff'
import { Ban, CheckCircle2, Loader2, MessageSquareText, Phone, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ContactFlowActions, ContactFlowState } from './contact-flow'

const CARD_FRAME = 'rounded-xl border border-border bg-background/80 px-3 py-3 shadow-sm'
const LABEL = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground'
const ownerFirstName = resumeViewModel.firstName

/* The outgoing SMS, drawn as the message it becomes. The filled bubble is
   SMS-green (bg-green-700 carries white text at 5.0:1, AA in both themes) — the
   universal "this is a text message" idiom — with a small phone glyph anchored
   bottom-right. Exactly one line renders beneath it: the card's single status. */
const SmsPreview = ({
  text,
  ghostText = 'Your text shows up here as you type.',
  footer,
}: {
  text?: string
  ghostText?: string
  footer: ReactNode
}) => (
  <div className="flex flex-col items-end gap-1">
    <p className="w-full text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {ownerFirstName}&apos;s phone
    </p>
    {text ? (
      // No pulse on the bubble itself: dimming green-700/white to 50% opacity drops
      // it below AA. The footer spinner carries the "sending" signal instead.
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-green-700 px-3 py-2 text-white shadow-sm">
        <p className="whitespace-pre-wrap text-xs leading-relaxed">{text}</p>
        <span className="mt-1 flex justify-end">
          <Phone className="h-3.5 w-3.5 text-white/80" aria-hidden="true" />
        </span>
      </div>
    ) : (
      <p className="max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {ghostText}
      </p>
    )}
    <div className="flex w-full items-center justify-end gap-1.5 text-[11px] leading-relaxed">
      {footer}
    </div>
  </div>
)

type ContactFlowCardProps = { state: ContactFlowState } & ContactFlowActions

export function ContactFlowCard({
  state,
  setContactHandoffInput,
  completeContactHandoff,
  cancelContactHandoff,
}: ContactFlowCardProps) {
  const requestToolCallId = state.requestPart?.toolCallId
  const fieldId = (suffix: string) =>
    requestToolCallId ? `${requestToolCallId}-${suffix}` : undefined
  const phoneDisplay = formatContactPhoneForDisplay(state.details.contactPhone)

  /* -------- cancelled: ONE line, no card chrome, nothing else -------- */
  if (state.phase === 'cancelled') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Contact request cancelled &mdash; nothing was sent.
      </p>
    )
  }

  /* -------- cancelling (sending phase, cancel action): one busy line -------- */
  if (state.phase === 'sending' && state.pendingAction === 'cancel') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Cancelling&hellip;
      </p>
    )
  }

  /* -------- sending / sent / simulated / failed: the SMS bubble + receipt ----
     One anatomy across all four; the receipt line is the only thing that
     changes, so the transition reads as one object changing state. */
  if (
    state.phase === 'sending' ||
    state.phase === 'sent' ||
    state.phase === 'simulated' ||
    state.phase === 'failed'
  ) {
    const footer =
      state.phase === 'sending' ? (
        <span className="flex items-center gap-1.5 text-muted-foreground" role="status">
          <Loader2
            className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Sending to {ownerFirstName}&apos;s phone&hellip;
        </span>
      ) : state.phase === 'sent' ? (
        <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Delivered &middot;{' '}
            {phoneDisplay
              ? `${ownerFirstName} will text or call you back at ${phoneDisplay}`
              : `${ownerFirstName} has your details`}
          </span>
        </span>
      ) : state.phase === 'simulated' ? (
        <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Simulated &middot; demo mode, no real text was sent
        </span>
      ) : (
        <span role="alert" className="flex items-start gap-1.5 font-medium text-destructive">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Didn&apos;t send &middot; {state.summary ?? "The message couldn't be delivered."} Ask me
            to try again.
          </span>
        </span>
      )

    return (
      <div className={CARD_FRAME}>
        <SmsPreview
          text={state.details.relayMessage}
          ghostText={state.phase === 'failed' ? 'Message unavailable.' : undefined}
          footer={footer}
        />
      </div>
    )
  }

  /* -------- collecting_details: the form -------- */
  if (!requestToolCallId) {
    return null
  }

  const fields = [
    {
      key: 'contactName' as const,
      label: 'Name',
      id: fieldId('contact-name'),
      errorId: fieldId('contact-name-error'),
      type: 'text',
      autoComplete: 'name',
      placeholder: undefined,
    },
    {
      key: 'contactPhone' as const,
      label: 'Phone',
      id: fieldId('contact-phone'),
      errorId: fieldId('contact-phone-error'),
      type: 'tel',
      autoComplete: 'tel',
      placeholder: '+1 555 000 0123',
    },
    {
      key: 'contactCompany' as const,
      label: 'Company · optional',
      id: fieldId('contact-company'),
      errorId: fieldId('contact-company-error'),
      type: 'text',
      autoComplete: 'organization',
      placeholder: undefined,
    },
  ]
  const noteId = fieldId('contact-message')
  const noteErrorId = fieldId('contact-message-error')

  return (
    <div className={CARD_FRAME}>
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600/10">
          <MessageSquareText
            className="h-4 w-4 text-blue-600 dark:text-blue-400"
            aria-hidden="true"
          />
        </span>
        Send {ownerFirstName} a text
      </p>

      <div className="mt-3 space-y-3">
        {/* One field per row — labels never wrap, rows always align. */}
        {fields.map((field) => (
          <div key={field.key} className="space-y-1">
            <label htmlFor={field.id} className={LABEL}>
              {field.label}
            </label>
            <Input
              id={field.id}
              type={field.type}
              value={state.formState[field.key]}
              aria-invalid={Boolean(state.formErrors[field.key])}
              aria-describedby={state.formErrors[field.key] ? field.errorId : undefined}
              onChange={(event) =>
                setContactHandoffInput(requestToolCallId, field.key, event.target.value)
              }
              placeholder={field.placeholder}
              className="h-8"
              autoComplete={field.autoComplete}
            />
            {state.formErrors[field.key] && (
              <p id={field.errorId} role="alert" className="text-xs text-destructive">
                {state.formErrors[field.key]}
              </p>
            )}
          </div>
        ))}

        <div className="space-y-1">
          <label htmlFor={noteId} className={LABEL}>
            Note &middot; optional
          </label>
          <Textarea
            id={noteId}
            value={state.formState.contactMessage}
            aria-invalid={Boolean(state.formErrors.contactMessage)}
            aria-describedby={state.formErrors.contactMessage ? noteErrorId : undefined}
            onChange={(event) =>
              setContactHandoffInput(requestToolCallId, 'contactMessage', event.target.value)
            }
            placeholder="Blank is fine — I'll draft the intro."
            className="min-h-[72px]"
          />
          {state.formErrors.contactMessage && (
            <p id={noteErrorId} role="alert" className="text-xs text-destructive">
              {state.formErrors.contactMessage}
            </p>
          )}
        </div>

        {/* Live preview: the disclosure IS the message. The caption below it is
            the card's single explanation line. */}
        <SmsPreview
          text={state.details.relayMessage}
          footer={
            <span className="text-muted-foreground">
              This exact text goes to {ownerFirstName}&apos;s phone. Sending is immediate.
            </span>
          }
        />

        {state.submitNotice && (
          <p
            role="alert"
            className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive"
          >
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{state.submitNotice}</span>
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            size="sm"
            className="h-9 px-3 text-xs sm:h-8 sm:flex-1"
            onClick={() => {
              void completeContactHandoff(requestToolCallId)
            }}
          >
            Send text
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 px-3 text-xs text-muted-foreground sm:h-8"
            onClick={() => {
              void cancelContactHandoff(requestToolCallId)
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
