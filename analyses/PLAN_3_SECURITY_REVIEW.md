# Plan 3 security and release checkpoint — 26 October 2026

The maintainer selected **hold CLI publication; proceed with the other packages**. This is a
release boundary, not a waiver of the CLI production audit. No version bump, publication, merge,
deployment or issue closure was performed. Existing development branches and unrelated package edits
are preserved. See [the final review](PLAN_3_FINAL_REVIEW.md) for functional acceptance and the
explicit remaining Pixel performance limit.

Later interaction testing and binding parity corrections are recorded in
[the preview regression verification](PLAN_3_PREVIEW_REGRESSIONS.md). They change no dependencies
and do not remove the CLI publication hold. The installed-core mismatch below describes the start
of the security pass; the later local development link now resolves the core checkout.

## Dependency findings and bounded fixes

| Surface | Result |
| --- | --- |
| Core | Fresh production and all-dependency audits report zero vulnerabilities. |
| React | Production audit reports zero. Two moderate development-tooling findings in Vitest/mocker 4.1.11 are addressed by the compatible 4.1.12 patch; verification is recorded below. |
| Native | Fresh production and all-dependency audits report zero. No temporary exception was exercised by this run. Existing Native/mobile exception policy and its 7 November deadline were not extended or changed. |
| CLI | Body-parser is patched. The selected candidate still has one high Undici entry and one inherited moderate Pi entry; publication remains blocked. |

CLI's maintained lockfile changes only body-parser 2.3.0 → 2.4.0, iconv-lite 0.7.2 → 0.7.3 and
qs 6.16.0 → 6.16.1. Express's existing compatible range admits the patch. The installed-dependency
regression resolves the parser actually used by Express and checks it against the lockfile. It fails
with the old installed parser and passes in the independent corrected tree. Maintained node_modules
was not replaced. Implementation commit: `23326de`.

React's selected lock changes only Vitest and its seven matching @vitest packages to 4.1.12. The
initial npm update probe also proposed unrelated Vite/Rolldown and other patches; those were excluded.
The existing ^4.1.11 range admits the patch, and no manifest range or runtime dependency changed.
Commit `b21bed5` contains only those eight lock entries. Full release checks, all 100 React tests,
formatting/build/package checks and both production/all-dependency audits pass; both audits report
zero vulnerabilities after the patch.

Pi coding-agent 1.0.4 pins Undici 8.10.2 exactly; the registry's current Pi 1.4.0 still has that pin.
Undici 8.12.3 is available, but changing an unrelated root copy does not patch Pi's nested copy.
A scoped root override successfully produced a clean development audit in a disposable probe. It is
not a distributable fix: npm honors overrides only in the root project, so users installing the CLI
would not inherit it. No override is included in the maintained manifest.

Published shrinkwrap was not selected: npm 11 honors it, but current npm 12.2.1 ignores published
shrinkwrap. Bundling was investigated only with a dry run: the CLI archive grows from about 0.32 MB
to 29.5 MB, about 127 MB unpacked, including platform-specific packages. That requires an explicit
packaging and portability review; it is not included. No bundling, fork or new security exception
was introduced. Wait for an upstream compatible Pi version with a patched pin, then verify the
actual installed CLI dependency graph and rerun all release gates before publication.

Primary references:

