# CLAUDE.md

Excel-driven Playwright (TypeScript) automation for HPE One Config Advanced (OCA). See `README.md`
for features and `docs/DEVELOPMENT_WORKFLOW.md` for the development loop.

## Constraints

- OCA and Node.js are **not available** on this machine. Code cannot be run, typechecked, or tested
  here. The user runs it on a separate system and pastes terminal output back.
- Write selectors only from HTML the user has pasted. Never invent selectors or page structure. If
  the HTML needed for a step is missing, ask for it.
- After each change, list every added or modified file so the user can copy it, and add a row to
  the change log in `docs/DEVELOPMENT_WORKFLOW.md`.
- Review TypeScript changes carefully for type errors, since `tsc` cannot be run here. Keep or
  update the unit tests in `tests/unit` alongside logic changes.

## Layout

- `src/main.ts` — CLI entry (`npm run oca`); `src/app/ui-server.ts` — web dashboard (`npm run ui`)
- `src/automation` — OCA flows: model search, component engine, save, support services, billing
  tier, End BOM, solution wizard, storage
- `src/components` — radio, quantity, configuration, automatic-dependency handlers
- `src/exceptions` — model-specific handlers registered in `exception-registry.ts`; do not add
  model-number switches to the generic engine
- `src/excel` — input parsing/validation and results writing
- `src/core`, `src/pages` — shared waits, interactions, and page helpers
- `tests/unit` — offline unit tests; `tests/*.spec.ts` and `old Working test classes/` are legacy
  live-OCA recordings kept for reference

## Commands (run system only)

```text
npm run typecheck
npm run test:unit
npm run oca -- --input ./input/models.xlsx --output ./output --job-id <id> --headed --trace
```
