import { executableSkillWorkflowMinimumTimeoutMs } from '../executable-skills/budgets.ts';
import { MAXIMUM_REGISTERED_EXECUTABLE_SKILL_TIMEOUT_MS } from '../executable-skills/registry.ts';

export const MECHANICAL_CORTEX_AUDIT_MINIMUM_TIMEOUT_MS =
  executableSkillWorkflowMinimumTimeoutMs(
    MAXIMUM_REGISTERED_EXECUTABLE_SKILL_TIMEOUT_MS,
  );
