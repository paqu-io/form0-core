# form0-core

[![NPM Version](https://img.shields.io/npm/v/form0-core)](https://www.npmjs.com/package/form0-core)
[![NPM Downloads](https://img.shields.io/npm/dm/form0-core)](https://www.npmjs.com/package/form0-core)
[![CI](https://github.com/paqu-io/form0-core/actions/workflows/ci.yml/badge.svg)](https://github.com/paqu-io/form0-core/actions/workflows/ci.yml)
![NPM License](https://img.shields.io/npm/l/form0-core)
[![Docs](https://img.shields.io/badge/docs-docs.form0.dev-2563eb)](https://docs.form0.dev)
[![Website](https://img.shields.io/badge/site-form0.dev-0f172a)](https://form0.dev)
![NPM Last Update](https://img.shields.io/npm/last-update/form0-core)
[![Socket](https://socket.dev/api/badge/npm/package/form0-core)](https://socket.dev/npm/package/form0-core)

> [!NOTE]
> form0 is in active development and is available to use today. Its schema format and core
> concepts are stable in practice, but releases before 1.0 may include breaking changes. Pin your
> versions and review the release notes when upgrading. A formally stable release is coming.

`form0-core` is the framework-agnostic, schema-driven engine behind the
[form0 open-source ecosystem](https://form0.dev). It evaluates calculations, conditional
visibility, requirements, read-only rules, validation, and form events in Node.js, browsers, and
React Native.

## 🚀 Start with the CLI

Most users should begin with [`form0-cli`](https://github.com/paqu-io/form0-cli) rather than install
the engine directly. Follow the [quickstart](https://docs.form0.dev/getting-started/quickstart) to
create a project, edit a schema, and preview a form.

Use `form0-core` directly when you are building a renderer, integration, developer tool, or other
custom form runtime.

## 📦 Installation

```bash
npm install form0-core
```

## ⚡ Quick example

```javascript
import { createFormEngine } from 'form0-core';

const schema = {
  form: {
    name: 'Contact form',
    status_field: null,
    elements: [
      {
        type: 'TextField',
        key: 'name',
        data_name: 'name',
        label: 'Name',
        display: 'default',
        description: null,
        description_mode: null,
        required: true,
        required_conditions: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        pattern: null,
        pattern_description: null,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
      },
    ],
  },
};

const engine = createFormEngine({
  schema,
  initialValues: { name: 'Ada' },
});

engine.eval();
console.log(engine.getState());
```

The engine API exposes `eval()` for calculations, conditions, and validation; `trigger()` for form
events; and `getState()` for current values and evaluated field state.

## Schema and record ownership

`form0-core` owns behavioral schema concerns such as fields, conditions, calculations, events, and
AI metadata. Applications may attach optional top-level metadata such as form identifiers,
publication state, schema version, organization scope, and media or location settings.
Operational counters should remain platform-owned and be injected at application or API
boundaries.

### Record-side contract

`form0-core` intentionally uses two choice-value shapes:

- Live engine and renderer values:
  - single choice and boolean: `{ choice, other }`
  - multiple choice: `{ choices, other }`
- Canonical structured records:
  - single choice and boolean: `{ choice_value, other_value }`
  - multiple choice: `{ choices_value, other_value }`

Record utilities follow this contract:

- `createStructuredRecord()` produces canonical stored records.
- `normalizeStructuredRecord()` consumes and returns canonical stored records.
- `buildFormRecordSnapshot()` converts canonical records into renderer snapshot values.
- `projectDatasetRowValues()` consumes canonical stored rows.

Record status remains top-level as `@status`; it is not stored inside `form_values`.

## ✅ Requirements

- Node.js 22 or newer
- An ESM-capable runtime or bundler

## 📚 Documentation

- [Core overview](https://docs.form0.dev/core/overview)
- [Core concepts](https://docs.form0.dev/core/concepts)
- [Full documentation](https://docs.form0.dev)

## 🔒 Security

> [!CAUTION]
> Schema expressions and event scripts execute JavaScript. Only evaluate schemas from authors you
> trust. `SAFE` and `CUSTOM` modes provide validation controls; they are not security sandboxes.

Read the [security policy](./SECURITY.md) before evaluating schemas outside a fully trusted
authoring workflow.

## 🔗 Related repositories

- [form0-cli](https://github.com/paqu-io/form0-cli) — recommended project entry point
- [form0-react](https://github.com/paqu-io/form0-react) — React bindings and renderers
- [form0-react-native](https://github.com/paqu-io/form0-react-native) — React Native bindings and renderers

## 🤝 Support and contributing

See [SUPPORT.md](https://github.com/paqu-io/form0-core/blob/main/SUPPORT.md) for help and
[CONTRIBUTING.md](https://github.com/paqu-io/form0-core/blob/main/CONTRIBUTING.md) to contribute.

## 📄 License

[MIT](./LICENSE)
