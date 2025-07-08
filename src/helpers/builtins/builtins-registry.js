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