# OCA Automation — Development Workflow

## Why this workflow exists

The OCA application is reachable only from the run system. The development system has no OCA
access, and no Node.js runtime is installed there, so code is written on one machine and executed
on another. Every change therefore goes through a short hand-off loop.

| Machine | Role |
|---|---|
| Development system | Holds this repository. Code is written and committed here with Claude Code. |
| Run system | Has OCA access, Node.js, and Chromium. Runs the automation and produces errors. |

## The loop

1. **Describe the work** on the development system.
   - New step or flow: paste the HTML of each element involved and list the steps in order.
   - Bug: paste the terminal error (see [Reporting an error](#reporting-an-error)).
2. **Code is written** in the existing modules. Each change lists exactly which files were added or
   modified and is committed to this repository.
3. **Move the code** to the run system: `git pull` there, or copy only the listed files into the
   same paths.
4. **Run** on the run system with one approved Job ID first:
   ```powershell
   npm run typecheck
   npm run test:unit
   npm run oca -- --input .\input\models.xlsx --output .\output --job-id JOB-001 --headed
   ```
   `Run-OCA.cmd` option `2` (one Job ID) is equivalent.
5. **Report back**: paste the result or error on the development system and repeat.

Always run `npm run typecheck` first. A type error is quicker to report and fix than a runtime
failure.

## Sharing HTML for a new step

Selectors are written only from HTML that has been shared. They are never guessed.

1. In Chrome on the run system, right-click the element and choose **Inspect**.
2. In DevTools, right-click the highlighted node and choose **Copy → Copy outerHTML**.
3. Also copy the **parent** container (one or two levels up). Section headings, row labels, and
   table structure are what make a locator stable.
4. For dropdowns, copy the HTML **after** the dropdown is opened, because options are often
   rendered only then.
5. For dialogs and overlays, copy the dialog root and note what triggers it.

Template:

```text
Flow / section: <e.g. Support Services, Save dialog>
Model / Job ID: <e.g. P72176-B21>
Steps:
  1. Click "<label>"
  2. Select "<option>" in "<field>"
  3. Expect "<text or state>"
HTML (step 1):
  <outerHTML>
HTML (step 2):
  <outerHTML>
Notes: <loading spinners, delays, elements that appear only sometimes>
```

## Reporting an error

Paste all of the following when available:

- The **complete** terminal output from the last successful step to the end of the stack trace.
- The Job ID and model number.
- For `Timeout`, `locator resolved to 0 elements`, or `strict mode violation` errors: the
  outerHTML of the target element and its parent as the page looked at the moment of failure.
- The failure screenshot path from `output/screenshots` (and describe what it shows), or the
  matching lines from `output/logs/*.jsonl`.
- Traces (`--trace`) under `output/traces` can be opened on the run system with
  `npx playwright show-trace <file.zip>` when a timeline is needed.

## What can and cannot be verified on the development system

| Check | Development system | Run system |
|---|---|---|
| Code review and reading | Yes | — |
| `npm run typecheck`, `npm run test:unit` | No (no Node.js installed) | Yes |
| Selector correctness against live OCA | No | Yes |

Because of this, the first live run after any change should always be a single Job ID.

## Repository

- This repository ([`Vijayadhas/OCA-Automation`](https://github.com/Vijayadhas/OCA-Automation)) is the working copy maintained from 8 October 2026 onward.
- It was copied, with full Git history, from `PlaywriteTest` at commit `f42ece6`
  (*Add OCA web control center*), together with the uncommitted fixes present at that time.
- Run-system-only files stay out of Git: `.oca-local.json`, `.oca-profile/`, `.oca-ui/`,
  `output/`, `node_modules/`.

## Change log

Record each hand-off cycle here: what changed, which files, and the run result.

| Date | Change | Files | Run result |
|---|---|---|---|
| 2026-10-08 | Repository created from `PlaywriteTest` (f42ece6 + pending fixes: save-flow recovery, storage flow, solution-wizard drive enclosure, End BOM updates, Excel reader/validator updates). Added this workflow guide and `CLAUDE.md`. | — | Pending first run |
