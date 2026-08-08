/** Root YAML request family. Top-level domain object keys. */
export enum RequestFamily {
  PrePush = 'prePush',
  CortexAudit = 'cortexAudit',
  SkillScaffold = 'skillScaffold',
  AgentStats = 'agentStats',
  PrLand = 'prLand',
  ToolsList = 'toolsList',
  ToolsCall = 'toolsCall',
}

export enum AgentStatsOperation {
  Assemble = 'assemble',
  Validate = 'validate',
  Publish = 'publish',
}

export enum PrLandOperation {
  Status = 'status',
  Validate = 'validate',
  Ready = 'ready',
  MergeCheck = 'mergeCheck',
}

export enum ResponsePhase {
  Decode = 'decode',
  UnknownRequest = 'unknown-request',
  Request = 'request',
  Execute = 'execute',
}
