import { cloneBuiltinMetadata, BUILTIN_CONTEXTS } from './builtin-metadata.js';

import { IF, IF_METADATA } from './logical/if.js';
import { AND, AND_METADATA } from './logical/and.js';
import { OR, OR_METADATA } from './logical/or.js';
import { COUNT, COUNT_METADATA } from './logical/count.js';
import { COUNTA, COUNTA_METADATA } from './logical/counta.js';
import { COUNTBLANK, COUNTBLANK_METADATA } from './logical/countblank.js';
import { ARRAY, ARRAY_METADATA } from './logical/array.js';
import { SETRESULT, SETRESULT_METADATA, __consumeResult } from './control/setresult.js';
import { EVAL, EVAL_METADATA } from './control/eval.js';
import { CHOICEVALUE, CHOICEVALUE_METADATA } from './choice/choicevalue.js';
import { CHOICELABEL, CHOICELABEL_METADATA } from './choice/choicelabel.js';
import { HASOTHER, HASOTHER_METADATA } from './choice/hasother.js';
import { OTHER, OTHER_METADATA } from './choice/other.js';
import { CHOICEVALUES, CHOICEVALUES_METADATA } from './choice/choicevalues.js';
import { CHOICELABELS, CHOICELABELS_METADATA } from './choice/choicelabels.js';
import { FORM, FORM_METADATA } from './schema/form.js';
import { DATANAMES, DATANAMES_METADATA } from './schema/datanames.js';
import { ABS, ABS_METADATA } from './math/abs.js';
import { CEILING, CEILING_METADATA } from './math/ceiling.js';
import { COS, COS_METADATA } from './math/cos.js';
import { SIN, SIN_METADATA } from './math/sin.js';
import { ROUND, ROUND_METADATA } from './math/round.js';
import { UPPER, UPPER_METADATA } from './string/upper.js';

import { ALERT, ALERT_METADATA } from './event/ui/alert.js';
import { SETVALUE, SETVALUE_METADATA } from './event/field/setvalue.js';
import { ON, ON_METADATA } from './event/control/on.js';
import { OFF, OFF_METADATA } from './event/control/off.js';
import { __consumeEventOperations } from './event/event-operations-collector.js';

export { IF, IF_METADATA } from './logical/if.js';
export { AND, AND_METADATA } from './logical/and.js';
export { OR, OR_METADATA } from './logical/or.js';
export { COUNT, COUNT_METADATA } from './logical/count.js';
export { COUNTA, COUNTA_METADATA } from './logical/counta.js';
export { COUNTBLANK, COUNTBLANK_METADATA } from './logical/countblank.js';
export { ARRAY, ARRAY_METADATA } from './logical/array.js';
export { SETRESULT, SETRESULT_METADATA, __consumeResult } from './control/setresult.js';
export { EVAL, EVAL_METADATA, __setEvalContext, __clearEvalContext } from './control/eval.js';
export { CHOICEVALUE, CHOICEVALUE_METADATA } from './choice/choicevalue.js';
export { CHOICELABEL, CHOICELABEL_METADATA } from './choice/choicelabel.js';
export { HASOTHER, HASOTHER_METADATA } from './choice/hasother.js';
export { OTHER, OTHER_METADATA } from './choice/other.js';
export { CHOICEVALUES, CHOICEVALUES_METADATA } from './choice/choicevalues.js';
export { CHOICELABELS, CHOICELABELS_METADATA } from './choice/choicelabels.js';
export { FORM, FORM_METADATA } from './schema/form.js';
export {
  DATANAMES,
  DATANAMES_METADATA,
  __setDataNamesContext,
  __clearDataNamesContext,
} from './schema/datanames.js';
export { ABS, ABS_METADATA } from './math/abs.js';
export { CEILING, CEILING_METADATA } from './math/ceiling.js';
export { COS, COS_METADATA } from './math/cos.js';
export { SIN, SIN_METADATA } from './math/sin.js';
export { ROUND, ROUND_METADATA } from './math/round.js';
export { UPPER, UPPER_METADATA } from './string/upper.js';

