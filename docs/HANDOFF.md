# OCA Automation — Handoff for a new Claude session

Read this first, then `CLAUDE.md`, `README.md`, and the change log at the end of
`docs/DEVELOPMENT_WORKFLOW.md`. Written 2026-10-14, last updated 2026-10-20, so a Claude Code
session on another server can continue without the earlier chat history. Keep replies short and put
the important result first.

## 1. What the project is

**Main objective:** for every CTO model the QA team lists (servers, solutions, storage, Nutanix), build
a valid aaS configuration in OCA without manual work, save it (Start BOM UCID), and generate and
associate its End BOM (End BOM UCID), so the team's tracker of Start/End BOM UCIDs fills itself. A
model that OCA itself cannot build must be reported with OCA's own reason, never hidden.

**Mandatory parts (project lead, 2026-10-15):** Processor, Memory and Support Services. Only error
icons in Processor and Memory block a model; red icons elsewhere are left to OCA. The other component
choices are random unless the Excel names them.

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

- **Two machines.** Code is written on the development machine, which has no OCA access (Node.js 24
  is installed there since 2026-10-15, so typecheck and unit tests run there). It is run on a
  separate run system, which has OCA, Node.js, and Chromium. The run system path seen in logs is
  `D:\KES Doc new\END BOM Oct\OCA-Automation-main\OCA-Automation-main`. That copy is a GitHub zip
  download (no Git), so the log's version line shows the newest source file time, which is the
  commit time in US Pacific time (e.g. commit `d6ed8b2` 2026-10-19 09:26 IST shows as 2026-10-18 20:56).
