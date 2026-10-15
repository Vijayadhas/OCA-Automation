import * as XLSX from 'xlsx';
import { MODEL_TYPES } from '../models/job';
import { selectionTypes } from '../models/component-instruction';

/** Models sheet columns: the fields of the dashboard's Add model dialog. */
export const TEMPLATE_MODEL_COLUMNS = [
  'Job ID', 'Model Number', 'Model Type', 'Model Description', 'Customer Account', 'Service Type', 'Server',
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
  ['Model Type', `${MODEL_TYPES.join(' / ')} or blank`, 'Server: Menu tab. Solution: Solution Wizard. Storage: storage flow. '
    + 'Nutanix: Customer Account set to Nutanix in Advanced Settings, the search result containing "Nutanix" is opened, '
    + 'then the Server route. Blank: detected from OCA.'],
  ['Model Description', 'Optional', 'Text the OCA search result must contain, when the model has several results. '
    + 'Nutanix models use "Nutanix" when blank.'],
  ['Customer Account', 'Optional', 'Advanced Settings Customer Account, exactly as OCA lists it. Blank: cleared '
    + '(Nutanix models: Nutanix).'],
  ['Service Type', 'Optional', 'Random (default) or the service experience to select.'],
  ['Server', 'Optional', 'Solution models: the server to pick in the Solution Wizard.'],
  ['Integration Rack Part number', 'Optional', 'Blank: Standalone. Yes: any rack. Or the rack option text.'],
  ['Solution Name', 'Optional', 'Solution models: the solution to pick in the Solution Wizard.'],
  ['Generate End BOM', 'Yes / No', 'Default Yes.'],
  ['Enabled', 'Yes / No', 'Default Yes. No: the row is skipped.'],
  ['Components sheet', '', 'Optional. A model with no rows here gets random Processor, Memory, Smart Chassis and '
    + 'Power Supplies. Processor and Memory are always mandatory.'],
  ['Section', 'Required per row', 'OCA Menu section title, e.g. Processor, Memory, Power Supplies.'],
  ['Product Number', 'Optional', 'Product to select, e.g. P74509-B21. Blank with Random: any product.'],
  ['Quantity', 'Optional', 'Number to select.'],
  ['Selection Type', selectionTypes.join(' / '), 'How the product is selected; Random picks any allowed product.'],
  ['Configuration Text', 'Optional', 'Configuration selection: the option text.'],
  ['Sequence', 'Optional', 'Order of the rows within a model (10, 20, 30...).'],
];

/** The input workbook to fill in: Models and Components sheets with examples, and an Instructions sheet. */
export function buildInputTemplate(): XLSX.WorkBook {
  const models = [
    ['JOB-001', 'P75399-B21', 'Server', '', '', 'Random', '', '', '', 'Yes', 'Yes'],
    ['JOB-002', 'P72176-B21', 'Nutanix', '', '', 'Random', '', '', '', 'Yes', 'Yes'],
    ['JOB-003', 'S3V83A', 'Solution', '', '', 'Random', '', '', '', 'Yes', 'Yes'],
    ['JOB-004', 'S2U63A', 'Storage', '', '', 'Random', '', '', '', 'Yes', 'Yes'],
  ];
  const components = [
    ['JOB-001', 'Processor', '', '', 'random', '', 10],
    ['JOB-001', 'Memory', '', '', 'random', '', 20],
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = (rows: unknown[][], widths: number[]) => {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = widths.map((wch) => ({ wch }));
    return worksheet;
  };
  XLSX.utils.book_append_sheet(workbook, sheet([[...TEMPLATE_MODEL_COLUMNS], ...models],
    [10, 14, 12, 26, 20, 13, 18, 26, 22, 16, 9]), 'Models');
  XLSX.utils.book_append_sheet(workbook, sheet([[...TEMPLATE_COMPONENT_COLUMNS], ...components],
    [10, 18, 16, 9, 15, 22, 9]), 'Components');
  XLSX.utils.book_append_sheet(workbook, sheet([['Column', 'Values', 'Meaning'], ...instructions], [28, 34, 110]), 'Instructions');
  return workbook;
}