export { ALERT, ALERT_METADATA } from './event/ui/alert.js';
export { SETVALUE, SETVALUE_METADATA } from './event/field/setvalue.js';
export { ON, ON_METADATA } from './event/control/on.js';
export { OFF, OFF_METADATA } from './event/control/off.js';
export { __consumeEventOperations } from './event/event-operations-collector.js';

const CALCULATION_AND_EVENT_ENTRIES = Object.freeze([
  { implementation: IF, definition: IF_METADATA },
  { implementation: AND, definition: AND_METADATA },
  { implementation: OR, definition: OR_METADATA },
  { implementation: COUNT, definition: COUNT_METADATA },
  { implementation: COUNTA, definition: COUNTA_METADATA },
  { implementation: COUNTBLANK, definition: COUNTBLANK_METADATA },
  { implementation: ARRAY, definition: ARRAY_METADATA },
  { implementation: SETRESULT, definition: SETRESULT_METADATA },
  { implementation: EVAL, definition: EVAL_METADATA },
  { implementation: CHOICEVALUE, definition: CHOICEVALUE_METADATA },
  { implementation: CHOICELABEL, definition: CHOICELABEL_METADATA },
  { implementation: HASOTHER, definition: HASOTHER_METADATA },
  { implementation: OTHER, definition: OTHER_METADATA },
  { implementation: CHOICEVALUES, definition: CHOICEVALUES_METADATA },
  { implementation: CHOICELABELS, definition: CHOICELABELS_METADATA },
  { implementation: FORM, definition: FORM_METADATA },
  { implementation: DATANAMES, definition: DATANAMES_METADATA },
  { implementation: ABS, definition: ABS_METADATA },
  { implementation: CEILING, definition: CEILING_METADATA },
  { implementation: COS, definition: COS_METADATA },
  { implementation: SIN, definition: SIN_METADATA },
  { implementation: ROUND, definition: ROUND_METADATA },
  { implementation: UPPER, definition: UPPER_METADATA },
]);

const EVENT_ONLY_ENTRIES = Object.freeze([
  { implementation: ALERT, definition: ALERT_METADATA },
  { implementation: SETVALUE, definition: SETVALUE_METADATA },
  { implementation: ON, definition: ON_METADATA },
  { implementation: OFF, definition: OFF_METADATA },
]);

function buildBuiltinObject(entries) {
  return Object.freeze(
    Object.fromEntries(
      entries.map(({ implementation, definition }) => [definition.name, implementation])
    )
  );
}

function filterDefinitionsByContext(definitions, context) {
  return Object.freeze(definitions.filter((definition) => definition.contexts.includes(context)));
}

export const builtins = buildBuiltinObject(CALCULATION_AND_EVENT_ENTRIES);

export const eventBuiltins = buildBuiltinObject(EVENT_ONLY_ENTRIES);

export const BUILTIN_DEFINITIONS = Object.freeze(
  [...CALCULATION_AND_EVENT_ENTRIES, ...EVENT_ONLY_ENTRIES].map(({ definition }) => definition)
);

export const CALCULATION_BUILTIN_DEFINITIONS = filterDefinitionsByContext(
  BUILTIN_DEFINITIONS,
  BUILTIN_CONTEXTS.CALCULATION
);

export const EVENT_BUILTIN_DEFINITIONS = filterDefinitionsByContext(
  BUILTIN_DEFINITIONS,
  BUILTIN_CONTEXTS.EVENT
);

export const BUILTIN_DEFINITION_BY_NAME = new Map(
  BUILTIN_DEFINITIONS.map((definition) => [definition.name, definition])
);

export function getBuiltinDefinitions() {
  return BUILTIN_DEFINITIONS.map(cloneBuiltinMetadata);
}
