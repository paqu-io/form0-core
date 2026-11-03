import { parse } from 'acorn';

const children = (node) =>
  Object.entries(node).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value])
      .filter((child) => child?.type)
      .map((child) => ({ child, key }))
  );

/** Scope free field references while preserving literal text, object keys and local bindings. */
export function scopeBuildingPlanExpression(source, aliases) {
  if (typeof source !== 'string' || !source.trim()) return source;
  let syntax;
  try {
    syntax = parse(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
  } catch {
    // Existing expression diagnostics own invalid JavaScript; never guess at a rewrite.
    return source;
  }
  const declarations = new WeakSet();
  const references = [];
  const makeScope = (parent, kind) => ({ parent, kind, names: new Set() });
  const bind = (pattern, scope) => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      declarations.add(pattern);
      scope.names.add(pattern.name);
    } else if (pattern.type === 'RestElement') bind(pattern.argument, scope);
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope);
    else if (pattern.type === 'ArrayPattern')
      for (const element of pattern.elements) bind(element, scope);
    else if (pattern.type === 'ObjectPattern')
      for (const property of pattern.properties)
        bind(property.type === 'RestElement' ? property.argument : property.value, scope);
  };
  const collect = (node, scope, parent = null, key = null) => {
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    ) {
      if (node.type === 'FunctionDeclaration') bind(node.id, scope);
      scope = makeScope(scope, 'function');
      bind(node.id, scope);
      for (const parameter of node.params) bind(parameter, scope);
    } else if (['ClassDeclaration', 'ClassExpression'].includes(node.type)) {
      if (node.type === 'ClassDeclaration') bind(node.id, scope);
      scope = makeScope(scope, 'block');
      bind(node.id, scope);
    } else if (
      [
        'BlockStatement',
        'CatchClause',
        'ForStatement',
        'ForInStatement',
        'ForOfStatement',
        'SwitchStatement',
      ].includes(node.type)
    ) {
      scope = makeScope(scope, 'block');
      if (node.type === 'CatchClause') bind(node.param, scope);
    }
    if (node.type === 'VariableDeclaration') {
      let owner = scope;
      if (node.kind === 'var')
        while (owner.parent && owner.kind !== 'function') owner = owner.parent;
      for (const declaration of node.declarations) bind(declaration.id, owner);
    }
    if (node.type === 'ImportDeclaration')
      for (const specifier of node.specifiers) bind(specifier.local, scope);
    if (node.type === 'Identifier') references.push({ node, scope, parent, key });
    for (const { child, key } of children(node)) collect(child, scope, node, key);
  };
  collect(syntax, makeScope(null, 'program'));
  const replacements = new Map();
  for (const { node, scope, parent, key } of references) {
    if (!node.name.startsWith('$') || !aliases.has(node.name.slice(1)) || declarations.has(node))
      continue;
    if (
      (['MemberExpression', 'Property', 'MethodDefinition', 'PropertyDefinition'].includes(
        parent?.type
      ) &&
        !parent.computed &&
        key === (parent.type === 'MemberExpression' ? 'property' : 'key')) ||
      key === 'label'
    )
      continue;
    let owner = scope;
    while (owner && !owner.names.has(node.name)) owner = owner.parent;
    if (owner) continue;
    const value = `$${aliases.get(node.name.slice(1))}`;
    replacements.set(node.start, {
      end: node.end,
      value: parent?.type === 'Property' && parent.shorthand ? `${node.name}: ${value}` : value,
    });
  }
  let result = source;
  for (const [start, { end, value }] of [...replacements].sort((a, b) => b[0] - a[0]))
    result = result.slice(0, start) + value + result.slice(end);
  return result;
}

export function scopeBuildingPlanConditions(value, aliases) {
  if (Array.isArray(value))
    return value.map((entry) => scopeBuildingPlanConditions(entry, aliases));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (['field', 'field_name', 'data_name'].includes(key) && typeof entry === 'string')
        return [key, aliases.get(entry) || entry];
      return [key, scopeBuildingPlanConditions(entry, aliases)];
    })
  );
}
