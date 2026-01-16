# Repository Guidelines

This project, `form0-core`, is the foundational JavaScript library that powers the entire form0 ecosystem. It provides a form engine that handles calculations, visibility, requirements, and validation based on a JSON schema. The library is designed to be used in both Node.js and browser environments.

## Role in the form0 Ecosystem

`form0-core` serves as the core engine for:

- **form0-cli**: Command-line tools that use the core engine for form schema validation, testing, and development workflows
- **form0-react**: React components and hooks that wrap the core engine to provide seamless integration with React applications
- **form0-react-native**: React Native components that leverage the core engine for mobile form experiences

### Role in reform SaaS

`form0-core` is the underlying engine that powers **reform**, a commercial SaaS product. While form0 is open-source and framework-agnostic, reform builds upon this foundation to provide a complete form management solution with additional enterprise features, hosting, and support.

## Key Features

- **Schema-driven forms:** Define form structure, logic, and behavior using a JSON schema.
- **Form Engine:** A core engine that processes the form schema and manages the form state.
- **Calculated Fields:** Define fields whose values are calculated based on other fields.
- **Conditional Logic:** Control field visibility, requirements, and read-only status based on conditions.
- **Event System:** Trigger custom actions based on form events (e.g., `load-record`, `change`).
- **Built-in Functions:** A set of built-in functions for performing logical operations, calculations, and more.
- **Extensible:** The engine can be extended with custom helper functions.
- **Security:** The library includes a security model to control the execution of code.

## Project Structure & Module Organization

- `src/`: Library source (ESM). Key areas: `engine/` (form engine, warnings), `schema/` (validators, field specs, operators), `utilities/` (helpers, hashing, versioning), `security/` (config), `builtins/` (field implementations), `index.js` (public exports).
- `tests/`: Node-run test scripts and security examples. Open `tests/security-browser-test.html` in a browser for manual checks.
- `.github/`: Workflows for automation and triage. See `GEMINI.md` for bot usage.

## Architecture Overview

### Core Engine (`src/engine/`)
- **form-engine.js**: Main entry point for creating engine instances with state management
- **calculation.js**: Calculated field evaluation
- **conditions.js**: Visibility, required, and read-only conditions
- **field-validation.js**: Field-level validation
- **events.js**: Event system for form interactions
- **context-resolver.js**: Field context resolution for calculations
- **warning-system.js**: Warnings and diagnostics

### Schema System (`src/schema/`)
- **schema-validator.js**: Form schema validation
- **field-specs.js**: Field type specifications
- **operators.js**: Logical and comparison operators
- **attribute-validator.js**: Field attribute validation
- **field-schema-registry.js**: Registry for field type schemas
- **field-value-registry.js**: Registry for field value handlers

### Built-in Functions (`src/builtins/`)
- **registry.js**: Central registry for built-in functions
- **choice/**: Choice field operations (labels, values, other handling)
- **control/**: Form control operations (eval, setresult)
- **event/**: Event handling operations
- **logical/**: Logical operations (and, or, if)
- **math/**: Mathematical operations (ROUND)
- **string/**: Text manipulation functions (UPPER)

### Security (`src/security/`)
- **config.js**: Security configurations (TRUSTED, SAFE, CUSTOM modes)
- **validation.js**: Security validation logic

### Utilities (`src/utilities/`)
- **field-helpers.js**: Common field operations and transformations
- **hash.js**: Key generation utilities
- **record-transformer.js**: Data transformation utilities
- **version-utils.js**: Version management utilities

## Key Concepts

### Form Engine Creation
- Use `createFormEngine({ schema, initialValues, helpers, security })` to create a form instance.
- Engine API: `eval()` (calculations/conditions/validation), `trigger()` (events), `getState()` (values, errors, visible, required, read_only).

### Field Types
- Core types: TextField, NumericField, SingleChoiceField, MultiChoiceField, BooleanField, DateField, TimeField, CalculatedField, Section, RepeatableSection, LabelField.

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
- Built-in functions: follow JSDoc pattern with `@builtin`, `@description`, `@param`, `@returns`, `@example` tags.

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
- Modes: **TRUSTED** (default), **SAFE** (restricted context), **CUSTOM** (user-defined rules).
- SAFE mode analysis: see `SAFE_MODE_SECURITY_ANALYSIS.md`.
- Never introduce unvetted dynamic code execution or imports in core paths.
- Validate any untrusted schema input via existing validators.
- Do not commit secrets; keep test data non-sensitive. Validate untrusted input through schema validators.

## Language policy

- JavaScript only in this repo. No TypeScript source files.
- Optional types via JSDoc (@typedef, @param, @returns) to improve DX without adding a TS build step.
