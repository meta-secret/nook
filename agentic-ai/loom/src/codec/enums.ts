/** Root YAML request kind. Each value is the domain object key. */
export enum RequestKind {
  PrePush = 'prePush',
  CortexAudit = 'cortexAudit',
  SkillScaffold = 'skillScaffold',
  AgentStatsAssemble = 'agentStatsAssemble',
  AgentStatsValidate = 'agentStatsValidate',
  AgentStatsPublish = 'agentStatsPublish',
  PrLandStatus = 'prLandStatus',
  PrLandValidate = 'prLandValidate',
  PrLandReady = 'prLandReady',
  PrLandMergeCheck = 'prLandMergeCheck',
  ToolsList = 'toolsList',
  ToolsCall = 'toolsCall',
}

export enum ResponsePhase {
  Decode = 'decode',
  UnknownRequest = 'unknown-request',
  Request = 'request',
  Execute = 'execute',
}
