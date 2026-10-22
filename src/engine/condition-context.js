import { flattenFields } from '../utilities/field-helpers.js';
import { ContextResolver } from './context-resolver.js';

export const CONDITION_PROPERTIES = [
  'visible_conditions',
  'required_conditions',
  'read_only_conditions',
];

/** Visit every reference, independently of boolean short-circuiting. */
export function forEachConditionReference(conditions, visit) {
  if (Array.isArray(conditions)) {
    conditions.forEach((condition) => forEachConditionReference(condition, visit));
    return;
  }
  if (!conditions || typeof conditions !== 'object') return;
  if (conditions.field_id) visit(conditions);
  if (conditions.and) forEachConditionReference(conditions.and, visit);
  if (conditions.or) forEachConditionReference(conditions.or, visit);
}

/** Engine-private index, built once and shared by all three condition maps. */
export function createConditionContext(schema, contextResolver = null, warningSystem = null) {
  const fields = flattenFields(schema.elements);
  const allFields = Object.create(null);
  for (const field of fields) {
    if (field.key) allFields[field.key] = field;
    if (field.data_name) allFields[field.data_name] = field;
  }
  return {
    fields,
    allFields,
    contextResolver: contextResolver || new ContextResolver(schema),
    warningSystem,
  };
}

export function getConditionReferenceIssues(owner, property, conditions, allFields, resolver) {
  const issues = [];
  const executionContext = {
    type: 'condition',
    fieldName: owner.data_name,
    conditionProperty: property,
    parentPath: [...(resolver.elementOwnership.get(owner.data_name)?.parentPath || [])],
  };
  forEachConditionReference(conditions, (condition) => {
    const reference = condition.field_id;
    const field = allFields[reference];
    if (!field) {
      issues.push({
        reason: 'not_found',
        reference,
        executionContext,
        message: `Condition references unknown field "${reference}" in field "${owner.data_name}"`,
      });
      return;
    }
    const access = resolver.resolveFieldAccessInfo(executionContext, field.data_name);
    if (access.level === 'accessible') return;
    const ownerPath = resolver.formatRepeatableSectionPath(executionContext.parentPath);
    const referencePath = resolver.formatRepeatableSectionPath(access.fieldInfo?.parentPath || []);
    issues.push({
      reason: access.level === 'not_found' ? 'not_found' : 'restricted',
      reference: field.data_name,
      executionContext,
      message: `Field "${owner.data_name}" ${property} references "${reference}" outside its record scope (owner: ${ownerPath}; reference: ${referencePath})`,
    });
  });
  return issues;
}

export function assertConditionReferences(conditions, owner, property, context) {
  const issues = getConditionReferenceIssues(
    owner,
    property,
    conditions,
    context.allFields,
    context.contextResolver
  );
  if (!issues.length) return;
  for (const issue of issues) {
    const warning = context.contextResolver.generateAccessWarning(
      issue.executionContext,
      issue.reference,
      issue.reason
    );
    context.warningSystem?.emitWarning({ ...warning, message: issue.message });
  }
  throw new Error(issues.map((issue) => issue.message).join('\n'));
}
