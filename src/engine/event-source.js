import { parse } from 'acorn';

/** Retains authored callback source without depending on engine-specific toString output. */
export function createEventSourceRegistry() {
  const sources = new WeakMap();

  function prepare(code, context) {
    let tree;
    try {
      // Event scripts are Function bodies, rather than modules or global scripts.
      tree = parse(code, { ecmaVersion: 'latest', sourceType: 'commonjs' });
    } catch {
      // Let the existing evaluator validate and report invalid/unsupported source.
      return { code, context };
    }

    const identifiers = new Set();
    function collectIdentifiers(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Identifier') identifiers.add(node.name);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(collectIdentifiers);
        else if (value && typeof value === 'object') collectIdentifiers(value);
      }
    }
    collectIdentifiers(tree);
    let captureName = '__form0CaptureEventSource';
    while (identifiers.has(captureName) || Object.hasOwn(context, captureName)) captureName += '_';
    const edits = [];
    const propertyNames = new Map();

    function inferredName(node, parent) {
      if (node.id) return '';
      if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier')
        return parent.id.name;
      if (
        parent?.type === 'AssignmentExpression' &&
        ['=', '||=', '&&=', '??='].includes(parent.operator) &&
        parent.left.type === 'Identifier'
      )
        return parent.left.name;
      if (parent?.type === 'AssignmentPattern' && parent.left.type === 'Identifier')
        return parent.left.name;
      if (parent?.type === 'Property' && parent.computed) {
        // Preserve ToPropertyKey's single coercion and the inferred function name.
        const key = parent.key;
        edits.push({ position: key.start, rank: 0, text: `${captureName}.key(` });
        edits.push({ position: key.end, rank: 2, text: `,${node.start})` });
        return { computed: node.start };
      }
      if (
        (parent?.type === 'Property' || parent?.type === 'PropertyDefinition') &&
        (!parent.computed || parent.key.type === 'Literal')
      ) {
        if (parent.key.type === 'PrivateIdentifier') return `#${parent.key.name}`;
        return parent.key.type === 'Identifier' ? parent.key.name : String(parent.key.value);
      }
      return '';
    }

    function visit(node, parent) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Program' || node.type === 'BlockStatement') {
        const declarations = node.body.filter(
          (statement) => statement.type === 'FunctionDeclaration'
        );
        if (declarations.length) {
          let position = node.type === 'Program' ? node.start : node.start + 1;
          for (const statement of node.body) {
            if (
              statement.type !== 'ExpressionStatement' ||
              statement.expression.type !== 'Literal' ||
              typeof statement.expression.value !== 'string'
            )
              break;
            position = statement.end;
          }
          const text = declarations
            .map(
              (declaration) =>
                `${captureName}(${declaration.id.name},${JSON.stringify(code.slice(declaration.start, declaration.end))});`
            )
            .join('');
          edits.push({ position, rank: 1, text: `;${text}` });
        }
      }
      if (
        (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') &&
        !(parent?.type === 'Property' && (parent.method || parent.kind !== 'init')) &&
        parent?.type !== 'MethodDefinition' &&
        // Dynamic class keys need class-specific name metadata; keep their legacy path.
        !(parent?.type === 'PropertyDefinition' && parent.computed && parent.key.type !== 'Literal')
      ) {
        const source = code.slice(node.start, node.end);
        const name = inferredName(node, parent);
        const nameExpression =
          typeof name === 'object'
            ? `${captureName}.nameFor(${name.computed})`
            : JSON.stringify(name);
        edits.push({ position: node.start, rank: 0, text: `${captureName}(` });
        edits.push({
          position: node.end,
          rank: 2,
          text: `,${JSON.stringify(source)},${nameExpression})`,
        });
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'start' || key === 'end') continue;
        if (Array.isArray(value)) value.forEach((child) => visit(child, node));
        else if (value && typeof value === 'object') visit(value, node);
      }
    }
    visit(tree, null);

    let prepared = code;
    // At shared boundaries apply openers first, then hoisted captures, then closers.
    for (const { position, text } of edits.sort(
      (a, b) => b.position - a.position || a.rank - b.rank
    )) {
      prepared = prepared.slice(0, position) + text + prepared.slice(position);
    }

    const capture = (callback, source, name) => {
      sources.set(callback, source);
      if (name && !callback.name)
        Object.defineProperty(callback, 'name', { value: name, configurable: true });
      return callback;
    };
    capture.key = (value, id) => {
      const key = Reflect.ownKeys({ [value]: null })[0];
      propertyNames.set(
        id,
        typeof key === 'symbol'
          ? key.description === undefined
            ? ''
            : `[${key.description}]`
          : key
      );
      return key;
    };
    capture.nameFor = (id) => propertyNames.get(id);

    return {
      code: prepared,
      context: {
        ...context,
        [captureName]: capture,
      },
    };
  }

  function getSource(callback) {
    if (sources.has(callback)) return sources.get(callback);
    const source = callback.toString();
    if (/^function\b[^]*\{\s*\[\s*(?:native\s+code|bytecode)\s*\]\s*\}\s*$/.test(source.trim())) {
      throw new Error(
        'Event callback source is unavailable on this JavaScript engine. Define the callback in form.events.code.'
      );
    }
    return source;
  }

  return { prepare, getSource };
}
