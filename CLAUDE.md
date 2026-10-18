# CLAUDE.md

Guidance for AI coding agents working in this repository.

- **First-time personalization + deploy:** read and follow [`SETUP.md`](SETUP.md). It is the
  agent-executable guide that turns this template into the owner's personalized, deployed portfolio.
- **Repo map, sources of truth, and invariants:** see [`AGENTS.md`](AGENTS.md).
- **Whole-system architecture:** see [`docs/architecture.md`](docs/architecture.md).

Use Bun for everything (`bun install`, `bun run <script>`, `bunx <cli>`); do not use `npm`/`npx`.
After code changes, run the checks documented in [`AGENTS.md`](AGENTS.md#validation)
(`bun run check`, `bun run test`, `bun run build`).
