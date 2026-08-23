import {
  AgentWorkspacePolicy,
  isValidTaskResourceClaim,
  taskResourcePatternsOverlap,
  TaskTargetKind,
  JoinCompletionPolicy,
} from './domain.ts';

import type {
  StaticAgentWorkflowDefinition,
  TaskOutcomeTarget,
  TaskResourceClaims,
  TaskResourcePatternPair,
} from './domain.ts';
import { materializerWorkflowValidationIssues } from './materializer-validation.ts';
import { allTerminalJoinValidationIssues } from './join-validation.ts';
import type { AllTerminalJoinValidationRequest } from './join-validation.ts';
import {
  WorkflowValidationIssueKind,
  WorkflowValidationStatus,
} from './validation-result.ts';
import {
  taskDefinitionValidationIssues,
  type TaskDefinitionValidationRequest,
} from './task-definition-validation.ts';
import type {
  WorkflowValidation,
  WorkflowValidationIssue,
} from './validation-result.ts';
export {
  WorkflowValidationIssueKind,
  WorkflowValidationStatus,
} from './validation-result.ts';
export type {
  WorkflowValidation,
  WorkflowValidationIssue,
} from './validation-result.ts';

type WorkflowIssueList = WorkflowValidationIssue[];
type WorkflowNameSequence = readonly string[];
type WorkflowNameSet<TName extends string> = ReadonlySet<TName>;
type WorkflowAdjacency = Map<string, Set<string>>;
type WorkflowSchedulingSources = Map<string, Set<string>>;
type WorkflowJoinArrivals = Map<string, Set<string>>;

enum WorkflowOutcomeKind {
  Completed = 'completed',
  Failed = 'failed',
}

type WorkflowTopology = {
  readonly adjacency: WorkflowAdjacency;
  readonly schedulingSources: WorkflowSchedulingSources;
  readonly joinArrivals: WorkflowJoinArrivals;
};

type RegistryNameInspection = {
  readonly registryKind: string;
  readonly declaredNames: WorkflowNameSequence;
  readonly registryNames: WorkflowNameSequence;
  readonly issues: WorkflowIssueList;
};

type WorkflowTargetInspection<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly sourceNode: string;
  readonly sourceTask: TTask;
  readonly outcome: WorkflowOutcomeKind;
  readonly target: TaskOutcomeTarget<TTask, TJoin>;
  readonly taskNames: WorkflowNameSet<TTask>;
  readonly joinNames: WorkflowNameSet<TJoin>;
  readonly topology: WorkflowTopology;
  readonly issues: WorkflowIssueList;
};

type TaskReferenceInspection<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly task: TTask;
  readonly targetInspection: WorkflowTargetInspection<TTask, TAgent, TJoin>;
};

type ParallelTargetInspection<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly tasks: readonly TTask[];
  readonly targetInspection: WorkflowTargetInspection<TTask, TAgent, TJoin>;
};

type JoinReferenceInspection<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly join: TJoin;
  readonly targetInspection: WorkflowTargetInspection<TTask, TAgent, TJoin>;
};

type JoinTargetInspection<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly sourceNode: string;
  readonly target: TaskOutcomeTarget<TTask, TJoin>;
  readonly taskNames: WorkflowNameSet<TTask>;
  readonly joinNames: WorkflowNameSet<TJoin>;
  readonly topology: WorkflowTopology;
  readonly issues: WorkflowIssueList;
};

type JoinArrivalInspection<TTask extends string, TJoin extends string> = {
  readonly join: TJoin;
  readonly arrivals: readonly TTask[];
  readonly taskNames: WorkflowNameSet<TTask>;
  readonly topology: WorkflowTopology;
  readonly issues: WorkflowIssueList;
};

type WorkflowEdge = { readonly from: string; readonly to: string };
type WorkflowEdgeRegistration = {
  readonly edge: WorkflowEdge;
  readonly adjacency: WorkflowAdjacency;
};
type WorkflowNodeRegistration = {
  readonly node: string;
  readonly adjacency: WorkflowAdjacency;
};
type TaskSchedulingSource = {
  readonly task: string;
  readonly sourceNode: string;
};
type TaskSchedulingRegistration = {
  readonly scheduling: TaskSchedulingSource;
  readonly schedulingSources: WorkflowSchedulingSources;
};