- **The loop:** the user runs a batch from the dashboard → sends one zip per server family holding
  the copied log (`New Text Document.txt`) and the captures (`<Job ID>/NN-<step>.html` and
  `.frame1.html`) → Claude finds the cause, fixes it generically, runs only the affected unit specs,
  adds a change-log row → the user asks to commit and push, downloads the zip again and re-runs the
  failed models.
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
| 20 | **DL320 Gen12** (P75220-B21 GPU and others): "Must select Min = 1 of Networking (PCIe or OCP)" / "Minimum 1 quantities of Graphics option ..." link six choices and name no products; the flagged SAS Controller already had a selection, so nothing was filled | Group-rule repair (`repairGroupRule`): the rule's own words pick the covered choices by title (PCIe/OCP → Ethernet PCIe, InfiniBand PCIe, OCP Ethernet; Graphics → Graphics) and one random product is added when none of them has a selection |
| 21 | OCA server/load failures: landing stuck on OCA's "Loading..." (S3V83A); Menu tab empty behind "(OCA) has encountered a problem" / `Widget does not exist on current page: extended_overview:menu` (P72176-B21) — components skipped as "not offered", then the dialog blocked the BOM click | Menu must have section headers (`ensureMenuLoaded`); both cases raise `OcaPageLoadError`, retried from Open OCA; failures append OCA's dialog text |
| 22 | Could not tell which code produced a pasted log | Each run logs `[INFO] Code version: commit <hash> <date>` (or newest source file time for zip downloads). Check it first on every log |
| 23 | Excel check (offline, Python mirror of the reader): `Smart Chassis Product = Automatic` became a product named "Automatic" x0; most columns were matched only by exact header text, so `processor qty` or a trailing space silently made a component random | `Automatic` = keep OCA's selection; every column matched ignoring case and spaces (CLI and dashboard upload share `ExcelReader`) |
| 24 | Requirement from the project lead: a failed model or component must not end the run; try other options | Any model failure is retried from the start (`OCA_MODEL_ATTEMPTS`, default 3) except `ModelNotFoundError`; a closed/crashed browser is relaunched; an Excel product that fails is replaced by another option of its section (`Changed:` in Selected Components), else left to OCA; trace/HTML/result-writing failures never stop the batch |
| 25 | Requirements (2026-10-15): Processor, Memory, Support Services mandatory; no automatic retry for now | Missing selection fails the model before Save (`MandatorySelectionError`); `OCA_MODEL_ATTEMPTS` defaults to 1 |
| 26 | Solution models never set Processor/Memory (S3V83A: they belong to the server inside the solution) | After the Solution Wizard, each "<server> #n" configuration from the full navigation is opened and configured like a server, with the mandatory check (`ConfigurationNavigation`) |
| 27 | Results: Start/End BOM UCIDs hard to find; model route only by Yes/No columns | Dashboard UCID columns and a "BOM UCIDs" sheet; `Model Type` input (Server/Solution/Storage) |
| 28 | Every OCA red icon was repaired, so unrelated sections (Storage, Networking) failed models (P75399-B21) | Only Processor and Memory icons are repaired and block Services; others are logged and left |
| 29 | Nutanix models need Customer Account "Nutanix" and the Nutanix search result | `Model Type = Nutanix`; `CustomerAccount` types the account into OCA's dropdown; `__name` inside `evaluate` code is checked by `browser-callbacks.spec.ts` |
| 30 | OCA's quantity menu measures 0x0, so options were never read; memory menus skip 1 (0/8/16...) | `QuantityHandler.menuNear` reads the menu nearest the clicked row from the DOM; the smallest offered quantity is used |
| 31 | A DIMM Blank Kit counted as memory | Blank kits never count as a selection |
| 32 | OCA stuck on its "Loading..." screen after sign-in | OCA is reloaded once before failing |
| 33 | Max/requires rules: "Max=1 8SFF cable kit is allowed", "NS204i-u Cbl kit requires selection of NS204i-u Ht Plg Boot Opt Dev" | `repairMaxRule` removes the extra; `repairRequiresRule` matches OCA's abbreviations (`phraseScore`); a repair that newly flags Processor/Memory is undone |
| 34 | Smart Chassis kits "supported only with 6XX1P processor series" while OCA's processor was another series (P75217-B21, P75728-B21) | `repairRequiredKindRule`: the processor is swapped for one of that series (X = digit) at the same quantity |
| 35 | "Supports only PC5-4800B Memory" with DDR5-5600 (P55438-B21); "If Processor more than 240W ... Performance heat sink" with the heat sink unavailable (P81948-B21) | Same repair: memory swapped to DDR5-4800; processor swapped for one within the wattage |
| 36 | Models with no Processor section (DL110 Gen12 P86628-B21, Cohesity/Veeam S-models) failed the mandatory check | Logged as part of the base server and passed |
| 37 | Heat sink quantity rules: "Quantity of Processor and Quantity of Heatsink must match / must be equal" | `repairMatchRule` removes the extra product or raises the lone smaller side |
| 38 | OCA's own base held conflicting products: "Mixing of Standard and Performance Heatsink is NOT allowed", "Supported with 8SFF CTO Model Only", "If A is selected, then B cannot be selected" (P53934-B21) | `repairConflictRule` (2026-10-20): each rule blames the products its links name; the most-blamed one is removed when its choice keeps another product; runs before the match repair |
| 39 | Rules on Processor/Memory asking for another product: "then 7 Qty of Standard Fan Kit must be selected" (P54960-B21), "then High Performance Fan Kit must be selected" (P55432-B21) | `repairRequiresRule` also reads "then [N Qty of] X must be selected" and adds or raises that product (2026-10-20) |
| 40 | More quantity wordings: "then 2 Processor must be selected" over several choices (P67161-B21), "Minimum 2 Processor must be selected", "Minimum 2 Heat sink is required", "Total memory capacity must total 256GB or higher" (P52536-B21) | Read by `quantityRule` (2026-10-20); an empty choice with "Minimum N ... is required" is filled |
| 41 | BOM tab: OCA's problem dialog "Widget does not exist on current page: extended_overview:bom:bom_tab" | The dialog is closed and BOM opened once more |
| 42 | Save: the header still read "UCID TempUCID" and was taken as saved (P73282-B21); on the rerun OCA said "You have no permission to edit the configuration" (P54205-B21) | Only a numeric UCID counts; Save runs once more; the permission Warning is answered with Save As New Configuration |
| 43 | Services tab did not open (OCA recalculating, or its problem dialog open: S4R64A) | Problem dialogs are closed and the tab clicked again, up to 3 times |
| 44 | OCA disables Auto-generate End BOM ("Currently not supported for auto generation. Use manual") for Cohesity/Veeam-type S-models | Reported at once: configuration saved, End BOM must be made manually (open question to the user whether to automate the manual End BOM) |
| 45 | Solution model's server ("DL385 Gen11 #1") not found by the wizard name | Matched by part number in OCA's navigation tree; return to the solution by breadcrumb, else the tree |

## 5. Manual QA workflow (from the team's training video, 2026-10-14)

A 28-minute Teams recording: a GCPQ QA test engineer walks the project lead through OCA on ITG4 in
aaS mode. The audio is mostly Tamil; the points below combine the screen and the speech. These are
the checks the automation should eventually do.

**Flow:** sign in → aaS → search model → Customize → configure (Menu, or Solution Wizard) → Services
(experience level, term, data privacy) → BOM tab → Billing Tier Setup (check compute units, servers,
cores) → Save → End BOM Setup: Auto-generate → set **Growth options** → Associate End BOM → Summary tab
shows the End BOM UCID → record Start/End BOM UCIDs in the team's Excel tracker (columns: Solution
type, Platform, Base models, Start BOM UCID, End BOM UCID, Comments).

