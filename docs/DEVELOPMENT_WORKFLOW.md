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

## Automatic HTML capture

The runner saves the page HTML so selectors can be written and failures diagnosed on the
development system without OCA access.

- **On failure (always):** the page as it was when the job failed, named `NN-FAILED-<step>.html`.
- **Every step (optional):** tick **Save page HTML at every step** in the dashboard, or pass
  `--capture-html` on the command line. One file is saved after each engine step.

Files are written to `<output>/html/<Job ID>/`. For dashboard runs that is
`.oca-ui\runs\<run id>\output\html\`; the Activity log prints each path on an `[HTML]` line.
Iframes are saved beside the page as `NN-<step>.frameN.html`.

The saved HTML is not a plain "Save page as": it records typed values, checked and selected
state, and marks every element that was not rendered with `data-oca-hidden="true"` (its
descendants are hidden too). Script bodies are removed and password values masked.

**Sharing captures:** zip the `html` folder and copy it to the development system under
`D:\Projects\Malathi Project\captures\<date>\`, outside this repository. Captures contain customer
configuration data and can contain session-related hidden fields, so never commit them to Git
(`captures/`, `output/`, and `.oca-ui/` are ignored). Delete old captures when no longer needed.

## Sharing HTML for a new step

Selectors are written only from HTML that has been shared. They are never guessed. A step
capture (above) is usually enough; for an element that appears only mid-step, such as an open
dropdown, copy it manually:

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
| 2026-10-08 | Code review fixes for the dashboard flow: runner started with `node --import tsx` instead of `npm.cmd` (Windows EINVAL); Stop uses IPC instead of SIGINT; one active run at a time; models without components keep random selections in mixed runs; Storage flag and component descriptions kept; previous job tabs closed; sign-in status and skipped-job progress fixed. | `src/app/ui-server.ts`, `src/app/run-workbook.ts` (new), `src/main.ts`, `src/automation/oca-engine.ts`, `src/excel/excel-reader.ts`, `src/ui/public/index.html`, `src/ui/public/app.js`, `tests/unit/run-workbook.spec.ts` (new), `README.md` | Pending: typecheck, unit tests, one-model UI run |
| 2026-10-08 | Automatic HTML capture: always on failure, optionally after every step (`--capture-html` / dashboard checkbox), with live control state and hidden-element marks. | `src/reporting/html-capture.ts` (new), `src/main.ts`, `src/app/cli.ts`, `src/automation/oca-engine.ts`, `src/app/ui-server.ts`, `src/ui/public/index.html`, `src/ui/public/app.js`, `tests/unit/html-capture.spec.ts` (new), `tests/unit/cli.spec.ts`, `.gitignore` | Pending |
| 2026-10-13 | aaS selection made mandatory again. JOB-001 (P72176-B21) opened in Buy: the engine clicked aaS only if it was visible in a single 1 s check. Now waits for the landing aaS option, clicks it, confirms Buy is no longer selected (3 attempts), falls back to header New Configuration > aaS (`#header_greenlake`, seen in the capture), and fails before the model search otherwise. Logs the landing mode state. | `src/automation/quotation-mode.ts` (new), `src/automation/oca-engine.ts`, `tests/unit/quotation-mode.spec.ts` (new) | Pending |
| 2026-10-13 | JOB-001 run 2: aaS fix confirmed. Failed at required-selection recovery: random 350W CPU (P73834-B21) + Performance heatsink + 30C ambient + 1Gb OCP card triggered OCA's OCP Enablement Kit rule; recovery then collapsed the open Processor section ("0 visible candidates"). Random CPUs now limited to 270W (user decision); open sections are no longer clicked closed; unresolved errors quote OCA's error messages. | `src/automation/component-engine.ts`, `src/automation/configuration-errors.ts`, `tests/unit/processor-rules.spec.ts` (new) | Pending |
| 2026-10-14 | JOB-001 run 3: 270W cap and aaS confirmed; all four components set. Stopped at "Resolve required configuration errors" on eight sections that showed only Warning icons: the error check matched `.dqe-status-icon-14`, which OCA uses for every status icon. Errors are now only `img-alert` icons (plus title/aria "Error"). | `src/automation/configuration-errors.ts`, `src/automation/component-engine.ts`, `tests/unit/configuration-errors.spec.ts` | Pending |
| 2026-10-14 | JOB-003 (P75339-B21): aaS selected, then OCA's search returned "No search results." (jQuery UI status region); the run waited 60 s and reported a locator timeout. Search now fails fast with "OCA returned no search results for <model> in aaS mode". Model availability to be confirmed manually in OCA. | `src/automation/model-search.ts`, `tests/unit/model-search.spec.ts` (new) | Pending |
| 2026-10-14 | JOB-001 (P72176-B21) and JOB-002 (P72297-B21) succeeded end to end; UCIDs look correct, but Start/End BOM capacity columns are misread (e.g. End Allocated Memory = model number). JOB-004 (P83540-B21, DL580 Gen12) has no Smart Chassis section and failed there. Smart Chassis instructions are now skipped when the model has no such section (user decision). Added diagnostic HTML captures (failure and steps mode) when a quantity menu lacks the wanted value and after End BOM generation; the quantity error now lists the visible options. | `src/automation/oca-engine.ts`, `src/automation/component-engine.ts`, `src/automation/end-bom.ts`, `src/components/quantity-handler.ts`, `src/reporting/html-capture.ts`, `tests/unit/job-004-diagnostics.spec.ts` (new) | Pending |
| 2026-10-14 | Generic component engine (user requirement: no hardcoding). Sections are found by visible title and OCA's shared structure (section header → choice title → item rows), verified on DL360 and DL580 Gen12 captures; main choice = choice titled like the section, else first with rows. Any section a model lacks is skipped. Random quantity falls back to the smallest offered quantity (user decision). CPU watt cap configurable (`OCA_MAX_RANDOM_CPU_WATTS`). Removed model-specific handlers (P72221/P74787), server family/generation detection, legacy model/page classes, and recorded legacy tests (user decision). Solution Wizard and Storage flows still use fixed choice ids. | `src/automation/component-engine.ts`, `src/components/quantity-handler.ts`, `src/automation/oca-engine.ts`, `src/automation/model-search.ts`, `src/automation/billing-tier.ts`, `src/excel/excel-validator.ts`, `src/core/excel.ts`, `src/config/env.ts`, `src/main.ts`, unit tests, deleted legacy files | Pending |
| 2026-10-14 | Run on P83540-B21 (DL580 Gen12) used the pre-generic build (15a0eea). Captures showed: (1) the memory quantity menu opens as OCA's `#action_div.popup-menu` and offers 0, 2, 4, 8, 16, 24, 32 (no 1), which the option reader did not recognise; (2) on DL580 "Power Supplies" is a choice inside the section "Power and Cooling", and the old code clicked "Manufacturing Services" (key powerCordsRemoval). Popup-menu options are now read (so the smallest-offered fallback picks 2), and a section is also found through a choice of the wanted title. | `src/components/quantity-handler.ts`, `src/automation/component-engine.ts`, `tests/unit/job-004-diagnostics.spec.ts` | Pending |
| 2026-10-14 | First typecheck/unit run on the run system: 69/70 passed; fixed the two failures (test helper type; HTML capture marked `<option>` hidden). JOB-003 (P83540-B21, DL580) on c2f03d4: memory menus offered only 0/4/8/16/32/48 (fixed by c642aff, not yet downloaded). Processor showed errors after selection: OCA's rule "(User Selection: Min 2 // Max 4) Odd quantities of processor selection is not allowed" and the random quantity was 1. The engine now reads OCA's per-choice quantity rules (li.message_li with a.err-lnk naming only that choice) and moves the quantity into range, for new and existing selections. Heatsink not auto-selected at quantity 1; expected from OCA once the CPU quantity is valid — to confirm. | `src/automation/component-engine.ts`, `src/reporting/html-capture.ts`, `tests/unit/component-engine.spec.ts`, `tests/unit/processor-rules.spec.ts` | Pending |
| 2026-10-14 | Unit tests 74/74 on 742d45a. JOB-003 (P83540-B21): processor rule fix confirmed (1 → 2), Smart Chassis skipped, PSU found in "Power and Cooling", heatsink handled by OCA. Failed at required-error recovery: OCA required one of the drive cages / boot device it lists in Storage Devices and OS Boot Device; the fallback "first unselected radio row on the page" changed the processor instead, back and forth. Recovery now fills only the flagged section's flagged choices, preferring the products OCA's message names (matched in the choices its a.err-lnk links cover); the page-wide row fallback is removed. Choice-level error icons map to the section header above them. Memory menu still occasionally fails to open on the first DIMM (recovered by the next candidate). | `src/automation/component-engine.ts`, `src/automation/configuration-errors.ts`, `tests/unit/oca-menu-fixture.ts`, `tests/unit/required-repair.spec.ts` (new) | Pending |
| 2026-10-14 | JOB-003 (P83540-B21): drive cage filled from OCA's named list (P80429-B21, 8SFF x1). OCA then required "Qty 1 of 1-port/2-port PCIe/OROC TM controller (MR416i / MR216i / MR408i)", naming products by model, not part number; the fallback picked a random E208e-p controller and a 24SFF cable, leaving the rule unmet. Repair now matches model words (tokens with letters and digits, hyphen parts included) between the rule and product descriptions and picks among the best matches; verified offline against the captured rows (MR4xx controllers, 8SFF x1 cable kits). | `src/automation/component-engine.ts`, `tests/unit/required-repair.spec.ts` | Pending |
