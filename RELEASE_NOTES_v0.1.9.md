## What's new
- `monid wallet promo-codes list` / `monid wallet promo-codes redeem -c <code>` (#25)
- `monid runs get -o <file>` saves run output; `--json` stays one document, with `outputError` on a failed save (#17)
- `monid runs get <runId>` / `monid runs stop <runId>` accept the ID positionally (#18)
- A run the provider refused is shown as a run (status, provider HTTP status, error body under Output) and exits 1 — on the sync path and after `--wait` alike; no more "Access denied: HTTP 403" with no run ID (#18)
- `--wait` timeouts name the run and how to resume it (`monid runs get -r <id>`); `--json` carries `error.runId` / `error.status` (#23)
- Network failures name the cause; reads retry automatically; paid runs are never retried (#22)
- "0 Markup" replaces the "Verified" badge (#15)

## Fixes
- `monid runs get` no longer crashes on timed-out, failed or blocked runs; blocked runs render budget, wallet-balance and run-cap controls in USD (#24)
- `monid inspect` no longer crashes on price tiers without a `when` gate, e.g. exa /search (#4, thanks @Tomauskasz), on a null price card, or on null input params (#21)
- 401/402 messages link to app.monid.ai (was api.monid.ai, which 404s) (#28)
- No `UV_HANDLE_CLOSING` assertion on Windows after errors; the update check can no longer keep the process alive (#20)
- Update notice kept when `--json` output is a top-level array (#19)

Skill 0.1.9 follows in #26 → #29 → #30.

**Full changelog:** https://github.com/monid-ai/cli/compare/v0.1.8...v0.1.9