type ResourceConflictInspection = {
  readonly leftTask: string;
  readonly leftResources: TaskResourceClaims;
  readonly rightTask: string;
  readonly rightResources: TaskResourceClaims;
  readonly issues: WorkflowIssueList;
};
type ResourceClaimComparison = {
  readonly first: readonly string[];
  readonly second: readonly string[];
};
type ResourceClaimValidation = {
  readonly task: string;
  readonly resources: TaskResourceClaims;
  readonly issues: WorkflowIssueList;
};
type ResourceConcurrencyInspection<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly registeredTasks: ReadonlySet<string>;
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
  readonly issues: WorkflowIssueList;
};
type OutcomeDescendantInspection<TTask extends string, TJoin extends string> = {
  readonly target: TaskOutcomeTarget<TTask, TJoin>;
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
};
type OutcomeExclusivityInspection<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly leftTask: TTask;
  readonly rightTask: TTask;
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
};

type DuplicateSchedulingInspection<TTask extends string> = {
  readonly entry: TTask;
  readonly schedulingSources: ReadonlyMap<string, ReadonlySet<string>>;
  readonly issues: WorkflowIssueList;
};
type JoinEdgeInspection<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly observedArrivals: ReadonlyMap<string, ReadonlySet<string>>;
  readonly issues: WorkflowIssueList;
};
type WorkflowCycleInspection = {
  readonly nodes: WorkflowNameSequence;
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
};
type WorkflowReachabilityInspection = {
  readonly entry: string;
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
};

