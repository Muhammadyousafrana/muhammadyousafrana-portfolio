# Docs Index

Reference documentation for the AI portfolio template. These are living docs: update them when the
things they describe change.

## Start here

- **Personalize + deploy this template:** [`../SETUP.md`](../SETUP.md) (the interactive builder
  guide).
- **Whole-system map:** [architecture.md](architecture.md). Topology (content seam → SPA → Worker →
  AI Gateway, with a Durable Object for rate-limit/idempotency state) and the canonical file for each
  subsystem. Read this first to orient.

## Reference

### sdk-stack.md

Architecture reference for the AI SDK stack (AI SDK v6 + `@ai-sdk/react` over stateless HTTP).
Covers the request flow, validation boundaries, tool patterns, and where transport/security sit.

### ai-model-strategy.md

Current model policy: provider profiles, the Workers AI binding path, and Google native-chat plus
compat structured-output paths.

### structured-output-prompt-guidelines.md

The repo-specific contract for the fit-analysis structured output: which layer (schema, prompt,
runtime validation) owns what, and how the prompt steers without restating the schema.

### contact-outreach-flow.md

Spec for the AI-driven SMS contact handoff: the intended experience, cancellation behavior, what the
owner receives, and what the AI knows (and does not).
