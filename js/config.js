// Public runtime configuration — served to every visitor of the site.
// NOTE: the token below can only touch the private data repository, and every
// ledger/report file in it is AES-256-GCM encrypted per user, so holding the
// token does NOT expose financial data. Rotate it from GitHub → Settings →
// Developer settings → Fine-grained tokens if it ever leaks, and scope it to
// the salem-medical-ledger repo only.
var LEDGER_CONFIG = {
  OWNER: "SAQR607",
  DATA_REPO: "salem-medical-ledger",
  BRANCH: "main",
  TOKEN: "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"
};
if (typeof module !== "undefined" && module.exports) module.exports = LEDGER_CONFIG;
