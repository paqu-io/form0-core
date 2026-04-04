# form0-core

[![NPM Version](https://img.shields.io/npm/v/form0-core)](https://www.npmjs.com/package/form0-core)
[![NPM Downloads](https://img.shields.io/npm/dt/form0-core)](https://www.npmjs.com/package/form0-core)
![NPM License](https://img.shields.io/npm/l/form0-core)
[![Docs](https://img.shields.io/badge/docs-docs.form0.dev-2563eb)](https://docs.form0.dev)
[![Website](https://img.shields.io/badge/site-form0.dev-0f172a)](https://form0.dev)
![NPM Last Update](https://img.shields.io/npm/last-update/form0-core)

> [!WARNING]
> form0 is in active, very early development. Do not use in production. Expect breaking
> changes and unstable behavior.

form0-core is the schema-driven engine that powers [form0 open-source ecosystem](https://form0.dev). It is framework-agnostic and runs in any JavaScript runtime (Node.js, browsers, React Native, etc.)

## 🚀 Start with the CLI (recommended)

The entry point for most users is [form0-cli](https://github.com/paqu-io/form0-cli). Follow the [quickstart](https://docs.form0.dev/getting-started/quickstart) to create a project and preview
your schema.

## 🗂️ Documentation

- Overview: https://docs.form0.dev/core/overview
- Concepts: https://docs.form0.dev/core/concepts
- Full docs: https://docs.form0.dev

## Direct usage (advanced)

If you are integrating the engine directly:

```bash
npm install form0-core
```

`form0-core` owns behavioral schema concerns such as fields, conditions, calculations,
events, and AI metadata. Applications may still attach optional top-level metadata such as
`id` (unique form identifier), `status` (publication state), `version` (schema version),
scope fields like `main_org_id`, and media or location settings. Operational counters like
`record_count` and `record_last_change_at` should stay platform-owned and be injected at
application or API boundaries, not treated as engine-authored schema. A top-level
`form.version` may still exist, but the engine does not bump or consume it.

### Record-side contract

`form0-core` intentionally uses two different choice-value shapes:

- Live engine / renderer values use renderer shape:
  - single / boolean: `{ choice, other }`
  - multi: `{ choices, other }`
- Structured records use canonical stored shape:
  - single / boolean: `{ choice_value, other_value }`
  - multi: `{ choices_value, other_value }`

Record-side utilities follow this contract:

- `createStructuredRecord()` outputs canonical stored records
- `normalizeStructuredRecord()` consumes and returns canonical stored records
- `buildFormRecordSnapshot()` consumes canonical stored records and returns renderer snapshot values
- `projectDatasetRowValues()` consumes canonical stored rows

Record status remains top-level as `@status`; it is not stored inside `form_values`.

## Security

See `SECURITY.md` for security modes and configuration.

## Requirements

- Node.js 18+

## Related repositories

- [form0-cli](https://github.com/paqu-io/form0-cli) - Command-line interface
- [form0-react](https://github.com/paqu-io/form0-react) - React components
- [form0-react-native](https://github.com/paqu-io/form0-react-native) - React Native components

## Contributing

Contributions are welcome! Please feel free to submit [issues](https://github.com/paqu-io/form0-core/issues) and [pull requests](https://github.com/paqu-io/form0-core/pulls).
