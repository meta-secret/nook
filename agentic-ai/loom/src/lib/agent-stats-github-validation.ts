const VALIDATION_WORKFLOWS = new Set([
  'PR',
  'Rust ecosystem checks',
  'Web research',
]);

export function isValidationWorkflow(workflow: string): boolean {
  return VALIDATION_WORKFLOWS.has(workflow);
}
