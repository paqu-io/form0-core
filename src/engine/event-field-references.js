import { parse } from 'acorn';

const isFunction = (node) =>
  ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type);

function bindPattern(node, names) {
  if (!node) return;
  if (node.type === 'Identifier') names.add(node.name);
  else if (node.type === 'RestElement') bindPattern(node.argument, names);
  else if (node.type === 'AssignmentPattern') bindPattern(node.left, names);
  else if (node.type === 'ArrayPattern')
    node.elements.forEach((element) => bindPattern(element, names));
  else if (node.type === 'ObjectPattern')
    node.properties.forEach((property) =>
      bindPattern(property.type === 'RestElement' ? property.argument : property.value, names)
    );
}

function children(node, visit) {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => child?.type && visit(child));
    else if (value?.type) visit(value);
  }
}

function bindVars(node, names) {
  if (
    !node ||
    isFunction(node) ||
    ['ClassDeclaration', 'ClassExpression', 'StaticBlock'].includes(node.type)
  )
    return;
  if (node.type === 'VariableDeclaration' && node.kind === 'var')
    node.declarations.forEach((declaration) => bindPattern(declaration.id, names));
  children(node, (child) => bindVars(child, names));
}

function bindDeclarations(statements, names) {
  for (const statement of statements) {
    if (statement.type === 'VariableDeclaration' && statement.kind !== 'var')
      statement.declarations.forEach((declaration) => bindPattern(declaration.id, names));
    else if (['ClassDeclaration', 'FunctionDeclaration'].includes(statement.type))
      bindPattern(statement.id, names);
  }
}

/** Free $field identifiers only: strings, comments, property names and local bindings are excluded. */
export function getEventFieldReferences(source) {
  const tree = parse(`(${source})`, { ecmaVersion: 'latest' });
  const references = new Set();
  const newScope = (parent) => ({ names: new Set(), parent });
  function bound(scope, name) {
    return scope && (scope.names.has(name) || bound(scope.parent, name));
  }
  function patternExpressions(node, scope) {
    if (!node || node.type === 'Identifier') return;
    if (node.type === 'AssignmentPattern') {
      patternExpressions(node.left, scope);
      walk(node.right, scope);
    } else if (node.type === 'RestElement') patternExpressions(node.argument, scope);
    else if (node.type === 'ArrayPattern')
      node.elements.forEach((element) => patternExpressions(element, scope));
    else if (node.type === 'ObjectPattern')
      node.properties.forEach((property) => {
        if (property.computed) walk(property.key, scope);
        patternExpressions(
          property.type === 'RestElement' ? property.argument : property.value,
          scope
        );
      });
  }
  function walk(node, scope) {
    if (!node) return;
    if (isFunction(node)) {
      const local = newScope(scope);
      bindPattern(node.id, local.names);
      node.params.forEach((param) => bindPattern(param, local.names));
      node.params.forEach((param) => patternExpressions(param, local));
      bindVars(node.body, local.names);
      walk(node.body, local);
    } else if (node.type === 'BlockStatement' || node.type === 'StaticBlock') {
      const local = newScope(scope);
      if (node.type === 'StaticBlock') node.body.forEach((part) => bindVars(part, local.names));
      bindDeclarations(node.body, local.names);
      node.body.forEach((statement) => walk(statement, local));
    } else if (['ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type)) {
      const local = newScope(scope);
      const declaration = node.init || node.left;
      if (declaration?.type === 'VariableDeclaration')
        declaration.declarations.forEach((part) => bindPattern(part.id, local.names));
      children(node, (child) => walk(child, local));
    } else if (node.type === 'SwitchStatement') {
      walk(node.discriminant, scope);
      const local = newScope(scope);
      bindDeclarations(
        node.cases.flatMap((part) => part.consequent),
        local.names
      );
      node.cases.forEach((part) => walk(part, local));
    } else if (node.type === 'CatchClause') {
      const local = newScope(scope);
      bindPattern(node.param, local.names);
      walk(node.body, local);
    } else if (node.type === 'VariableDeclarator') {
      patternExpressions(node.id, scope);
      walk(node.init, scope);
    } else if (node.type === 'LabeledStatement') {
      walk(node.body, scope);
    } else if (node.type === 'BreakStatement' || node.type === 'ContinueStatement') {
      return;
    } else if (
      ['MemberExpression', 'Property', 'PropertyDefinition', 'MethodDefinition'].includes(node.type)
    ) {
      if (node.computed) walk(node.property || node.key, scope);
      walk(node.object || node.value, scope);
    } else if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
      const local = newScope(scope);
      bindPattern(node.id, local.names);
      walk(node.superClass, scope);
      walk(node.body, local);
    } else if (node.type === 'Identifier') {
      if (node.name.startsWith('$') && !bound(scope, node.name)) references.add(node.name.slice(1));
    } else children(node, (child) => walk(child, scope));
  }
  walk(tree, newScope(null));
  return references;
}
