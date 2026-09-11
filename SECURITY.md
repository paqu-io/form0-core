# Security Policy

Security reports are taken seriously. Please report vulnerabilities privately so they can be
investigated and fixed before public disclosure.

## Reporting a vulnerability

Use the
[form0-core private vulnerability report](https://github.com/paqu-io/form0-core/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include:

- the affected version and runtime;
- a minimal reproduction or proof of concept;
- the impact you believe is possible;
- any mitigations you have already identified; and
- whether the issue has been disclosed anywhere else.

Reports affecting any version are welcome. When possible, reproduce the issue with the latest
release. Security fixes are normally released for the latest version; older versions are assessed
case by case.

Maintainers will review the report, may ask for more information, and will coordinate disclosure
after a fix or mitigation is available. Please keep the report private during that process.

## Trust model

form0-core supports JavaScript expressions and imperative event scripts. These expressions and
scripts are executable code, so schemas that contain them must come from authors you trust.

**SAFE** and **CUSTOM** modes provide validation and configuration controls. They are not security
sandboxes, and pattern-based restrictions must not be used as a boundary for executing adversarial
schemas in a privileged browser, server, CLI, or mobile context.

Giving an untrusted user control over executable schema expressions and then observing that the
expressions can execute JavaScript is outside this project's security boundary. Reports remain in
scope when behavior crosses a documented boundary—for example, when data that is not intended to
be executable becomes code, or when an attacker can affect a schema or runtime context they were
not authorized to control.

Applications are responsible for authenticating schema authors, authorizing schema changes, and
isolating execution when schemas cannot be trusted.

## Maintainer security documents

The public documents in
[analyses](https://github.com/paqu-io/form0-core/tree/main/analyses) record the current threat model,
known limitations, and the planned isolation architecture. They are maintainer-oriented
engineering documents, not claims that the current validation modes provide isolation.

For ordinary usage questions, see
[SUPPORT.md](https://github.com/paqu-io/form0-core/blob/main/SUPPORT.md).
