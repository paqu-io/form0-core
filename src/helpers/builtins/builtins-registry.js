// Import all builtins
import { IF } from './logical/if.js';
import { AND } from './logical/and.js';
import { OR } from './logical/or.js';
import { SETRESULT, __consumeResult } from './control/setresult.js';
import { CHOICEVALUE } from './choice/choicevalue.js';
import { CHOICELABEL } from './choice/choicelabel.js';
import { HASOTHER } from './choice/hasother.js';
import { OTHER } from './choice/other.js';
import { CHOICEVALUES } from './choice/choicevalues.js';
import { CHOICELABELS } from './choice/choicelabels.js';

// Import event builtins
import { ALERT } from './event/ui/alert.js';
import { __consumeEventOperations } from './event/event-operations-collector.js';

// Export individual builtins
export { IF } from './logical/if.js';
export { AND } from './logical/and.js';
export { OR } from './logical/or.js';
export { SETRESULT, __consumeResult } from './control/setresult.js';
export { CHOICEVALUE } from './choice/choicevalue.js';
export { CHOICELABEL } from './choice/choicelabel.js';
export { HASOTHER } from './choice/hasother.js';
export { OTHER } from './choice/other.js';
export { CHOICEVALUES } from './choice/choicevalues.js';
export { CHOICELABELS } from './choice/choicelabels.js';

// Export event builtins
export { ALERT } from './event/ui/alert.js';
export { __consumeEventOperations } from './event/event-operations-collector.js';

// Main builtins object for backward compatibility
export const builtins = {
  IF,
  AND,
  OR,
  SETRESULT,
  CHOICEVALUE,
  CHOICELABEL,
  HASOTHER,
  OTHER,
  CHOICEVALUES,
  CHOICELABELS,
}; 

// Event-specific builtins (only available in event context)
export const eventBuiltins = {
  ALERT,
  // Future: CONFIRM, NOTIFY, SETFIELD, etc.
};