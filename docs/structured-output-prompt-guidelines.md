# Structured Output Prompt Guidelines

Repo-specific contract for the fit-analysis structured output (`POST /api/analyze-fit`). Generic
"how to prompt for JSON" advice lives with the AI SDK docs; this file records only what is specific
to this codebase.

## Where each responsibility lives

The fit result is generated against a strict Zod schema. Each layer has a distinct enforcement or
steering role:

- **Schema** (`shared/fit-analysis.ts`) is the source of truth and the final authority. It owns the
  shape, required fields, scalar bounds, and the cross-field invariants: its `superRefine` enforces
  the verdict-dependent score and array invariants (a "Strong Fit" cannot carry disqualifiers, a
  "Not a Fit" must). Anything the model returns that violates these is rejected at runtime.
- **The prompt** (`shared/ai-prompts.ts`) does not enforce; it steers generation. It mirrors the
  cross-field constraints the model needs to produce valid output (e.g. the verdict-to-score
  thresholds) and adds the evidence policy the schema cannot express: how to weigh must-have gaps,
  when a role is a genuine no-fit, and fail-closed behavior when evidence is weak. "Not a Fit" is a
  valid, honest verdict.

Keep the prompt narrow: mirror only the cross-field constraints needed for valid generation, not the
raw shape (keys, required flags, min/max) the schema already enforces on its own.

## Related files

- [`../shared/ai-prompts.ts`](../shared/ai-prompts.ts)
- [`../shared/fit-analysis.ts`](../shared/fit-analysis.ts)
- [`./ai-model-strategy.md`](./ai-model-strategy.md)
