# Repository Guidelines

This project, `form0-core`, is the foundational JavaScript library that powers the entire form0 ecosystem. It provides a form engine that handles calculations, visibility, requirements, and validation based on a JSON schema. The library is designed to be used in both Node.js and browser environments.

## Role in the form0 Ecosystem

`form0-core` serves as the core engine for:

- **form0-cli**: Command-line tools that use the core engine for form schema validation, testing, and development workflows
- **form0-react**: React components and hooks that wrap the core engine to provide seamless integration with React applications
- **form0-react-native**: React Native components that leverage the core engine for mobile form experiences

## Role in reform SaaS

`form0-core` is the underlying engine that powers **reform**, a commercial SaaS product. While form0 is open-source and framework-agnostic, reform builds upon this foundation to provide a complete form management solution with additional enterprise features, hosting, and support.

## Project Structure & Module Organization
- `src/`: Library source (ESM). Key areas: `engine/` (form engine, warnings), `schema/` (validators, field specs, operators), `utilities/` (helpers, hashing, versioning), `security/` (config), `builtins/` (field implementations), `index.js` (public exports).
- `tests/`: Node-run test scripts and security examples. Open `tests/security-browser-test.html` in a browser for manual checks.
- `.github/`: Workflows for automation and triage. See `GEMINI.md` for bot usage.

## Build, Test, and Development Commands
- Install: `npm ci` (Node 18+; uses `package-lock.json`).
- Format (write): `npm run format`.
- Format (check): `npm run format:check`.
- Run tests: `node tests/form0-core.test.js` and `node tests/security-test.js`.
- Import locally: `node -e "import('./src/index.js').then(m=>console.log(Object.keys(m)))"`.

## Coding Style & Naming Conventions
- Prettier: 2 spaces, single quotes, semicolons, trailing commas (ES5), max width 100.
- Modules: ES Modules only (`type: module`). File names use `kebab-case.js`.
- Identifiers: functions `camelCase`, classes/types `PascalCase`, constants `UPPER_SNAKE_CASE`.
- Public API: export via `src/index.js`; prefer factories like `createFormEngine`, utilities under `utilities/`.

## Testing Guidelines
- Framework: none; tests are plain Node scripts in `tests/` and may log/throw on failure.
- Naming: prefer `*.test.js` next to other test files in `tests/`.
- Scope: add focused tests for schema validation, operators, and engine behaviors. Keep tests deterministic (no network, no timers where possible).
- Manual: security HTML can be opened in a browser to verify CSP-related behavior.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (`feat:`, `fix:`, `chore:` …) with clear scope (e.g., `feat(schema): add version utils`).
- PRs: include purpose, brief technical notes, and linked issues. Add usage notes when public exports change. Ensure format check passes and tests run locally.

## Security & Configuration Tips
- Review `SECURITY.md` and prefer `SAFE_SECURITY_CONFIG`/`SECURITY_MODES` from `src/security/config.js`.
- Do not commit secrets; keep test data non-sensitive. Validate untrusted input through schema validators.

