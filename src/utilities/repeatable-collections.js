import { parse } from 'acorn';
import { ContextResolver } from '../engine/context-resolver.js';

export const COLLECTION_NAMES = new Set(['REPEATABLEVALUES', 'REPEATABLESUM']);
const VALUE_TYPES = new Set([
  'TextField',
  'NumericField',
  'SingleChoiceField',
  'MultiChoiceField',
  'BooleanField',
  'DateField',
  'TimeField',
  'CalculatedField',
  'FormLinkField',
]);

/** Parse schema references without interpreting collection sources as scalar values. */
export function analyzeRepeatableCollections(source, resolver = null, owner = null) {
  const calls = [];
  const issues = [];
  if (!/\bREPEATABLE(?:VALUES|SUM)\b/.test(source || ''))
    return { calls, issues, expression: source, scalarSource: source };
  let tree;
  try {
    tree = parse(source, { ecmaVersion: 'latest', sourceType: 'commonjs' });
  } catch {
    return { calls, issues, expression: source, scalarSource: source };
  }
  const edits = [];
  function visit(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (
      node.type === 'CallExpression' &&
      node.callee?.name === 'EVAL' &&
      node.arguments.some(
        (argument) =>
          argument.type === 'Literal' &&
          typeof argument.value === 'string' &&
          /\bREPEATABLE(?:VALUES|SUM)\s*\(/.test(argument.value)
      )
    )
      issues.push({
        code: 'dynamic_collection_unsupported',
        message: 'Repeatable collection calls inside EVAL are unsupported; use direct calls.',
        index: node.start,
        length: node.end - node.start,
      });
    if (node.type === 'Identifier' && COLLECTION_NAMES.has(node.name)) {
      if (parent?.type !== 'CallExpression' || parent.callee !== node) {
        issues.push({
          code: 'collection_alias_unsupported',
          message: 'Repeatable collection builtins require direct calls.',
          index: node.start,
          length: node.end - node.start,
        });
      } else {
        const [section, target] = parent.arguments;
        const valid =
          parent.arguments.length === 2 &&
          section?.type === 'Identifier' &&
          /^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test(section.name) &&
          target?.type === 'Literal' &&
          typeof target.value === 'string';
        if (!valid) {
          issues.push({
            code: 'invalid_collection_arguments',
            message: `${node.name} requires a direct $repeatable_data_name and a literal target data_name.`,
            index: parent.start,
            length: parent.end - parent.start,
          });
        } else {
          const call = {
            name: node.name,
            section: section.name.slice(1),
            target: target.value,
            index: section.start,
            length: section.end - section.start,
          };
          calls.push(call);
          edits.push({
            start: section.start,
            end: section.end,
            value: JSON.stringify(call.section),
          });
          if (resolver) {
            const info = resolver.repeatableSectionTree.get(call.section);
            const fieldInfo = resolver.fieldOwnership.get(call.target);
            const ownerPath = resolver.getFieldInfo(owner)?.parentPath || [];
            let message = null;
            if (!info) message = `Unknown RepeatableSection '${call.section}'.`;
            else if (
              !fieldInfo ||
              !ContextResolver.pathsEqual(fieldInfo.parentPath, info.currentPath)
            )
              message = `Collection target '${call.target}' must belong to '${call.section}' rows.`;
            else if (!VALUE_TYPES.has(fieldInfo.field.type))
              message = `Collection target type ${fieldInfo.field.type} is unsupported.`;
            else if (
              call.name === 'REPEATABLESUM' &&
              !['NumericField', 'CalculatedField'].includes(fieldInfo.field.type)
            )
              message = 'REPEATABLESUM requires a NumericField or CalculatedField target.';
            else if (
              !ContextResolver.isPrefix(ownerPath, info.parentPath) &&
              !ContextResolver.isPrefix(info.parentPath, ownerPath)
            )
              message = `Collection source '${call.section}' is outside the calculation's record ancestry.`;
            if (message)
              issues.push({
                code: 'invalid_collection_reference',
                message,
                index: parent.start,
                length: parent.end - parent.start,
              });
          }
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value === 'object') visit(value, node);
    }
  }
  visit(tree, null);
  let expression = source;
  let scalarSource = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    expression = expression.slice(0, edit.start) + edit.value + expression.slice(edit.end);
    scalarSource =
      scalarSource.slice(0, edit.start) +
      ' '.repeat(edit.end - edit.start) +
      scalarSource.slice(edit.end);
  }
  return { calls, issues, expression, scalarSource };
}

export function projectCollectionValue(field, value) {
  if (value == null) return ['MultiChoiceField', 'FormLinkField'].includes(field.type) ? [] : null;
  const fail = () => {
    throw new Error(`Malformed collection value for '${field.data_name}'.`);
  };
  if (['SingleChoiceField', 'MultiChoiceField', 'BooleanField'].includes(field.type)) {
    if (typeof value !== 'object' || Array.isArray(value)) return fail();
    const multiple = field.type === 'MultiChoiceField';
    const selections = value[multiple ? 'choices' : 'choice'];
    const others = value.other ?? (field.type === 'BooleanField' ? [] : undefined);
    if (!Array.isArray(selections) || !Array.isArray(others)) return fail();
    if ((field.type === 'BooleanField' || !field.allow_other) && others.length) return fail();
    const allowed = new Set(field.choices.map((choice) => choice.value));
    const projected = selections.map((entry) => {
      if (!entry || !allowed.has(entry.value)) return fail();
      return entry.value;
    });
    for (const entry of others) {
      if (!entry || typeof entry.label !== 'string' || !entry.label.trim()) return fail();
      projected.push(entry.label);
    }
    if (!multiple && projected.length > 1) return fail();
    return multiple ? projected : (projected[0] ?? null);
  }
  if (field.type === 'FormLinkField') {
    if (!Array.isArray(value) || (!field.allow_multiple_records && value.length > 1)) return fail();
    return value.map((entry) => {
      if (!entry || typeof entry.record_id !== 'string' || !entry.record_id.trim()) return fail();
      return { record_id: entry.record_id };
    });
  }
  return value;
}
