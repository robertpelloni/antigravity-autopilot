/**
 * Re-organized dependency checking service - main entry point
 */
import { DependencyCheckResult, DependencyCheckResults } from './types';
import { runDependencyCheck } from './main';
import { showDependencyStatus } from './status';

// Re-export types for backward compatibility
export type { DependencyCheckResult, DependencyCheckResults } from './types';

// Re-export main functions
export { runDependencyCheck } from './main';
export { showDependencyStatus } from './status';