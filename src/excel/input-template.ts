import * as XLSX from 'xlsx';
import { MODEL_TYPES } from '../models/job';
import { selectionTypes } from '../models/component-instruction';

/** Models sheet columns: the fields of the dashboard's Add model dialog. */
export const TEMPLATE_MODEL_COLUMNS = [
  'Job ID', 'Model Number', 'Model Type', 'Model Description', 'Customer Account', 'Country', 'Service Type', 'Server',
  'Integration Rack Part number', 'Solution Name', 'Generate End BOM', 'Enabled',
] as const;

/** Components sheet columns: the dialog's optional component rows. */
export const TEMPLATE_COMPONENT_COLUMNS = [
  'Job ID', 'Section', 'Product Number', 'Quantity', 'Selection Type', 'Configuration Text', 'Sequence',
] as const;

const instructions: Array<[string, string, string]> = [
  ['Models sheet', '', 'One row per model. Only Job ID and Model Number are required.'],
  ['Job ID', 'Required, unique', 'Any text, e.g. JOB-001. No two rows may share it.'],
  ['Model Number', 'Required', 'Exact OCA model, e.g. P75399-B21, S3V83A.'],
  ['Model Type', `${MODEL_TYPES.join(' / ')} or blank`, 'Server: Menu tab. Solution: Solution Wizard. Storage: storage flow (Cloud Connectivity, Controller Nodes or Site Survey, Capacity; e.g. S1F24A). '
    + 'Nutanix: Customer Account set to Nutanix in Advanced Settings, the search result containing "Nutanix" is opened, '
    + 'then the Server route. Arcus EMEA: the Arcus solution (HPE GreenLake for PC3000 with Alletra Storage MP (Block)) '
    + 'in SAUDI ARABIA, built in its Wizard; Model Number is the search word, e.g. Private. Simplivity Wizard: the '
    + 'Wizard card of the model is opened (not its CTO card); Processor and Memory are picked, then every wizard dropdown '
    + 'still asking for a selection, at the minimum quantity its messages state. Alletra 4000 / Alletra 5000: the '
    + '"HPE Alletra Storage Servers" / "HPE Alletra 5000" search result (Model Number is the search word, e.g. 4000 / '
    + 'alletra), built in its wizard: the base model first, then each wizard tab\'s mandatory dropdowns. Blank: detected from OCA.'],
  ['Model Description', 'Optional', 'Text the OCA search result must contain, when the model has several results. '
    + 'Nutanix models use "Nutanix" when blank; Arcus EMEA uses the Arcus solution name.'],
  ['Customer Account', 'Optional', 'Advanced Settings Customer Account, exactly as OCA lists it. Blank: cleared '
    + '(Nutanix models: Nutanix).'],
  ['Country', 'Optional', 'Landing page Country, as OCA lists it (e.g. SAUDI ARABIA) or its code (SA). Blank: UNITED STATES '
    + '(Arcus EMEA: SAUDI ARABIA).'],
  ['Service Type', 'Optional', 'Random (default) or the service experience to select.'],
  ['Server', 'Optional', 'Solution models: the server to pick in the Solution Wizard.'],
  ['Integration Rack Part number', 'Optional', 'Blank: Standalone. Yes: any rack. Or the rack option text.'],
  ['Solution Name', 'Optional', 'Solution models: the solution to pick in the Solution Wizard.'],
  ['Generate End BOM', 'Yes / No', 'Default Yes.'],
  ['Enabled', 'Yes / No', 'Default Yes. No: the row is skipped.'],
  ['Notes', 'Optional', 'Free text for the team; not read by the tool.'],
  ['Components sheet', '', 'Optional. A model with no rows here gets random Processor, Memory, Smart Chassis and '
    + 'Power Supplies. Processor and Memory are always mandatory.'],
  ['Section', 'Required per row', 'OCA Menu section title, e.g. Processor, Memory, Power Supplies.'],
  ['Product Number', 'Optional', 'Product to select, e.g. P74509-B21. Blank with Random: any product.'],
  ['Quantity', 'Optional', 'Number to select.'],
  ['Selection Type', selectionTypes.join(' / '), 'How the product is selected; Random picks any allowed product.'],
  ['Configuration Text', 'Optional', 'Configuration selection: the option text.'],
  ['Sequence', 'Optional', 'Order of the rows within a model (10, 20, 30...).'],
];

