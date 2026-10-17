# AI Coding Guidelines

When using an AI coding assistant on QueryPal:

1. Inspect the current implementation and relevant tests before editing.
2. Make small, reviewable changes and explain unfamiliar TypeScript.
3. Preserve existing behavior unless the task explicitly requires a change.
4. Parameterize SQL values; validate identifiers against database metadata.
5. Keep the default workflow read-only.
6. Do not add arbitrary SQL or write operations without an explicit safety design.
7. Add tests for success paths, malformed input, and failure cases.
8. Run `pnpm typecheck` and `pnpm test`, and report only results actually observed.
9. Avoid unnecessary dependencies and premature abstractions.
