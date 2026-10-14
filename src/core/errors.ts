/** True when Playwright reports that the page, context, or browser is gone (closed or crashed). */
export function isBrowserClosedError(error: unknown): boolean {
  return /Target page, context or browser has been closed|Target closed|browser has disconnected|Browser closed|Page crashed/i
    .test(String(error));
}

/**
 * Processor, Memory, or Support Services is not selected. These are mandatory (project lead): the
 * configuration must not be saved and no End BOM generated without them.
 */
export class MandatorySelectionError extends Error {
  constructor(message: string) { super(message); this.name = 'MandatorySelectionError'; }
}

/** OCA has no such model in aaS mode; starting the model again cannot help. */
export class ModelNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'ModelNotFoundError'; }
}
