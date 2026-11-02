import wizardRuleData from '../config/wizard-rules.json';

/**
 * OCA product rules for Solution Wizard dropdowns, kept as data (src/config/wizard-rules.json) so the code
 * names no products. A random wizard pick takes them into account: an HPE Alletra 5000 5010H array only
 * takes HDD Capacity S0U34A, Bank B Cache depends on Bank A, and so on. A wizard none of the rules name
 * is filled as before.
 */
export interface WizardRule {
  /** Label of the dropdown the rule limits (regular expression, any case). */
  field: string;
  /** Applies only while another dropdown's pick is one of these products; always when absent. */
  when?: { field: string; products: string[] };
  /** Only these products may be picked. */
  only?: string[];
  /** These products may not be picked. */
  exclude?: string[];
  /** One of these is picked when offered. */
  prefer?: string[];
  message: string;
}

export interface WizardRuleSet { name: string; source: string; rules: WizardRule[] }

export const WIZARD_RULE_SETS: WizardRuleSet[] = (wizardRuleData as { ruleSets: WizardRuleSet[] }).ruleSets;

/** The part number an option starts with: "(R4U33A) HPE Alletra 5010" -> "R4U33A"; "" when it names none. */
export function productOf(text: string): string {
  return /^\s*\(([A-Z0-9]{4,10}(?:-[A-Z0-9]{3})?)\)/i.exec(text)?.[1]?.toUpperCase() ?? '';
}

/**
 * Narrows a dropdown's candidate options by the rules for its label, given the picks already made in the
 * wizard (label and option text). A rule that would leave nothing to pick is skipped and reported, so the
 * wizard is still filled and OCA's own message explains the conflict.
 */
export function applyWizardRules<T extends { text: string }>(
  label: string, candidates: T[], picks: Array<{ label: string; text: string }>, sets: WizardRuleSet[] = WIZARD_RULE_SETS,
): { candidates: T[]; applied: string[]; skipped: string[] } {
  const test = (pattern: string, text: string) => new RegExp(pattern, 'i').test(text.trim());
  const applied: string[] = [];
  const skipped: string[] = [];
  let remaining = candidates;
  for (const set of sets) {
    for (const rule of set.rules) {
      if (!label || !test(rule.field, label)) continue;
      if (rule.when) {
        const when = rule.when;
        const holds = picks.some((pick) => test(when.field, pick.label) && when.products.includes(productOf(pick.text)));
        if (!holds) continue;
      }
      let next = remaining;
      if (rule.only) next = next.filter((option) => rule.only!.includes(productOf(option.text)));
      if (rule.exclude) next = next.filter((option) => !rule.exclude!.includes(productOf(option.text)));
      if (rule.prefer) {
        const preferred = next.filter((option) => rule.prefer!.includes(productOf(option.text)));
        if (preferred.length) next = preferred;
      }
      if (!next.length) { skipped.push(`${set.name}: ${rule.message}`); continue; }
      if (next.length !== remaining.length) applied.push(`${set.name}: ${rule.message}`);
      remaining = next;
    }
  }
  return { candidates: remaining, applied, skipped };
}
