# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Testing
- `npm test` - Runs all tests (form0-core.test.js and security-test.js)
- `node tests/form0-core.test.js` - Run core functionality tests
- `node tests/security-test.js` - Run security validation tests
- Open `tests/security-browser-test.html` in browser for manual security validation

### Code Quality
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting without writing changes

### Installation
- `npm ci` - Install dependencies (requires Node 18+)

### Manual Testing
- `node -e "import('./src/index.js').then(m=>console.log(Object.keys(m)))"` - Quick import test

## form0 Ecosystem

This project, `form0-core`, is the foundational JavaScript library that powers the entire form0 ecosystem. It provides a form engine that handles calculations, visibility, requirements, and validation based on a JSON schema. The library is designed to be used in both Node.js and browser environments.

`form0-core` serves as the core engine for:

- **form0-cli**: Command-line tools that use the core engine for form schema validation, testing, and development workflows
- **form0-react**: React components and hooks that wrap the core engine to provide seamless integration with React applications
- **form0-react-native**: React Native components that leverage the core engine for mobile form experiences

### Role in reform SaaS
`form0-core` is the underlying engine that powers **reform**, a commercial SaaS product. While form0 is open-source and framework-agnostic, reform builds upon this foundation to provide a complete form management solution with additional enterprise features, hosting, and support.

## Architecture Overview

form0-core's architecture is organized into several key modules:

### Core Engine (`src/engine/`)
- **form-engine.js**: Main entry point - creates form engine instances with state management
- **calculation.js**: Handles calculated field evaluation 
- **conditions.js**: Manages visibility, requirement, and read-only conditions
- **field-validation.js**: Validates field values against constraints
- **events.js**: Event system for form interactions
- **context-resolver.js**: Resolves field contexts for calculations
- **warning-system.js**: Manages warnings and diagnostics

### Schema System (`src/schema/`)
- **schema-validator.js**: Validates form schemas
- **field-specs.js**: Defines field type specifications
- **operators.js**: Logical and comparison operators for conditions
- **attribute-validator.js**: Validates field attributes
- **field-schema-registry.js**: Registry for field type schemas
- **field-value-registry.js**: Registry for field value handlers

### Built-in Functions (`src/builtins/`)
- **registry.js**: Central registry for all built-in functions
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
Use `createFormEngine({ schema, initialValues, helpers, security })` to create a form instance. The engine provides:
- `eval()`: Evaluates all form logic (calculations, conditions, validation)
- `trigger()`: Triggers form events
- `getState()`: Returns current form state (values, errors, visible, required, read_only)

### Security Configuration
- **TRUSTED** (default): Full JavaScript access
- **SAFE**: Restricted context with blocked dangerous patterns
- **CUSTOM**: User-defined security rules
Import security configs from `src/security/config.js`

### Security Analysis
- **TRUSTED** (default): N/A
- **SAFE**: @SAFE_MODE_SECURITY_ANALYSIS.md
- **CUSTOM**: N/A

### Field Types
Core field types include TextField, NumericField, SingleChoiceField, MultiChoiceField, BooleanField, DateField, TimeField, CalculatedField, Section, RepeatableSection, LabelField.

## Code Conventions

### Style Guidelines
- ES Modules only (`type: module`)
- Prettier: 2 spaces, single quotes, semicolons, trailing commas (ES5), max width 100
- File names: `kebab-case.js`
- Functions: `camelCase`
- Classes/Types: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Builtin functions: Follow JSDoc pattern with @builtin, @description, @param, @returns, @example tags

### Export Strategy
- All public API exports go through `src/index.js`
- Prefer factory functions like `createFormEngine`
- Group utilities under `utilities/` module

### Testing Strategy
- Plain Node.js scripts in `tests/` directory
- No testing framework - tests log/throw on failure
- Name test files with `*.test.js` suffix
- Keep tests deterministic (no network, minimal timers)

### Security Best Practices
- Never introduce unvetted dynamic code execution
- Validate untrusted schema input via existing validators
- Prefer `SAFE_SECURITY_CONFIG` for user-generated content
- Review `SECURITY.md` for detailed security guidelines

## Language Policy
- JavaScript only - no TypeScript source files
- Optional JSDoc types for better DX (@typedef, @param, @returns)

---

<!-- END UPDATABLE SECTIONS - /check-docs command updates sections above this line -->

## MCP Memory

**TL;DR**: Log engineering decisions as one-line facts. Search before proposing changes, write after making decisions.

Use the MCP Memory server as an ENGINEERING KNOWLEDGE LOG (not source code).

### When to read (and show your work)
- Before proposing or changing implementation in the current scope:
  1) search memory for that scope,
  2) print a one-line banner:
     🔎 Memory[<scope>] hits=<n>, last=<YYYY-MM-DD>, note: partial store
  3) if hits exist, show a 3–6 bullet "Prior decisions & constraints" digest (one-liners).

### When to write
- After we converge on a choice, finish a spike/fix, capture a trade-off, or log a blocking TODO/open question.
- De-dupe first (search by scope + similar text). If superseded, add a new DECISION and mark the older via OUTCOME [deprecated] with a ref.

### What to store (one-line facts, examples)
- **DECISION**: [DECISION] [scope:form0-core] [date:2025-01-15] Use kebab-case for builtin file names [refs:CLAUDE.md]
- **CONSTRAINT**: [CONSTRAINT] [scope:form0-core] [date:2025-01-15] No TypeScript source files, JavaScript only [refs:package.json]
- **APPROACH**: [APPROACH] [scope:form0-core] [date:2025-01-15] String functions follow math function patterns [refs:src/builtins/math/]
- **RATIONALE**: [RATIONALE] [scope:form0-core] [date:2025-01-15] Prefer factory functions for cleaner API surface
- **OUTCOME**: [OUTCOME] [scope:form0-core] [date:2025-01-15] UPPER() function successfully implemented and tested
- **TODO**: [TODO] [scope:form0-core] [date:2025-01-15] Add comprehensive string manipulation builtin suite
- **OPEN_QUESTION**: [OPEN_QUESTION] [scope:form0-core] [date:2025-01-15] Should string functions handle Unicode normalization?

### Format
```
[TAG] [scope:<repo|package|feature>] [date:YYYY-MM-DD] <concise statement> [refs:<issue|PR|commit|doc>] [prov:<session|author>]
```
Keep atomic and short (<200 chars). No secrets; no large code/logs (link via refs).

### Common Pitfalls
- Don't log implementation details (log decisions instead)
- Don't duplicate information already in ADRs/README
- Search first to avoid duplicates
- Focus on "why" not "what" for decisions

### Incompletness and backfill
- memory.json may be incomplete. Treat it as a working set, not the source of truth.
- If you infer a stable fact (e.g., from ADRs/README/code) that's missing, propose adding a matching one-line note (DECISION/CONSTRAINT/APPROACH).
- When a suggestion might conflict with unstored history, say: "Memory may be incomplete; verify with ADR/docs" and offer to backfill.

### Scoping and entities
- Default scope = current repo or top-level folder; narrow to package/feature if obvious (e.g., form0-core, form0-react).
- Attach observations to Entities like Project, Package/Service, Feature, DecisionTopic. Use active relations when useful.

### Provenance (optional)
- If available, add lightweight provenance in the note's bracket, e.g. [prov:session=<id>] or [prov:author=claude-code].
- Do NOT rely on provenance for retrieval/ranking; it's for traceability only and can be omitted.

### Hygiene
- ISO dates; single-line bullets; avoid duplicates.
- Prefer updating facts over adding near-duplicates.
