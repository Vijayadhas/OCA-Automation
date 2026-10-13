/**
 * Builds OCA component-menu markup in the shape captured from live workspaces (DL360 and
 * DL580 Gen12): a section header row, then per choice a title row and item rows whose
 * data-elementid is the choice id. Keys and ids here are arbitrary on purpose: the engine
 * must work from titles and structure, not from known ids.
 */
export interface FixtureRow {
  pid: string;
  description?: string;
  /** Displayed committed quantity. */
  quantity?: number;
  radio?: boolean;
  checked?: boolean;
  unavailable?: boolean;
  /** Quantity options offered by a native select; changing it updates the displayed quantity. */
  select?: number[];
  /** Extra markup inside the quantity cell. */
  quantityExtra?: string;
}

export interface FixtureChoice { id: string; title: string; rows: FixtureRow[] }

export interface FixtureSection {
  key: string;
  title: string;
  choices: FixtureChoice[];
  collapsed?: boolean;
  hidden?: boolean;
  /** Script run when the header is clicked (default: toggles the section body). */
  onHeaderClick?: string;
  headerExtra?: string;
}

const row = (choiceId: string, item: FixtureRow) => {
  const quantity = item.quantity ?? 0;
  const select = item.select
    ? `<select onchange="this.closest('td').querySelector('.item_qty_div').textContent = this.value">${
      item.select.map((value) => `<option${value === quantity ? ' selected' : ''}>${value}</option>`).join('')}</select>`
    : '';
  const radio = item.radio
    ? `<td><input type="radio" name="${choiceId}"${item.checked ? ' checked' : ''}
        onchange="this.closest('tr').querySelector('.item_qty_div').textContent = '1'"></td>`
    : '<td></td>';
  return `<tr class="item_tr${item.checked ? ' selected_item' : ''}${item.unavailable ? ' unavailable' : ''}"
      id="item_tr_${item.pid}_${choiceId}" data-elementid="${choiceId}">
    ${radio}<td class="item_prod"><span class="_pid">${item.pid}</span></td>
    <td class="item_desc">${item.description ?? item.pid}</td>
    <td class="item_qty">${item.quantityExtra ?? ''}<div class="item_qty_div">${quantity}</div>${select}</td></tr>`;
};

export function menuSection(section: FixtureSection): string {
  const bodyId = `body_${section.key}`;
  const toggle = section.onHeaderClick
    ?? `const body = document.getElementById('${bodyId}'); body.style.display = body.style.display === 'none' ? '' : 'none';`;
  return `<table${section.hidden ? ' style="display:none"' : ''}>
    <tr class="section_header" id="section_header_${section.key}" onclick="${toggle}"><td class="section_header">
      <div class="section_header_div">${section.headerExtra ?? ''} ${section.title}
        <div class="section_counter"><div class="counter_min_value_oca">0</div><div class="counter_max_value_oca">2</div></div>
      </div></td></tr>
    <tbody id="${bodyId}"${section.collapsed ? ' style="display:none"' : ''}>
    ${section.choices.map((choice) => `
      <tr class="choice_header" id="choice_header_${choice.id}"><td>
        <span class="choice_title" id="choice_title_${choice.id}">
          ${choice.title}
        </span></td></tr>
      ${choice.rows.map((item) => row(choice.id, item)).join('')}`).join('')}
    </tbody></table>`;
}
