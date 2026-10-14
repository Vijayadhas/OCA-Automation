# OCA Automation — Handoff for a new Claude session

Read this first, then `CLAUDE.md`, `README.md`, and the change log at the end of
`docs/DEVELOPMENT_WORKFLOW.md`. Written 2026-10-14 so a Claude Code session on another server can
continue without the earlier chat history. The user will be working from a phone for the next few
days, so keep replies short and put the important result first.

## 1. What the project is

Excel-driven Playwright (TypeScript) automation for HPE One Config Advanced (OCA). For each enabled
row in an Excel workbook it:

1. Opens OCA in a persistent Chromium profile (the user signs in manually once).
2. Selects **aaS** mode on the landing page (mandatory).
3. Searches the exact CTO model number and clicks **Customize** (Integration Rack: blank →
   Standard/Standalone).
4. Turns off "HPE Recommended only", then sets components in order: Processor, Memory, Smart
   Chassis, Power Supplies. Each is either the Excel value or a **random** pick.
5. Repairs any section OCA still flags with an error (required selections and quantity rules).
6. Picks Support Services, opens the BOM tab and Billing Tier Setup, saves, and captures the UCID.
7. Optionally generates and associates the End BOM and reads Start/End BOM capacity.
8. Writes each result straight away to `<input>-results.xlsx`.

Entry points: `npm run oca` (CLI, `src/main.ts`) and `npm run ui` (web dashboard on port 4173,
`src/app/ui-server.ts`). On Windows the user runs `Run-OCA.cmd` / `Run-OCA-UI.cmd`.

Repository: https://github.com/Vijayadhas/OCA-Automation (branch `main`).

## 2. How the user works (important)

- **Two machines.** Code is written on the development machine, which has no OCA access and no
  Node.js. It is run on a separate run system, which has OCA, Node.js, and Chromium. The run system
  path seen in logs is `D:\KES Doc new\END BOM Oct\OCA-Automation-main\OCA-Automation-main`.
  If this new server has Node.js, `npm run typecheck` and `npm run test:unit` can be run here. OCA
  itself is still only reachable from the run system.
- **The loop:** the user runs a job → pastes the terminal log and/or sends a zip of the failure
  HTML captures (`output/html/<Job ID>/NN-FAILED-<step>.html`) → Claude finds the cause, fixes it,
  adds a unit test, adds a change-log row → the user pulls and runs again.
- **Selectors only from captured HTML.** Never invent selectors or page structure; ask for HTML if
  it is missing. Failure captures are written automatically. `--capture-html` (or the dashboard
  checkbox) saves one after every step.
- **Generic by design.** Nothing model-specific in `src`: no model numbers, part numbers, server
  families, or model-specific element ids. Find elements by visible titles and OCA's shared
  structure (section header → choice title → item rows). A section a model doesn't offer is skipped.
- **After every change:** list every added or modified file (the user may copy files by hand), and
  add a row to the change log in `docs/DEVELOPMENT_WORKFLOW.md`.
- **Git:** the user has asked for commits, pushes to `main`, and branch deletions explicitly. Commit
  or push only when asked.
- Never commit captures, `output/`, `.oca-ui/`, `.oca-profile/`, or `.oca-local.json`. Captures
  contain customer configuration data.

## 3. OCA page structure the engine relies on

Verified on DL360, DL580, and DL110 Gen12 captures:

- Section: `#section_header_<key>` holding the visible title (Processor, Memory, Power Supplies, ...).
- Choice: `#choice_header_<choiceId>`, title in `#choice_title_<choiceId>`; `<choiceId>` starts
  with `<key>_`.
- Rows: `tr.item_tr[data-elementid="<choiceId>"]`, id `item_tr_<PART>_<choiceId>`; the part number
  is in `span._pid`.
- Error state: `#choice_status_icon_<choiceId>` with class `img-alert`. Only `img-alert` means an
  error; `.dqe-status-icon-14` is used for every status icon, including warnings.
- Rules: `#choice_header_<id> li.message_li .error_message`; the `a.err-lnk` ids inside list the
  choices the rule covers.
- The quantity control can be a `<select>` or OCA's `#action_div.popup-menu`. Some menus skip 1
  (e.g. 0, 2, 4, 8 ...).
- On some models a section is a *choice* inside another section (DL580: "Power Supplies" inside
  "Power and Cooling").

Main code: `src/automation/component-engine.ts` (`ComponentEngine`),
`src/automation/configuration-errors.ts` (error detection and recovery loop),
`src/automation/oca-engine.ts` (job flow), `src/components/quantity-handler.ts`.

## 4. Issues we hit and how they were solved