Model types demonstrated: single server (DL360 Gen12), Solution Wizard (HPE GreenLake for Private
Cloud Business Edition with Alletra Storage MP, with a DL360 Gen12 inside), and **Synergy** (P51174-B21:
Synergy 3 Frame Group → Master / Satellite frames → Synergy 480 Gen12 compute modules, each level
opened through OCA's configuration dropdown). The tracker also lists ML350 Gen12 and Alletra dHCI
(R0Q10A).

**Checks the presenter explains:**
1. **Growth factor:** End State Growth Factor is entered as a count (`#`, e.g. 4) or a percentage
   (`%`, e.g. 300, 800). End BOM = Start BOM × factor: 3 servers → 12, 288 cores → 1152, compute units
   654 → 2616; 800% gives 8 × 3 = 24. Close and reopen End BOM Setup: the values must be kept.
2. **Compute unit = memory GB × 85% per server**, rounded: 512 GB → 435, 256 GB → 218 (× 3 servers =
   654). Verified against the screenshots.
3. **End BOM UCID appears on the Summary tab** (End BOM Type = Automatic, Start BOM Configuration = Yes).
4. **Changing Services updates the End BOM** (term and experience level shown in End BOM Setup).
5. **Negative test:** after editing a configuration with an End BOM associated, Save must be blocked
   with an error message; after "Dissociate End BOM", Save is allowed.
6. **Other regions:** one run used country Saudi Arabia instead of United States.
7. **Synergy is important:** identical compute modules in different frames combine into one billing
   tier; changing one module (e.g. memory 8 × 64 GB, a different network or Fibre Channel card) must
   split it into its own billing tier.

**Gaps (not automated yet):** growth factor (left at OCA's default), End BOM × factor check, compute
unit check, Summary-tab End BOM check, Save-blocked negative test, region choice, Synergy multi-level
configuration. Selectors for these need captured HTML first (CLAUDE.md): the Growth options table of
End BOM Setup from two models; for Synergy, the configuration dropdown and a compute-module Menu page.

## 6. Current state (2026-10-20)

- `main` holds the fixes of 2026-10-20 (rows 38-40, 42-43 above) together with this document.
  Before that, `d6ed8b2` (2026-10-19) and `eb234d6` (2026-10-18).
- Run results so far, by family (each family is one batch of 4-14 models):
  - Confirmed working end to end on OCA: DL360/DL320/DL340/DL380 Gen12 servers, DL580 Gen12
    (P75399-B21), S3V83A (dHCI solution with its server), S2U63A (Data Solutions),
    and the plain CTO models of DL325/DL345/DL360/DL365/DL380 Gen11.
  - Run of 2026-10-19 (Gen11, on `d6ed8b2`): 21 of 42 models built an End BOM. The fixes of
    2026-10-20 target P53934-B21, P67161-B21, P54960-B21, P54961-B21, P55432-B21, P52536-B21,
    P54205-B21 and S4R64A; not yet re-run.
- Cannot be fixed in the automation (report to the user, not code):
  - No aaS search result: P61268-B21, the DL380a model, P42534-B21 (maybe a typo for P52534-B21).
  - Auto-generate End BOM disabled by OCA ("Use manual"): S2G16A, S2G18A, S6X65A, S3T65A, S3T66A,
    S3T67A, S3N84A, S4R63A. The configuration is saved; the End BOM must be made by hand.
  - S3N87AAE: every memory product is supply-restricted (red "CS"); processor is a radio (qty 1)
    while OCA wants 2.
  - Unclear, need more information: S0V50A and S0V51A (solution "S" models) keep a Processor error
    while a processor is selected; P54208-B21 keeps "If Processor below 240W ... Standard Heat Sink"
    flagged with the Standard heat sink selected.
  - S4R65A: DNS error on the run machine (network).

## 7. To do next

0. Every log starts with `[INFO] Code version:`. Compare it with `git log -1` (remember the Pacific
   time shift for zip downloads) before diagnosing; ask for a re-run if it is older.
1. Ask the user to download the zip again and re-run the failed models listed in section 6.
2. Open questions to the user (no answer yet):
   - Should the automation build a **manual End BOM** for models whose Auto-generate is disabled,
     or only report them?
   - Random picks: prefer OCA's "HPE recommended" products first?
   - Storage Billing Tier "Written Usable TiB": the value entered is a placeholder 1
     (`OCA_MANUAL_BILLING_CAPACITY`); what should it be?
3. Make the **Solution Wizard** and **Storage** flows generic; they still use fixed choice ids.
   This needs captures from at least two models of each.
4. Close the gaps in section 5, in this order (agreed with the user 2026-10-15): growth factor
   (Excel column, e.g. `4` or `300%`) and End BOM = Start BOM × factor check; compute unit = memory
   GB × 85% check; Summary-tab End BOM UCID check; then Synergy multi-level configuration. Ask for the
   captured HTML before writing selectors.
5. Update the "Run result" column in the change log as runs are confirmed.

## 8. Commands (run system)

```text
npm run typecheck
npm run test:unit
npm run oca -- --input ./input/models.xlsx --output ./output --job-id <id> --headed --trace
npm run ui        # dashboard at http://localhost:4173
```

Useful environment variables: `OCA_BASE_URL`, `OCA_AUTH_WAIT_MS`, `OCA_MAX_RANDOM_CPU_WATTS`
(default 270), `OCA_MODEL_ATTEMPTS` (default 1 = no automatic retry, since 2026-10-15; old name `OCA_RULE_CONFLICT_ATTEMPTS`), `OCA_MANUAL_BILLING_CAPACITY` (default 1; storage Billing Tier "Written Usable TiB"), `OCA_UI_PORT`.
