import { ContextResolver } from './context-resolver.js';
import { expandBuildingPlanSchema } from '../schema/building-plan-expander.js';
import { validateSchemaWithContext } from '../schema/schema-validator.js';
import { buildCalculationDependencyPlan } from '../utilities/calculation-dependencies.js';
import { analyzeRepeatableCollections } from '../utilities/repeatable-collections.js';
import { createConditionContext } from './condition-context.js';
import { copyRecordData } from '../utilities/record-data.js';

/** Shared immutable schema preparation; never owns live row engines. */
export function prepareRecordContext(inputSchema, warningSystem = null) {
  const sourceSchema = copyRecordData(inputSchema);
  const { schema } = expandBuildingPlanSchema(sourceSchema);
  const resolver = new ContextResolver(schema.form);
  validateSchemaWithContext(schema.form, resolver);
  const calculationPlan = buildCalculationDependencyPlan(schema.form, resolver);
  const conditionContext = createConditionContext(schema.form, resolver, warningSystem);
  const templates = new Map();
  const repeatableByPath = new Map(
    [...resolver.repeatableSectionTree.values()].map((entry) => [
      JSON.stringify(entry.currentPath),
      entry,
    ])
  );
  const calculations = new Map();
  for (const [name, node] of calculationPlan.nodesByDataName) {
    calculations.set(name, {
      ...node,
      collection: analyzeRepeatableCollections(node.field.calculate, resolver, name),
    });
  }
  function template(elements, path) {
    const fields = [];
    const chains = new Map();
    function project(items, ancestors = []) {
      return items.map((field) => {
        fields.push(field);
        chains.set(field.data_name, ancestors);
        if (field.type === 'RepeatableSection') {
          const key = resolver.repeatableSectionTree.get(field.data_name).preferredKey;
          template(field.elements || [], [...path, key]);
          return { ...field, elements: [] };
        }
        if (field.type === 'Section' || field.type === 'BuildingPlanSection')
          return {
            ...field,
            elements: project(field.elements || [], [...ancestors, field.data_name]),
          };
        return field;
      });
    }
    const localForm = { elements: project(elements) };
    const status = path.length === 0 ? schema.form.status_field : null;
    if (status?.enabled) {
      fields.push(status);
      chains.set(status.data_name, []);
    }
    const result = {
      path,
      fields,
      chains,
      form: localForm,
      conditions: { ...conditionContext, fields },
    };
    templates.set(JSON.stringify(path), result);
    return result;
  }
  template(schema.form.elements, []);
  return {
    schema,
    sourceSchema,
    resolver,
    calculationPlan,
    templates,
    calculations,
    repeatableByPath,
  };
}

export function visitRecordScopes(snapshot, context, visit) {
  for (const scope of iterateRecordScopes(snapshot, context)) visit(scope);
}

/** Same traversal for synchronous validation and budgeted private-tree preparation. */
export function* iterateRecordScopes(snapshot, context) {
  function* walk(record, path, instancePath, ancestors, participating) {
    const template = context.templates.get(JSON.stringify(path));
    const scope = { record, template, instancePath, ancestors, participating };
    yield scope;
    for (const field of template.fields) {
      if (field.type !== 'RepeatableSection') continue;
      const info = context.resolver.repeatableSectionTree.get(field.data_name);
      const rows = record.repeatable?.[info.preferredKey] ?? [];
      if (!Array.isArray(rows))
        throw new Error(`RepeatableSection '${field.data_name}' must contain an array of rows.`);
      const identities = new Set();
      for (let index = 0; index < rows.length; index++) {
        if (!(index in rows)) continue;
        const row = rows[index];
        if (!row || typeof row !== 'object' || Array.isArray(row))
          throw new Error('Repeatable rows must be record objects.');
        const id = row.id ?? row.record_id;
        const identified =
          (typeof id === 'string' && id.trim() !== '') ||
          (typeof id === 'number' && Number.isFinite(id));
        if (identified) {
          const identity = `${typeof id}:${id}`;
          if (identities.has(identity))
            throw new Error(`Duplicate row identity in '${field.data_name}'.`);
          identities.add(identity);
        }
        const segment = {
          repeatableKey: info.preferredKey,
          instanceId: identified ? id : null,
          index,
          identity: identified ? 'id' : 'position',
        };
        const visible =
          record.visible?.[field.data_name] !== false &&
          (template.chains.get(field.data_name) || []).every(
            (name) => record.visible?.[name] !== false
          );
        yield* walk(
          row,
          info.currentPath,
          [...instancePath, segment],
          [...ancestors, scope],
          participating && visible
        );
      }
    }
  }
  yield* walk(snapshot, [], [], [], true);
}
