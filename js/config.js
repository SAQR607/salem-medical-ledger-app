// Public runtime configuration - served to every visitor of the site.
// NOTE: the token below can only touch the private data repository, and every
// ledger/report file in it is AES-256-GCM encrypted per user, so holding the
// token does NOT expose financial data. Rotate it from GitHub -> Settings ->
// Developer settings -> Tokens if it ever leaks, and scope it to the
// salem-medical-ledger repo only.
var LEDGER_CONFIG = {
  OWNER: "SAQR607",
  DATA_REPO: "salem-medical-ledger",
  BRANCH: "main",
  TOKEN: "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"
};
if (typeof module !== "undefined" && module.exports) module.exports = LEDGER_CONFIG;
