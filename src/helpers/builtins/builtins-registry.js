// Import all builtins
import { IF } from './logical/if.js';
import { AND } from './logical/and.js';
import { OR } from './logical/or.js';
import { SETRESULT, __consumeResult } from './control/setresult.js';

// Export individual builtins
export { IF } from './logical/if.js';
export { AND } from './logical/and.js';
export { OR } from './logical/or.js';
export { SETRESULT, __consumeResult } from './control/setresult.js';

// Main builtins object for backward compatibility
export const builtins = {
  IF,
  AND,
  OR,
  SETRESULT,
}; 