export function validateStaticAgentWorkflow<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>,
): WorkflowValidation {
  const issues: WorkflowIssueList = [];
  const registryTaskNames = Object.keys(workflow.tasks);
  const registryAgentNames = Object.keys(workflow.agents);
  const registryJoinNames = Object.keys(workflow.joins);
  const registryTaskNameSet = new Set(registryTaskNames);
  const registryAgentNameSet = new Set(registryAgentNames);
  const registryJoinNameSet = new Set(registryJoinNames);
  const taskNames = new Set(workflow.taskNames);
  const joinNames = new Set(workflow.joinNames);

  const taskRegistryInspection: RegistryNameInspection = {
    registryKind: 'task',
    declaredNames: workflow.taskNames,
    registryNames: registryTaskNames,
    issues,
  };
  inspectRegistryNames(taskRegistryInspection);
  const agentRegistryInspection: RegistryNameInspection = {
    registryKind: 'agent',
    declaredNames: workflow.agentNames,
    registryNames: registryAgentNames,
    issues,
  };
  inspectRegistryNames(agentRegistryInspection);
  const joinRegistryInspection: RegistryNameInspection = {
    registryKind: 'join',
    declaredNames: workflow.joinNames,
    registryNames: registryJoinNames,
    issues,
  };
  inspectRegistryNames(joinRegistryInspection);

  if (
    !taskNames.has(workflow.entry) ||
    !registryTaskNameSet.has(workflow.entry)
  ) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidEntry,
      message: `entry task does not exist: ${workflow.entry}`,
    };
    issues.push(issue);
  }

  const topology: WorkflowTopology = {
    adjacency: new Map(),
    schedulingSources: new Map(),
    joinArrivals: new Map(),
  };

  for (const taskName of workflow.taskNames) {
    if (!registryTaskNameSet.has(taskName)) continue;
    const task = workflow.tasks[taskName];
    const taskRegistration: WorkflowNodeRegistration = {
      node: taskNode(taskName),
      adjacency: topology.adjacency,
    };
    ensureNode(taskRegistration);
    const taskDefinitionRequest: TaskDefinitionValidationRequest<
      TTask,
      TAgent,
      TJoin
    > = {
      agentNames: workflow.agentNames,
      registeredAgentNames: registryAgentNameSet,
      task,
      taskName,
    };
    issues.push(...taskDefinitionValidationIssues(taskDefinitionRequest));
    const claimValidation: ResourceClaimValidation = {
      task: taskName,
      resources: task.resources,
      issues,
    };
    inspectResourceClaims(claimValidation);
    const completedInspection: WorkflowTargetInspection<TTask, TAgent, TJoin> =
      {
        workflow,
        sourceNode: taskNode(taskName),
        sourceTask: taskName,
        outcome: WorkflowOutcomeKind.Completed,
        target: task.completed,
        taskNames,
        joinNames,
        topology,
        issues,
      };
    inspectTaskTarget(completedInspection);
    const failedInspection: WorkflowTargetInspection<TTask, TAgent, TJoin> = {
      workflow,
      sourceNode: taskNode(taskName),
      sourceTask: taskName,
      outcome: WorkflowOutcomeKind.Failed,
      target: task.failed,
      taskNames,
      joinNames,
      topology,
      issues,
    };
    inspectTaskTarget(failedInspection);
  }

  for (const agentName of workflow.agentNames) {
    if (!registryAgentNameSet.has(agentName)) continue;
    const agent = workflow.agents[agentName];
    if (agent.name !== agentName) {
      const issue: WorkflowValidationIssue = {
        kind: WorkflowValidationIssueKind.RegistryMismatch,
        message: `agent registry key ${agentName} contains definition ${agent.name}`,
      };
      issues.push(issue);
    }
    if (agent.workspacePolicy !== AgentWorkspacePolicy.ReadOnly) {
      const issue: WorkflowValidationIssue = {
        kind: WorkflowValidationIssueKind.UnsupportedCapability,
        message: `agent ${agentName} requests write access, which is not enabled for static workflows`,
      };
      issues.push(issue);
    }
  }

  for (const joinName of workflow.joinNames) {
    if (!registryJoinNameSet.has(joinName)) continue;
    const join = workflow.joins[joinName];
    const joinNodeName = joinNode(joinName);
    const joinRegistration: WorkflowNodeRegistration = {
      node: joinNodeName,
      adjacency: topology.adjacency,
    };
    ensureNode(joinRegistration);
    if (join.name !== joinName) {
      const issue: WorkflowValidationIssue = {
        kind: WorkflowValidationIssueKind.RegistryMismatch,
        message: `join registry key ${joinName} contains definition ${join.name}`,
      };
      issues.push(issue);
    }
    const arrivalInspection: JoinArrivalInspection<TTask, TJoin> = {
      join: joinName,
      arrivals: join.arrivals,
      taskNames,
      topology,
      issues,
    };
    inspectJoinArrivals(arrivalInspection);
    const joinValidationRequest: AllTerminalJoinValidationRequest<
      TTask,
      TAgent,
      TJoin
    > = {
      workflow,
      join: joinName,
    };
    issues.push(...allTerminalJoinValidationIssues(joinValidationRequest));
    const targetInspection: JoinTargetInspection<TTask, TAgent, TJoin> = {
      workflow,
      sourceNode: joinNodeName,
      target: join.completed,
      taskNames,
      joinNames,
      topology,
      issues,
    };
    inspectJoinTarget(targetInspection);
  }

  const materializerRequest = {
    workflow,
    declaredTaskNames: taskNames,
    registryTaskNames: registryTaskNameSet,
    adjacency: topology.adjacency,
    taskNode,
  };
  issues.push(...materializerWorkflowValidationIssues(materializerRequest));

  const duplicateInspection: DuplicateSchedulingInspection<TTask> = {
    entry: workflow.entry,
    schedulingSources: topology.schedulingSources,
    issues,
  };
  inspectDuplicateScheduling(duplicateInspection);
  const joinEdgeInspection: JoinEdgeInspection<TTask, TAgent, TJoin> = {
    workflow,
    observedArrivals: topology.joinArrivals,
    issues,
  };
  inspectJoinEdges(joinEdgeInspection);
  const concurrencyInspection: ResourceConcurrencyInspection<
    TTask,
    TAgent,
    TJoin
  > = {
    workflow,
    registeredTasks: registryTaskNameSet,
    adjacency: topology.adjacency,
    issues,
  };
  inspectConcurrentResourceConflicts(concurrencyInspection);

  const allNodes: string[] = [
    ...workflow.taskNames.map((task) => taskNode(task)),
    ...workflow.joinNames.map((join) => joinNode(join)),
  ];
  const cycleInspection: WorkflowCycleInspection = {
    nodes: allNodes,
    adjacency: topology.adjacency,
  };
  if (containsCycle(cycleInspection)) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.Cycle,
      message: 'workflow graph contains a cycle',
    };
    issues.push(issue);
  }
  if (
    taskNames.has(workflow.entry) &&
    registryTaskNameSet.has(workflow.entry)
  ) {
    const reachabilityInspection: WorkflowReachabilityInspection = {
      entry: taskNode(workflow.entry),
      adjacency: topology.adjacency,
    };
    const reachable = collectReachableNodes(reachabilityInspection);
    for (const node of allNodes) {
      if (!reachable.has(node)) {
        const issue: WorkflowValidationIssue = {
          kind: WorkflowValidationIssueKind.UnreachableNode,
          message: `workflow node is unreachable from the entry: ${node}`,
        };
        issues.push(issue);
      }
    }
  }

  return issues.length === 0
    ? { status: WorkflowValidationStatus.Valid }
    : { status: WorkflowValidationStatus.Invalid, issues };
}

