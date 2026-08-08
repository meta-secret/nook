export enum AgentStatsAction {
  Assemble = 'assemble',
  Validate = 'validate',
  Publish = 'publish',
}

export enum PrLandAction {
  Status = 'status',
  Validate = 'validate',
  Ready = 'ready',
  MergeCheck = 'merge-check',
}

export enum ResponsePhase {
  Decode = 'decode',
  UnknownTool = 'unknown-tool',
  Arguments = 'arguments',
  Execute = 'execute',
}

export enum ToolName {
  ToolsList = 'tools-list',
  ToolsCall = 'tools-call',
  PrePush = 'pre-push',
  CortexAudit = 'cortex-audit',
  SkillScaffold = 'skill-scaffold',
  AgentStats = 'agent-stats',
  PrLand = 'pr-land',
}