/** The input workbook: the models run so far on the Models sheet, an empty Components sheet, and Instructions. */
export function buildInputTemplate(): XLSX.WorkBook {
  // Models already run against OCA, with what the last run showed (Notes is not read by the tool).
  const model = (jobId: string, modelNumber: string, modelType: string, notes: string) =>
    [jobId, modelNumber, modelType, '', '', '', 'Random', '', '', '', 'Yes', 'Yes', notes];
  const models = [
    model('JOB-001', 'P72176-B21', 'Server', 'DL360 Gen12. Passed end to end.'),
    model('JOB-002', 'P72297-B21', 'Server', 'DL360-class. Passed end to end.'),
    model('JOB-003', 'P75219-B21', 'Server', 'DL320 Gen12. Passed end to end.'),
    model('JOB-004', 'P75220-B21', 'Server', 'DL320 Gen12. Passed end to end.'),
    model('JOB-005', 'P75217-B21', 'Server', 'DL320 Gen12. Failed on a boot device rule; repair added, retest.'),
    model('JOB-006', 'P75218-B21', 'Server', 'DL320 Gen12. Failed on an OCP/processor rule; repair added, retest.'),
    model('JOB-007', 'P86628-B21', 'Server', 'DL110 Gen12. Failed on the M.2 rule; fixed, retest.'),
    model('JOB-008', 'P83540-B21', 'Server', 'DL580 Gen12. Failed on Smart Chassis (old build); fixed, retest.'),
    model('JOB-009', 'P75399-B21', 'Server', 'DL580 Gen12 SFF. Failed on non-mandatory red icons; now only Processor/Memory block, retest.'),
    model('JOB-010', 'P72176-B21', 'Nutanix', 'Nutanix DL360 G12. Failed in Customer Account; fixed, retest.'),
    model('JOB-011', 'S3V83A', 'Solution', 'dHCI solution. Wizard and Menu passed; server inside the solution added, retest.'),
    model('JOB-012', 'S2U63A', 'Server', 'DL380 Gen11 Data Solutions. Stopped at Billing Tier; capacity entry added, retest.'),
    // Arcus: HPE GreenLake for PC3000 with Alletra Storage MP (Block), configured in Saudi Arabia (2026-10-20).
    ['JOB-013', 'S3V83A', 'Solution', 'HPE GreenLake for PC3000 with Alletra Storage MP (Block)', '', 'SAUDI ARABIA', 'Random', '', '', '',
      'Yes', 'Yes', 'Arcus dHCI solution in Saudi Arabia (same product as JOB-011). New: Country; retest.'],
    // The same Arcus solution through its preset Model Type, searched by "Private" as recorded (2026-10-21).
    model('JOB-014', 'Private', 'Arcus EMEA', 'Arcus EMEA preset: Saudi Arabia and the Arcus description filled in. New; test.'),
    // SimpliVity models offered as a CTO card and a Wizard card, built in the Wizard (2026-10-21 recordings).
    model('JOB-015', 'S8J33A', 'Simplivity Wizard', 'SimpliVity 380 Gen12 in its Wizard. New; test.'),
    model('JOB-016', 'S2V31A', 'Simplivity Wizard', 'SimpliVity 325 Gen11 in its Wizard. New; test.'),
    // Alletra wizards, searched by a word as recorded (2026-10-22).
    model('JOB-017', '4000', 'Alletra 4000', 'HPE Alletra Storage Servers in their wizard. Passed (2026-10-22).'),
    model('JOB-018', 'alletra', 'Alletra 5000', 'HPE Alletra 5000 array in the Alletra5000Sol Wizard. Passed (2026-10-22).'),
    // HPE GreenLake for File storage (2026-10-28 recording) and a server offering only 400W-600W processors (2026-10-28 run).
    model('JOB-019', 'S1F24A', 'Storage', 'HPE GreenLake for File ("razercrestsol" CTO): Cloud Connectivity, Site Survey, Capacity. New; test.'),
    model('JOB-020', 'P97048-B21', 'Server', 'DL585a Gen13: every processor over 270W; the lowest power is taken. Retest.'),
  ];
  // No component rows: every model gets random Processor, Memory, Smart Chassis and Power Supplies.
  const components: unknown[][] = [];
  const workbook = XLSX.utils.book_new();
  const sheet = (rows: unknown[][], widths: number[]) => {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = widths.map((wch) => ({ wch }));
    return worksheet;
  };
  XLSX.utils.book_append_sheet(workbook, sheet([[...TEMPLATE_MODEL_COLUMNS, 'Notes'], ...models],
    [10, 14, 12, 26, 20, 16, 13, 18, 26, 22, 16, 9, 90]), 'Models');
  XLSX.utils.book_append_sheet(workbook, sheet([[...TEMPLATE_COMPONENT_COLUMNS], ...components],
    [10, 18, 16, 9, 15, 22, 9]), 'Components');
  XLSX.utils.book_append_sheet(workbook, sheet([['Column', 'Values', 'Meaning'], ...instructions], [28, 34, 110]), 'Instructions');
  return workbook;
}