function inspectRegistryNames(inspection: RegistryNameInspection): void {
  const declared = new Set(inspection.declaredNames);
  const registry = new Set(inspection.registryNames);
  if (declared.size !== inspection.declaredNames.length) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.DuplicateRegistryName,
      message: `${inspection.registryKind} name list contains duplicates`,
    };
    inspection.issues.push(issue);
  }
  for (const name of declared) {
    if (!registry.has(name)) {
      const issue: WorkflowValidationIssue = {
        kind: WorkflowValidationIssueKind.RegistryMismatch,
        message: `${inspection.registryKind} name is missing from its registry: ${name}`,
      };
      inspection.issues.push(issue);
    }
  }
  for (const name of registry) {
    if (!declared.has(name)) {
      const issue: WorkflowValidationIssue = {
        kind: WorkflowValidationIssueKind.RegistryMismatch,
        message: `${inspection.registryKind} registry entry is missing from its name list: ${name}`,
      };
      inspection.issues.push(issue);
    }
  }
}

function inspectTaskTarget<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(inspection: WorkflowTargetInspection<TTask, TAgent, TJoin>): void {
  switch (inspection.target.kind) {
    case TaskTargetKind.None:
      return;
    case TaskTargetKind.Task: {
      const request: TaskReferenceInspection<TTask, TAgent, TJoin> = {
        task: inspection.target.task,
        targetInspection: inspection,
      };
      inspectTaskReference(request);
      return;
    }
    case TaskTargetKind.Parallel: {
      const request: ParallelTargetInspection<TTask, TAgent, TJoin> = {
        tasks: inspection.target.tasks,
        targetInspection: inspection,
      };
      inspectParallelTarget(request);
      return;
    }
    case TaskTargetKind.Join: {
      const request: JoinReferenceInspection<TTask, TAgent, TJoin> = {
        join: inspection.target.join,
        targetInspection: inspection,
      };
      inspectJoinReference(request);
    }
  }
}

function inspectTaskReference<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(inspection: TaskReferenceInspection<TTask, TAgent, TJoin>): void {
  const target = inspection.targetInspection;
  if (!target.taskNames.has(inspection.task)) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidReference,
      message: `task ${target.sourceTask} references missing task ${inspection.task}`,
    };
    target.issues.push(issue);
    return;
  }
  const edge: WorkflowEdge = {
    from: target.sourceNode,
    to: taskNode(inspection.task),
  };
  const edgeRegistration: WorkflowEdgeRegistration = {
    edge,
    adjacency: target.topology.adjacency,
  };
  addEdge(edgeRegistration);
  const scheduling: TaskSchedulingSource = {
    task: inspection.task,
    sourceNode: target.sourceNode,
  };
  const schedulingRegistration: TaskSchedulingRegistration = {
    scheduling,
    schedulingSources: target.topology.schedulingSources,
  };
  recordSchedulingSource(schedulingRegistration);
}

function inspectParallelTarget<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(inspection: ParallelTargetInspection<TTask, TAgent, TJoin>): void {
  const target = inspection.targetInspection;
  if (inspection.tasks.length === 0) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidParallelTarget,
      message: `task ${target.sourceTask} has an empty parallel target`,
    };
    target.issues.push(issue);
    return;
  }
  if (new Set(inspection.tasks).size !== inspection.tasks.length) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidParallelTarget,
      message: `task ${target.sourceTask} has duplicate parallel targets`,
    };
    target.issues.push(issue);
  }
  for (const task of inspection.tasks) {
    const reference: TaskReferenceInspection<TTask, TAgent, TJoin> = {
      task,
      targetInspection: target,
    };
    inspectTaskReference(reference);
  }
}