| # | Problem | Fix |
|---|---|---|
| 1 | The dashboard runner failed to start on Windows (`npm.cmd` EINVAL); Stop didn't work | Start with `node --import tsx`; Stop over IPC; one active run at a time |
| 2 | Couldn't see the page when a job failed | Automatic HTML capture on failure (and optionally every step), with live control state and hidden elements marked |
| 3 | The job opened in **Buy** mode instead of aaS | aaS is mandatory: wait, click, confirm Buy is unselected (3 attempts), fall back to header New Configuration → aaS, otherwise fail before the search |
| 4 | A random 350W CPU triggered OCA's OCP Enablement Kit rule; recovery collapsed open sections | Random CPUs capped at 270W (`OCA_MAX_RANDOM_CPU_WATTS`); open sections are never clicked closed |
| 5 | Warning icons were treated as errors | Errors = `img-alert` icons only |
| 6 | A model with no search results waited 60 s and timed out | Fail fast: "OCA returned no search results for <model> in aaS mode" (P75339-B21; check availability by hand) |
| 7 | DL580 Gen12 (P83540-B21) has no Smart Chassis section | A section the model doesn't offer is skipped and logged |
| 8 | Code was full of model-specific handling | Rewritten generic: sections found by title; main choice = the choice titled like the section, else the first with rows; legacy model-specific code removed |
| 9 | Memory quantity menu (popup-menu) not read; values offered 0/2/4/8... | Popup-menu options are read; if the random quantity isn't offered, the smallest offered is used |
| 10 | OCA quantity rules ("User Selection: Min 2 // Max 4", "Odd quantities ... not allowed") | `quantityRule` reads rules covering only that choice and moves the quantity into range (`fitQuantity`) |
| 11 | Required-error recovery changed the processor back and forth (page-wide "any row" fallback) | Recovery only fills the flagged section's flagged choices, preferring the products OCA's message names; the page-wide fallback was removed |
| 12 | OCA names products by model words ("MR416i / MR216i / MR408i"), not part numbers | Match model words between the rule text and product descriptions; pick among the best matches |
| 13 | A part number matched inside a longer word (NS204 in "NS204i-u") | Part numbers match only as whole words |
| 14 | The user wanted to see what was being selected | Each item is scrolled to the centre and outlined orange for 1.5 s before it is selected (`revealForViewer`) |
| 15 | "...the drive cage quantity must be Qty 2" | Parsed as an exact quantity rule |
| 16 | Start/End BOM capacity columns misread (hidden columns shifted the values) | Read only visible headers and cells of `#startbom` / `#endbom_billingtier_table` |
| 17 | A random combination triggered a rule recovery can't meet (Smart Chassis with NS204i-u needs a Performance heatsink) | User decision: retry the model from the search with fresh random picks, up to `OCA_RULE_CONFLICT_ATTEMPTS` (default 3). Only `ConfigurationRuleError` is retried |
| 18 | **P86628-B21 (DL110 Gen12):** "Minimum 2 and Maximum 2 of M.2 SSD Drive must be selected" not recognised; the M.2 drive stayed at quantity 1, so all 3 attempts failed | `quantityRule` also reads "Minimum N and Maximum M of ... must be selected" (commit `350e66c`) |
| 19 | On retries the step label showed the previous attempt's random part ("Component 20: P69730-F21") | `processJob` works on per-attempt copies of the Excel instructions (commit `350e66c`) |

## 5. Current state (2026-10-14)

- `main` is at `350e66c` and pushed.
- Models seen so far: P72176-B21 and P72297-B21 (DL360-class) succeeded end to end before the later
  changes. P83540-B21 (DL580 Gen12) progressed through several repairs. P86628-B21 (DL110 Gen12)
  is waiting for a re-run with the M.2 fix.
- The last known unit test run was 78/79 on `7444b8c`; the failure was fixed. **The typecheck and
  unit tests haven't been run since**, so commits `31efdbd`, `390d459`, `143f9f9`, and `350e66c`
  are untested.
- Most change-log rows still say "Pending" for the run result.

## 6. To do next

1. On the run system: `git pull`, `npm run typecheck`, `npm run test:unit`. Fix anything that
   fails first.
2. Re-run **P86628-B21**. Expect M.2 to go 1 → 2 (`OCA allows 2-2; changing quantity 1 to 2`), and
   on any retry the step lines to show section names. On attempt 2 OCA also listed power rules for
   the 1000W DC PSU (P79329-B21): "DC Power Lug Kit OR DC Power Cord must be selected" and
   "Qty of Power Cords selected must match Qty of Power Supply selected". These may need repair
   support if they come back.
3. Re-run **P72176-B21** (Smart Chassis / heatsink conflict, now covered by the retry) and
   **P83540-B21**. Confirm End BOM capacity values are correct.
4. Look into what is still slow or noisy in the logs:
   - The first aaS click on the landing page often doesn't take; selecting aaS took 1m 13s.
   - "Blocking overlay did not become hidden within 60 seconds" is logged after turning off HPE
     Recommended on every attempt.
   - The memory menu sometimes fails to open on the first DIMM (the next candidate recovers).
5. Make the **Solution Wizard** and **Storage** flows generic; they still use fixed choice ids.
   This needs captures from at least two models of each.
6. Update the "Run result" column in the change log as runs are confirmed.

## 7. Commands (run system)

```text
npm run typecheck
npm run test:unit
npm run oca -- --input ./input/models.xlsx --output ./output --job-id <id> --headed --trace
npm run ui        # dashboard at http://localhost:4173
```

Useful environment variables: `OCA_BASE_URL`, `OCA_AUTH_WAIT_MS`, `OCA_MAX_RANDOM_CPU_WATTS`
(default 270), `OCA_RULE_CONFLICT_ATTEMPTS` (default 3), `OCA_UI_PORT`.
