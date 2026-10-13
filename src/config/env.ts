export const env = {
  baseUrl: process.env.OCA_BASE_URL ?? 'https://ngc-itg-oca-internal.its.hpecorp.net/ocaPreForkM1/OCAInternalLogin',
  authWaitMs: Number(process.env.OCA_AUTH_WAIT_MS ?? 40_000),
  actionDelayMs: Number(process.env.OCA_ACTION_DELAY_MS ?? 2_000),
  expectedPageText: process.env.OCA_EXPECTED_PAGE_TEXT ?? 'OCA Config 2',
};