function inspectJoinReference<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(inspection: JoinReferenceInspection<TTask, TAgent, TJoin>): void {
  const target = inspection.targetInspection;
  const join = target.workflow.joins[inspection.join];
  if (
    target.outcome === WorkflowOutcomeKind.Failed &&
    join?.policy !== JoinCompletionPolicy.AllTerminal
  ) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidJoin,
      message: `failed outcome from ${target.sourceTask} cannot arrive at all-completed join ${inspection.join}`,
    };
    target.issues.push(issue);
  }
  if (!target.joinNames.has(inspection.join)) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidReference,
      message: `task ${target.sourceTask} references missing join ${inspection.join}`,
    };
    target.issues.push(issue);
    return;
  }
  const edge: WorkflowEdge = {
    from: target.sourceNode,
    to: joinNode(inspection.join),
  };
  const registration: WorkflowEdgeRegistration = {
    edge,
    adjacency: target.topology.adjacency,
  };
  addEdge(registration);
  if (
    target.outcome === WorkflowOutcomeKind.Completed ||
    join?.policy === JoinCompletionPolicy.AllTerminal
  ) {
    const arrivals = target.topology.joinArrivals.get(inspection.join);
    if (arrivals) {
      arrivals.add(target.sourceTask);
    } else {
      target.topology.joinArrivals.set(
        inspection.join,
        new Set([target.sourceTask]),
      );
    }
  }
}

function inspectJoinArrivals<TTask extends string, TJoin extends string>(
  inspection: JoinArrivalInspection<TTask, TJoin>,
): void {
  if (
    inspection.arrivals.length === 0 ||
    new Set(inspection.arrivals).size !== inspection.arrivals.length
  ) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidJoin,
      message: `join ${inspection.join} must declare a non-empty unique arrival list`,
    };
    inspection.issues.push(issue);
  }
  for (const arrival of inspection.arrivals) {
    if (!inspection.taskNames.has(arrival)) {
      const issue: WorkflowValidationIssue = {
        kind: WorkflowValidationIssueKind.InvalidReference,
        message: `join ${inspection.join} references missing arrival task ${arrival}`,
      };
      inspection.issues.push(issue);
    }
  }
  const registration: WorkflowNodeRegistration = {
    node: joinNode(inspection.join),
    adjacency: inspection.topology.adjacency,
  };
  ensureNode(registration);
}

function inspectJoinTarget<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(inspection: JoinTargetInspection<TTask, TAgent, TJoin>): void {
  if (inspection.target.kind === TaskTargetKind.Join) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidJoin,
      message: `join-to-join routing is not supported: ${inspection.sourceNode} targets ${inspection.target.join}`,
    };
    inspection.issues.push(issue);
    return;
  }
  const pseudoTaskInspection: WorkflowTargetInspection<TTask, TAgent, TJoin> = {
    workflow: inspection.workflow,
    sourceNode: inspection.sourceNode,
    sourceTask: inspection.workflow.entry,
    outcome: WorkflowOutcomeKind.Completed,
    target: inspection.target,
    taskNames: inspection.taskNames,
    joinNames: inspection.joinNames,
    topology: inspection.topology,
    issues: inspection.issues,
  };
  inspectTaskTarget(pseudoTaskInspection);
}

function inspectResourceConflict(inspection: ResourceConflictInspection): void {
  const comparisons: readonly ResourceClaimComparison[] = [
    {
      first: inspection.leftResources.write,
      second: inspection.rightResources.write,
    },
    {
      first: inspection.leftResources.write,
      second: inspection.rightResources.read,
    },
    {
      first: inspection.rightResources.write,
      second: inspection.leftResources.read,
    },
  ];
  if (comparisons.some((comparison) => claimSequencesOverlap(comparison))) {
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.ResourceConflict,
      message: `potentially concurrent tasks ${inspection.leftTask} and ${inspection.rightTask} have conflicting resource claims`,
    };
    inspection.issues.push(issue);
  }
}

