
# Project Overview

This project, `form0-core`, is the foundational JavaScript library that powers the entire form0 ecosystem. It provides a form engine that handles calculations, visibility, requirements, and validation based on a JSON schema. The library is designed to be used in both Node.js and browser environments.

## Role in the form0 Ecosystem

`form0-core` serves as the core engine for:

- **form0-cli**: Command-line tools that use the core engine for form schema validation, testing, and development workflows
- **form0-react**: React components and hooks that wrap the core engine to provide seamless integration with React applications
- **form0-react-native**: React Native components that leverage the core engine for mobile form experiences

## Role in reform SaaS

`form0-core` is the underlying engine that powers **reform**, a commercial SaaS product. While form0 is open-source and framework-agnostic, reform builds upon this foundation to provide a complete form management solution with additional enterprise features, hosting, and support.

## Key Features

*   **Schema-driven forms:** Define form structure, logic, and behavior using a JSON schema.
*   **Form Engine:** A core engine that processes the form schema and manages the form state.
*   **Calculated Fields:** Define fields whose values are calculated based on other fields.
*   **Conditional Logic:** Control field visibility, requirements, and read-only status based on conditions.
*   **Event System:** Trigger custom actions based on form events (e.g., `load-record`, `change`).
*   **Built-in Functions:** A set of built-in functions for performing logical operations, calculations, and more.
*   **Extensible:** The engine can be extended with custom helper functions.
*   **Security:** The library includes a security model to control the execution of code.

# Building and Running

## Installation

```bash
npm install form0-core
```

## Running Tests

To run the tests, use the following command:

```bash
npm test
```

## Formatting

To format the code, use the following command:

```bash
npm run format
```

To check the formatting, use the following command:

```bash
npm run format:check
```

# Development Conventions

*   **Code Style:** The project uses Prettier for code formatting.
*   **Testing:** Tests are written in JavaScript and located in the `test` directory. The tests use the built-in `assert` module for assertions.
*   **Modules:** The project uses ES modules.
*   **Documentation:** The project includes documentation in Markdown files in the `src/builtins/docs` directory.
