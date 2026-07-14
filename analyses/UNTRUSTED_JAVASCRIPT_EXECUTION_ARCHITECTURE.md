# Untrusted JavaScript Execution Architecture

Status: design documentation only. This document does not change current runtime behavior.

## Decision

form0-core will preserve imperative vanilla-JavaScript calculations and event scripts. `SAFE`
remains an internal compatibility name for validation and linting; it is not a trust boundary.
The selected remediation is a pluggable executor architecture with a trusted in-process executor
and host-supplied isolated executors. Replacing event scripts with declarative event effects is
explicitly rejected.

## Current behavior and threat

Calculations and events compile strings with `new Function` in the host JavaScript realm. Static
blocked-pattern checks reject obvious identifiers but cannot determine runtime behavior. Dynamic
property access, string construction, constructor chains, getters, proxies, coercion hooks, and
other language features can reach capabilities without spelling a blocked token. Adding more
regular expressions or prohibited commands is useful linting for accidental misuse, but is not a
security control against an adversarial author.

`maxExecutionTime` is configuration metadata today; synchronous JavaScript cannot be interrupted
by a timer running in the same thread. Output-size and memory limits are likewise unenforced.
Because the compiled function inherits its host realm, ambient browser, React Native, CLI, or Node
capabilities determine impact.

## Target executor contract

form0-core should depend on an executor interface rather than directly constructing functions:

```js
const result = await executor.execute({
  source,
  kind: 'calculation', // or 'event'
  context: structuredClone(dataOnlyContext),
  limits: { timeoutMs: 100, maxOutputBytes: 64_000 },
});
```

The contract should:

- accept only serializable input and return only serializable output;
- identify calculation versus event execution while preserving imperative JavaScript;
- expose an explicit, versioned minimal helper set;
- reject functions, prototypes, DOM nodes, class instances, handles, and host objects at the
  message boundary;
- return structured result, warning, limit, and execution-error records;
- support cancellation and executor disposal;
- allow the host application to choose the trust policy.

Two implementations are expected:

1. `TrustedExecutor`: current in-realm behavior for schemas whose authors and consumers share the
   same trust boundary. Its name must make the trust assumption explicit.
2. `IsolatedExecutor`: supplied by each host runtime and required for customer-authored code shown
   to collaborators or public respondents.

## Browser isolated executor

The preferred browser boundary is a separate-origin sandboxed iframe which owns a dedicated Web
Worker. The iframe origin must not share cookies, local storage, service workers, authentication
state, or application origin privileges with Reform.

Recommended flow:

1. The application creates a sandboxed iframe from the isolated execution origin. Do not grant
   `allow-same-origin`, top navigation, popups, downloads, forms, pointer lock, or storage access.
2. The iframe starts a fresh worker or a short-lived pooled worker for execution.
3. The application sends a data-only request through `postMessage`; the iframe verifies the exact
   parent origin, protocol version, request identifier, size, and schema.
4. The worker constructs and executes the customer script with only the minimal data and helper
   names supplied in the request.
5. The worker serializes a bounded result. The iframe validates the result and returns it to the
   exact parent origin.
6. The iframe terminates the worker on timeout, malformed output, excessive output, cancellation,
   or completion according to the pooling policy.

The isolated origin should use a restrictive CSP such as `default-src 'none'`, no network
destinations, no frames or child resources beyond the execution worker, and only the minimum script
policy needed for the executor. CSP is defence in depth; separate origin, sandbox flags, data-only
messages, and worker termination remain necessary.

The execution context should contain only field values, immutable event metadata, explicitly
versioned pure helpers, and a result channel. It must not contain access tokens, cookies, user or
organization profiles, arbitrary application state, DOM references, fetch wrappers, telemetry
clients, or navigation objects.

Limits should include request bytes, source bytes, result bytes, console events, execution time,
worker lifetime, nesting depth, and concurrency. Worker termination is the enforceable browser
timeout. Memory exhaustion still requires process/site isolation, browser controls, and conservative
concurrency.

## Runtime-specific threat differences

### Browser

In-realm execution can read DOM state and browser-accessible data, make network requests under the
page's ambient authority, navigate, and block the UI thread. A same-origin worker removes DOM access
but still inherits origin-level network authority and is therefore insufficient alone.

### React Native

There is no browser-origin boundary. JavaScript normally shares the application runtime and may
reach registered native modules or application state. A production isolated executor requires a
separate native process or a hardened embedded engine with no native bridge, data-only IPC,
enforceable termination, memory limits, and an explicit allowlist. A WebView is acceptable only if
the platform can guarantee an isolated data store, no native bridge, restricted navigation and
networking, and reliable process termination.

### CLI

In-process execution inherits filesystem, environment, network, and terminal permissions. The CLI
must treat schemas as trusted unless it delegates to an operating-system sandbox or isolated helper
process with a scrubbed environment, closed file descriptors, restricted working directory,
network policy, resource limits, and a hard kill timeout.

### Node server

Never use the trusted executor for untrusted schemas. `node:vm` contexts are not a security
boundary. A server implementation needs a separately sandboxed process, container, or isolation
technology with no secrets, no production filesystem mounts, no metadata-service access, no
network by default, strict CPU/memory/process limits, and forced termination. The safest Reform
policy remains not executing customer calculations on the backend.

## Phased delivery

1. Introduce the executor interface without changing the default evaluator or script language.
2. Add conformance tests for calculations, multiline scripts, event scripts, helpers, errors, and
   serialization so trusted and isolated executors remain behaviorally compatible.
3. Implement the separate-origin browser executor and require it for public and multi-user Reform
   surfaces.
4. Implement or procure an isolated React Native executor before enabling customer-authored scripts
   in a native context that processes untrusted forms.
5. Add CLI/server isolation only for products that intentionally execute untrusted schemas there.
6. Keep `SAFE` validation as author feedback, rename user-facing descriptions to validation or
   linting, and measure violations without claiming containment.

## Acceptance criteria

- Vanilla JavaScript calculations and imperative event scripts remain supported.
- No declarative event-effects redesign is introduced.
- Public/browser execution has no Reform-origin storage, credentials, DOM, or network authority.
- Messages and outputs are data-only, schema-validated, and size-bounded.
- Timeout terminates the worker or isolated process rather than merely racing a timer.
- React Native, CLI, and Node hosts cannot silently fall back to in-process execution for untrusted
  schemas.
- Documentation and APIs distinguish validation from isolation and trusted from untrusted use.