function claimSequencesOverlap(comparison: ResourceClaimComparison): boolean {
  return comparison.first.some((first) =>
    comparison.second.some((second) => {
      const patterns: TaskResourcePatternPair = { first, second };
      return taskResourcePatternsOverlap(patterns);
    }),
  );
}

function inspectResourceClaims(validation: ResourceClaimValidation): void {
  for (const claim of [
    ...validation.resources.read,
    ...validation.resources.write,
  ]) {
    if (isValidTaskResourceClaim(claim)) continue;
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidResourceClaim,
      message: `task ${validation.task} has unsupported resource claim: ${claim}`,
    };
    validation.issues.push(issue);
  }
}

function inspectConcurrentResourceConflicts<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(inspection: ResourceConcurrencyInspection<TTask, TAgent, TJoin>): void {
  for (const [index, leftTask] of inspection.workflow.taskNames.entries()) {
    if (!inspection.registeredTasks.has(leftTask)) continue;
    for (const rightTask of inspection.workflow.taskNames.slice(index + 1)) {
      if (!inspection.registeredTasks.has(rightTask)) continue;
      const forwardPath: WorkflowPathInspection = {
        from: taskNode(leftTask),
        to: taskNode(rightTask),
        adjacency: inspection.adjacency,
      };
      const reversePath: WorkflowPathInspection = {
        from: taskNode(rightTask),
        to: taskNode(leftTask),
        adjacency: inspection.adjacency,
      };
      const ordered = hasPath(forwardPath) || hasPath(reversePath);
      if (ordered) continue;
      const exclusivity: OutcomeExclusivityInspection<TTask, TAgent, TJoin> = {
        workflow: inspection.workflow,
        leftTask,
        rightTask,
        adjacency: inspection.adjacency,
      };
      if (tasksAreOutcomeExclusive(exclusivity)) continue;
      const conflict: ResourceConflictInspection = {
        leftTask,
        leftResources: inspection.workflow.tasks[leftTask].resources,
        rightTask,
        rightResources: inspection.workflow.tasks[rightTask].resources,
        issues: inspection.issues,
      };
      inspectResourceConflict(conflict);
    }
  }
}

function tasksAreOutcomeExclusive<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(inspection: OutcomeExclusivityInspection<TTask, TAgent, TJoin>): boolean {
  const leftNode = taskNode(inspection.leftTask);
  const rightNode = taskNode(inspection.rightTask);
  for (const sourceTask of inspection.workflow.taskNames) {
    const source = inspection.workflow.tasks[sourceTask];
    if (!source) continue;
    const completedInspection: OutcomeDescendantInspection<TTask, TJoin> = {
      target: source.completed,
      adjacency: inspection.adjacency,
    };
    const failedInspection: OutcomeDescendantInspection<TTask, TJoin> = {
      target: source.failed,
      adjacency: inspection.adjacency,
    };
    const completedDescendants = collectOutcomeDescendants(completedInspection);
    const failedDescendants = collectOutcomeDescendants(failedInspection);
    const leftCompletedRightFailed =
      completedDescendants.has(leftNode) &&
      !failedDescendants.has(leftNode) &&
      failedDescendants.has(rightNode) &&
      !completedDescendants.has(rightNode);
    const leftFailedRightCompleted =
      failedDescendants.has(leftNode) &&
      !completedDescendants.has(leftNode) &&
      completedDescendants.has(rightNode) &&
      !failedDescendants.has(rightNode);
    if (leftCompletedRightFailed || leftFailedRightCompleted) return true;
  }
  return false;
}

function collectOutcomeDescendants<TTask extends string, TJoin extends string>(
  inspection: OutcomeDescendantInspection<TTask, TJoin>,
): ReadonlySet<string> {
  const descendants = new Set<string>();
  for (const node of targetNodes(inspection.target)) {
    const reachability: WorkflowReachabilityInspection = {
      entry: node,
      adjacency: inspection.adjacency,
    };
    for (const descendant of collectReachableNodes(reachability)) {
      descendants.add(descendant);
    }
  }
  return descendants;
}

