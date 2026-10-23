# Opening-controls verification — 23 October 2026

This is a binding-only follow-up to Plan 3. Existing repeatable rows open in view mode; Edit
enters editing. `repeatableEntryMode="edit"` selects direct editing. New rows always start editing.
The setting applies at every nesting level. Read-only ancestors allow browsing and prevent
Edit/Add/Remove, including when a host requests direct editing. Existing web edit-toggle restrictions
remain effective. The web row overlay now exposes an accessible named dialog.

Calculation/condition/validation execution and schema/record structure are unchanged. Root managed
new/edit events already exist in both bindings; `events.recordKind` explicitly classifies the root.
No lifecycle replay, persistence integration, dependency upgrade or version bump is introduced.
The selected follow-up direction is accepted-snapshot viewing; load-handler writes and evaluation
participation still require discussion. Final Android acceptance is paused until that policy is
settled; the earlier successful walkthrough 1 report remains tied to its previous candidate.

## Automated evidence

All commands ran using Node 24.22.1 in retained independent dependency trees. Heavy checks were
sequential. No maintained dependency tree was replaced, no new installation was needed, and old
candidate archives/evidence remain available. Logs are under
`.local-test-harnesses/form0-plan3-20261022/logs/`.

| Check | Result | Evidence |
| --- | --- | --- |
| React production ESM/CJS/worker build and full Vitest suite | 84/84 | `react-opening-full.json`, `react-opening-full.log` |
| React opening cases, TRUSTED and SAFE | 6/6 | `react-opening-controls.json` |
| Native platform-adapter build and full suite | 23/23 | `native-opening-full.json`, `native-opening-full.log` |
| Native Node suite | 54/54 | `native-opening-node.log` |
| Native opening cases, TRUSTED and SAFE | 6/6 | `native-opening-controls.json` |
| Chromium pointer interactions, main-thread and actual worker, TRUSTED and SAFE | 12 scenarios, no page errors, 14 worker instances | `browser-opening-controls.json`, reproducible `browser-opening-controls.mjs` |
| Public Native declarations | Pass, including valid/invalid opening options | `type-checks/native-controller.ts`, tsc bundler resolution / ESNext / ES2022 / skipLibCheck |
| React formatting | Pass | `react-opening-format.log` |
| Package contents | React 14 files / Native 66 files | independent `npm run package:check` |
| EN/ES/FR/IT docs formatting, i18n, navigation, page parity, 23 tests, lint gate | Pass; no production build | `opening-docs-*.log` |

Tests exercise view-to-edit lifecycle timing, direct editing, actual new-row classification, multiple
levels of browsing, read-only ancestor restrictions, accepted save/cancel isolation, ID zero and
immutable inputs. The unchanged full suites cover existing scalar/collection/submission behavior.
Native's HTML adapter still reports its existing nested-button warning for discard-dialog Pressables;
it is not evidence of an Android error. Actual Hermes/device execution is not claimed for this patch.

## Packed candidates

Candidate filenames retain unpublished working manifest labels, not registry-version claims.
The two archives total less than 0.8 MB; source/build/report additions are small. No SDK exports or
large performance fixtures were generated. Exact tarball sizes/hashes and installed-source parity
are in `logs/opening-controls-candidates.json`.

- `opening-controls/form0-react-0.4.0.tgz`: 368861 bytes; SHA-256 `5817a8c3262b869c5f26dcd83feb518485a869a9c1f7b2e27f9e44167ee2b619`.

- `opening-controls/form0-react-native-0.5.0.tgz`: 419954 bytes; SHA-256 `c40c620673633edaf384e5f1e2a1638b001df05b757d663433198a90fba47743`.

The Native tarball was applied to the existing independent device dependency tree after verifying
it was not symlinked. Its renderer source matches both maintained source and the tested adapter.
Reload the app when acceptance resumes; the previous candidate's device result is not transferred
to this candidate. No Metro process was stopped. iOS acceptance remains deferred.

## Reproduction

- In the retained `react/` harness: `npm test -- --reporter=json --outputFile=../logs/react-opening-full.json`.
- In `react-native/`: `node build.mjs`, then `./node_modules/.bin/vitest run scope.test.jsx --environment jsdom` and `npm test`.
- At the active harness root: `node browser-opening-controls.mjs`.
- Native declarations: `./react/node_modules/.bin/tsc --noEmit --skipLibCheck --moduleResolution bundler --module esnext --jsx react-jsx --target es2022 type-checks/native-controller.ts`.
- Docs gates ran in `.local-test-harnesses/form0-docs-security-20261022/site/` with current changed pages.

Maintainer-owned dependency/funding edits remain uncommitted. No merge, push, release, publication,
deployment, issue closure or additional harness cleanup was performed.
