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
- `src/excel` — input parsing/validation and results writing
- `src/core` — shared waits, interactions, page shim, BOM UCID parsing
- `tests/unit` — offline unit tests; `tests/unit/oca-menu-fixture.ts` builds OCA menu markup

## Generic by design

The user requires the automation to work for every model with nothing hardcoded: no model numbers,
part numbers, server families, or model-specific element ids in `src`. Find OCA elements by their
visible titles and by OCA's shared structure (section header → choice title → item rows), as
`ComponentEngine` does. A section a model does not offer is skipped. Build every new selector from
captured HTML of at least two models. Known exceptions still to generalise: the Solution Wizard and
Storage flows use fixed choice ids.

## Commands (run system only)

```text
npm run typecheck
npm run test:unit
npm run oca -- --input ./input/models.xlsx --output ./output --job-id <id> --headed --trace
```