function targetNodes<TTask extends string, TJoin extends string>(
  target: TaskOutcomeTarget<TTask, TJoin>,
): readonly string[] {
  switch (target.kind) {
    case TaskTargetKind.None:
      return [];
    case TaskTargetKind.Task:
      return [taskNode(target.task)];
    case TaskTargetKind.Parallel:
      return target.tasks.map((task) => taskNode(task));
    case TaskTargetKind.Join:
      return [joinNode(target.join)];
  }
}

type WorkflowPathInspection = {
  readonly from: string;
  readonly to: string;
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
};
function hasPath(inspection: WorkflowPathInspection): boolean {
  const reachability: WorkflowReachabilityInspection = {
    entry: inspection.from,
    adjacency: inspection.adjacency,
  };
  return collectReachableNodes(reachability).has(inspection.to);
}

function inspectDuplicateScheduling<TTask extends string>(
  inspection: DuplicateSchedulingInspection<TTask>,
): void {
  for (const [task, sources] of inspection.schedulingSources) {
    if (task === inspection.entry || sources.size > 1) {
      const issue: WorkflowValidationIssue = {
        kind: WorkflowValidationIssueKind.DuplicateScheduling,
        message:
          task === inspection.entry
            ? `entry task ${task} is also scheduled by a graph edge`
            : `task ${task} has multiple scheduling sources: ${[...sources].join(', ')}`,
      };
      inspection.issues.push(issue);
    }
  }
}

function inspectJoinEdges<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(inspection: JoinEdgeInspection<TTask, TAgent, TJoin>): void {
  for (const joinName of inspection.workflow.joinNames) {
    const join = inspection.workflow.joins[joinName];
    if (!join) continue;
    const declared: ReadonlySet<string> = new Set(join.arrivals);
    const observedCandidate = inspection.observedArrivals.get(joinName);
    const observed: ReadonlySet<string> = observedCandidate
      ? observedCandidate
      : new Set();
    for (const task of declared) {
      if (!observed.has(task)) {
        const issue: WorkflowValidationIssue = {
          kind: WorkflowValidationIssueKind.InvalidJoin,
          message: `join ${joinName} declares arrival ${task} without a completed edge to that join`,
        };
        inspection.issues.push(issue);
      }
    }
    for (const task of observed) {
      if (!declared.has(task)) {
        const issue: WorkflowValidationIssue = {
          kind: WorkflowValidationIssueKind.InvalidJoin,
          message: `task ${task} arrives at join ${joinName} but is not declared by that join`,
        };
        inspection.issues.push(issue);
      }
    }
  }
}

function addEdge(registration: WorkflowEdgeRegistration): void {
  const fromRegistration: WorkflowNodeRegistration = {
    node: registration.edge.from,
    adjacency: registration.adjacency,
  };
  ensureNode(fromRegistration);
  const toRegistration: WorkflowNodeRegistration = {
    node: registration.edge.to,
    adjacency: registration.adjacency,
  };
  ensureNode(toRegistration);
  const successors = registration.adjacency.get(registration.edge.from);
  if (successors) successors.add(registration.edge.to);
}

function ensureNode(registration: WorkflowNodeRegistration): void {
  if (!registration.adjacency.has(registration.node)) {
    registration.adjacency.set(registration.node, new Set());
  }
}

function recordSchedulingSource(
  registration: TaskSchedulingRegistration,
): void {
  const sources = registration.schedulingSources.get(
    registration.scheduling.task,
  );
  if (sources) {
    sources.add(registration.scheduling.sourceNode);
  } else {
    registration.schedulingSources.set(
      registration.scheduling.task,
      new Set([registration.scheduling.sourceNode]),
    );
  }
}

function containsCycle(inspection: WorkflowCycleInspection): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    const successors = inspection.adjacency.get(node);
    if (successors) {
      for (const successor of successors) {
        if (visit(successor)) return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  return inspection.nodes.some((node) => visit(node));
}

function collectReachableNodes(
  inspection: WorkflowReachabilityInspection,
): ReadonlySet<string> {
  const reachable = new Set<string>();
  function visit(node: string): void {
    if (reachable.has(node)) return;
    reachable.add(node);
    const successors = inspection.adjacency.get(node);
    if (successors) {
      for (const successor of successors) visit(successor);
    }
  }
  visit(inspection.entry);
  return reachable;
}

function taskNode(task: string): string {
  return `task:${task}`;
}

function joinNode(join: string): string {
  return `join:${join}`;
}
