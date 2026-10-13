# OCA Automation Tool

Production-oriented, data-driven Playwright automation for HPE One Config Advanced. The CLI reads
enabled jobs and component instructions from Excel, reuses one authenticated persistent Chromium
session, processes each job independently, and writes every result immediately to a new workbook.

Offline unit tests live under `tests/unit` (`npm run test:unit`).

Development happens on a machine without OCA access and is run on a separate system. See
[`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md) for how to share HTML, report errors,
and track changes.

## Install and verify

```bash
npm install
npm run typecheck
npm run test:unit
```

The unit test command does not connect to OCA. The production OCA workflow is never run by local
verification commands.

## Create a sample input

```bash
npm run sample:excel
```

This creates `input/models.sample.xlsx` with one business-friendly `Models` worksheet. Copy it before
adding real job data if you want to preserve the example.

### Recommended single-sheet columns

`Job ID`, `Model Number`, `Model Description`, `Solution`, `Solution Name`, `Integration Rack Part number`, `Server`,
`Quotation Mode`, `Storage`, `Processor`, `Processor Qty`, `Memory`, `Memory Qty`, `Smart Chassis Product`,
`Smart Chassis Qty`, `Chassis Config`, `Power Supply`,
`Power Qty`, `Service`, `Generate End BOM`, `Enabled`

Use `Default` when OCA should retain its default selection. Use `Automatic` for an automatically
managed Smart Chassis choice. Quotation Mode must be `aaS`. If Job ID is blank, the tool assigns
`ROW-<worksheet-row>`.

Set `Storage` to `Yes` for a standalone storage model. The storage flow selects available Cloud
Connectivity, Controller Node Models, and Capacity choices from OCA and derives quantities from the
controls exposed by the page. A row cannot have both `Solution` and `Storage` set to `Yes`.

Set `Solution` to `Yes` (case-insensitive) for a solution model. `Solutions` is also accepted for
backward compatibility. Those rows are configured in the
Solution Wizard tab; `No` or a blank cell keeps the existing Menu-tab flow. Processor, Memory,
Memory Qty, and Service use their existing Excel values when supplied. Other wizard choices
are selected randomly from the available non-placeholder options.

When the model search dropdown contains several entries for the same model number, set `Model Description`
to text from the required entry. If it is blank, the normal default entry is used; solution rows prefer the
entry labelled `Solution Wizard`. Before Customize, non-solution rows use `Integration Rack Part number` as
follows: blank selects Standard/Standalone, `Yes` selects any available rack part, and an exact part number
(for example `P9K08A`) selects that part. Integration Rack selection is skipped for solution rows.

For a dHCI Solution Wizard, `Server` selects the matching server family/size. Leave it blank to choose an
available server randomly. The dHCI-only flow also selects a solution type, server model, server quantity,
network adapter, switches, and—when Menu is available—controller chassis, nodes, capacity, and DAC cables.

In the simple `Models` worksheet, a supplied processor, memory, Smart Chassis, chassis configuration,
power supply, quantity, or Service value is used as entered. Leave a component blank or enter
`Random` to use automatic random selection. Enter `Default` to retain OCA's existing component
selection. A supplied product with a blank quantity defaults to quantity 1. Random processor and
memory selections use quantity 1 or 2; other random selections use quantity 1. When OCA's quantity
menu does not offer the random quantity, the smallest quantity it offers is used. Random processors
skip CPUs above `OCA_MAX_RANDOM_CPU_WATTS` (default 270). A section the model does not offer, such as
Smart Chassis on a DL580 Gen12, is skipped and logged.
Actual selections are written to `Selected Components` in the results workbook. Use the advanced
`Components` sheet for additional or repeated component instructions.

### Optional advanced Components sheet

For models that need additional or repeated component instructions, add a `Components` worksheet
with these columns:

`Job ID`, `Section`, `Product Number`, `Description`, `Quantity`, `Selection Type`,
`Configuration Text`, `Sequence`

When this worksheet exists, it becomes the component source and the `Models` worksheet only supplies
job-level fields. Supported selection types are `radio`, `quantity`, `checkbox`, `configuration`, `automatic`, and
`default`. Selectors do not belong in Excel. Products are found from the visible section and exact
product number, with optional description disambiguation.

`automatic` verifies OCA's committed quantity without modifying it.

## Run

### Web dashboard

On Windows, double-click `Run-OCA-UI.cmd`. The launcher installs missing dependencies on the first
run, loads the same `.oca-local.json` OCA settings used by the command-line launcher, starts the UI,
and opens the dashboard automatically. Keep its console window open while tests are running; press
`Ctrl+C` to stop the UI server.

On macOS, Linux, or from a terminal:

```bash
npm run ui
```

Open `http://localhost:4173`. The dashboard accepts the existing Excel format or manual model and
component entry, starts the same Playwright automation, shows the current model and batch progress,
and provides live results plus an Excel download. Runs are stored locally under `.oca-ui/runs`.
A manually added model with no components uses random Processor, Memory, Smart Chassis, and Power
Supplies selections, exactly like a blank Models-sheet row. Tick **Storage model** or **Solution
Wizard model** in the model dialog when needed. Only one run can be active at a time because runs
share the browser profile; **Stop after current job** finishes the active model, then closes the browser.
Set `OCA_UI_PORT` to use a different port. Environment variables and the persistent OCA browser
profile work exactly as they do for the command-line runner.

### Windows one-click launcher

After copying or cloning the project, double-click `Run-OCA.cmd`. On the first run it asks for the
environment name, OCA URL, Excel path, results folder, browser profile, and login wait. The settings
are stored in `.oca-local.json`, which is ignored by Git. It also installs npm packages and Chromium
once on that laptop. Later runs open a menu for all enabled rows, one Job ID, failed
jobs, or offline unit tests.

Node.js LTS must be installed. Keep the project anywhere on the laptop; the launcher resolves paths
from its own directory, including paths such as
`D:\KES Doc new\EndBOM\PlaywriteTest-main\PlaywriteTest-main`.

### Command line

```bash
npm run oca -- --input ./input/models.xlsx --output ./output --headed --trace
```

Optional flags:

- `--profile <path>` — persistent Chromium profile (default `./.oca-profile`)
- `--start-row <n>` — start at a Models sheet row, including the header as row 1
- `--job-id <id>` — run one job
- `--retry-failed` — run only jobs previously recorded as Failed or Unsupported
- `--trace` — retain Playwright traces for failed jobs
- `--capture-html` — save page HTML after every step; failed jobs are always saved (see
  `docs/DEVELOPMENT_WORKFLOW.md`)
- `--headless` — available for future unattended environments; headed is the default

Manual authentication is allowed once when the shared browser opens. Configure the environment with:

```text
OCA_BASE_URL
OCA_AUTH_WAIT_MS
OCA_PROFILE_DIR
OCA_ACTION_TIMEOUT_MS
OCA_NAVIGATION_TIMEOUT_MS
OCA_EXPECTED_PAGE_TEXT
```

Do not put credentials in the workbook.

## Results and recovery

The CLI creates `<input-name>-results.xlsx` in the output directory, never overwriting the input.
It contains `Results` and `Summary` sheets. Each job is flushed immediately. Normal runs execute every enabled job again,
including previously successful jobs; `--retry-failed` selects only failed or unsupported prior jobs.

Failure artifacts are stored under `output/screenshots`, `output/html`, `output/traces`, and `output/logs`. SIGINT or
SIGTERM requests a graceful stop after the current job. One failed job does not stop the remaining batch.

## Architecture and migration notes

- `src/app` — CLI argument parsing
- `src/automation` — session, search, generic engine, billing, save, and End BOM flows
- `src/components` — radio, quantity, configuration, and automatic-dependency behavior
- `src/excel` — strict input parsing/validation and incremental output writing
- `src/reporting` — JSONL logs, screenshots, HTML captures, and traces
- `src/models` — job, instruction, source, and result contracts

The engine contains no model numbers or model-specific element ids. OCA renders every model's
component menu the same way: a section header (`#section_header_<key>`) with a visible title, choices
with titles (`#choice_title_<choice>`), and item rows (`tr.item_tr[data-elementid="<choice>"]`). Only
the keys and choice ids differ between models, so the engine finds a section by its title (Processor,
Memory, Smart Chassis, Power Supplies, or any other) and uses its main choice: the choice titled like
the section, otherwise the first choice with rows. See `ComponentEngine` in
`src/automation/component-engine.ts`.

Reference-based sources (UCID, BOM, Smart Template, API, or database) are represented in the typed job
model but intentionally not executed in this Excel-detailed MVP.