- [Body-parser 2.4.0 security release](https://github.com/expressjs/body-parser/releases/tag/v2.4.0).
- [Undici security advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c).
- [Vitest manual-mock advisory](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
  and [Windows traversal advisory](https://github.com/advisories/GHSA-xp26-3454-mjgp).
- [npm root-only overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides).
- [npm 12 lockfile and published-shrinkwrap behavior](https://docs.npmjs.com/cli/v12/configuring-npm/package-lock-json).

## Reported older-form preview errors

The maintained linked CLI resolves published core **0.7.0**, whose evaluator does not have
evaluateScope(). CLI source already uses the additive Plan 3 interface. This is an installed-package
mismatch, not an invalid older schema. Default-values initialization now uses the existing backend
capability guard and returns an actionable upgrade error instead of a raw TypeError. A real HTTP
probe with installed 0.7.0 returns that explicit error; the isolated Plan 3 candidate returns HTTP
200 and evaluated defaults. Publishing core first and upgrading the consumer range/install resolves
the mismatch. Current ^0.7.0 ranges do not select the proposed 0.8.0 release automatically.

The `[SETVALUE] BooleanField container not found for "[object Object]"` warning is a separate CLI
defect. Legacy methods with the same names shadowed the newer setters taking a field/container/value.
Managed synchronization therefore passed the field object to a data-name lookup. The scoped setters
now have distinct names; legacy entrypoints are retained. The same defect affected MultiChoiceField.
Commit `f0d52d4` includes two failing-before/passing-after regressions covering separate field
instances, populated values, false and clearing. This changes neither core calculations nor events.

Actual Chromium interaction restores accepted Boolean and checkbox selections, then changes a numeric
input through the UI, runs managed SETVALUE and verifies both choice controls update. No page errors
or console warnings remain. The user's two welcome ALERT messages come from their authored
load-record handler and are expected; no handler or schema was changed to suppress them.

## Verification and provenance

All new installs use existing independent dependency trees and the task-owned npm cache. Heavy
checks run sequentially. There is no maintained dependency-tree replacement, SDK migration, new
device request, production docs build or secret-file inspection in this pass.
The existing localized public Plan 3 documentation remains applicable; this pass adds no public
interface, authored schema attribute or saved metadata format requiring a new translation change.

CLI: all **174** tests, formatting, smoke and package checks pass. The production audit fails as
expected on the remaining Pi/Undici chain. Both parser and choice regressions have retained red and
green evidence. The new CLI archive is `security-preview/form0-cli-0.7.0.tgz`, **318,471 bytes**,
SHA256 `039e761e3efa3ab1e2317e3b7138a514ec0490d56a2b4a92c90b015a8b6eaa08`.
All 96 packaged source/bin files match the maintained and independently tested runtime bytes.
The archive label is unchanged and does not claim a published release or compatible core minimum.

Reports below are relative to the retained active harness,
`../../.local-test-harnesses/form0-plan3-20261022/`:

- `logs/cli-security-selected-gates.json`, `cli-security-selected-check.log`,
  `cli-security-selected-audit.log`, `cli-security-selected-package.log`.
- `logs/cli-security-preview-browser.json`, `cli-old-core-compatibility.json`,
  `cli-choice-setters-red.log`, `cli-choice-setters-green.log`,
  `cli-body-parser-installed-red.log`.
- `logs/cli-security-selected-candidate.json`, `cli-security-bundle-footprint-probe.json`,
  `cli-security-version-options.json`, `cli-security-lock-probe-audit.json` (probe only).
- `logs/security-final-other-packages.json`, `security-final-form0-*-*.log`.
- `logs/react-security-before.json`, `react-security-lock-changes.json` (unselected probe),
  `react-security-selected-gates.json`, `react-security-selected-release.log`.
- `logs/plan3-final-issue-status.json`: read-only live issue reconciliation; no issue was changed.

Earlier core/security, main-thread/actual-worker, Native/Pixel, CLI persistence, Builder and
four-locale documentation evidence retains its original candidate provenance. These CLI and tooling
changes do not justify repeating the accepted Android walkthroughs or claiming a new phone result.

## Release sequence and issue acceptance

1. Review/merge/bump/publish **core 0.8.0** first: the additive public APIs justify a minor release.
   Core release gates and fresh audits pass; the CLI hold does not block core publication.
2. Update actual core minimum ranges and locks in React, Native and CLI to **^0.8.0**, reinstall and
   rerun their normal release gates. CLI may use the core release for local development while its
   own publication stays on hold. Recommend React **0.5.0** and Native **0.6.0** for the new public
   submission/controller/opening contracts. These are recommendations, not version edits performed.
3. Update both starter templates to the coordinated core/binding releases. Update Reform Builder's
   direct core and React ranges together and verify its web submission compatibility. Do not infer
   production Reform companion persistence or mobile/backend adoption from a package upgrade.
4. Publish CLI only after the upstream pin is fixed and installed-package security/release checks
   pass; recommend a minor CLI **0.8.0** for its new preview contracts when unblocked. Rendered docs
   validation remains docs CI-owned, with existing deployment and informational build-audit policies.

Read-only live status is core #99/#104 **open**, React #73 **open**, core #103 **closed**. Implementation
and automated acceptance for #99/#104 are complete; the maintainer can close them against the
coordinated core/documentation release. #104 specifically covers required hidden/read-only policy.
React #73's implementation, main-thread/worker parity and selected-snapshot evidence are complete;
close it against the new core/React release, noting the agreed confirm/explicit-retain behavior.
The unrelated CLI dependency hold need not keep those core/React issues open after their delivery.

Plan 3's implementation, final review and agreed functional/device acceptance are complete with the
documented performance limit. Release/version integration and the CLI security blocker remain open;
the whole ecosystem is not yet released. iOS, compiled-release performance, production Reform
persistence and Native/mobile exception remediation remain their explicitly separate follow-ups.
