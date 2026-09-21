/** Root YAML request family. Top-level domain object keys. */
export enum RequestFamily {
  /** @deprecated Retained for decoding old requests; execution is retired. */
  PrePush = 'prePush',
  CortexAudit = 'cortexAudit',
  CortexSessionClean = 'cortexSessionClean',
  SkillScaffold = 'skillScaffold',
  DependencyPopularity = 'dependencyPopularity',
  ToolsList = 'toolsList',
  ToolsCall = 'toolsCall',
}

export enum ResponsePhase {
  Decode = 'decode',
  UnknownRequest = 'unknown-request',
  Request = 'request',
  Execute = 'execute',
}
