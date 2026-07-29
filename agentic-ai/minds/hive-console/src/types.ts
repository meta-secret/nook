export type ObserverCopy = {
  product_name: string;
  product_description: string;
  overview: string;
  workers: string;
  queue: string;
  needs_attention: string;
  recent_activity: string;
  all_tasks: string;
  search_tasks: string;
  no_tasks: string;
  no_tasks_description: string;
  no_search_results: string;
  no_search_results_description: string;
  no_attention: string;
  no_attention_description: string;
  task_details: string;
  trigger: string;
  source_revision: string;
  current_attempt: string;
  dependencies: string;
  timeline: string;
  no_activity: string;
  no_dependencies: string;
  attempt: string;
  last_seen: string;
  updated: string;
  stale: string;
  healthy: string;
  idle: string;
  running: string;
  ready: string;
  blocked: string;
  failed: string;
  critical: string;
  warning: string;
  alert_task_failed: string;
  alert_dependency_failed: string;
  alert_dependency_blocked: string;
  alert_activity_stale: string;
  alert_cancellation_stuck: string;
  cancelling: string;
  cancelled: string;
  completed: string;
  unavailable: string;
  unavailable_description: string;
  retry_connection: string;
  close_details: string;
};

export type ObservedAgent = {
  id: string;
  pod_name: string;
  status: string;
  last_seen_at: number;
};

export type ObservedDependency = {
  id: string;
  status: string;
};

export type ObservedActivity = {
  id: string;
  kind: string;
  message: string;
  detail: string;
  created_at: number;
  attempt_id: string;
  attempt_number: number;
};

export enum ObservedAlertKind {
  TaskFailed = 'task-failed',
  DependencyFailed = 'dependency-failed',
  DependencyBlocked = 'dependency-blocked',
  ActivityStale = 'activity-stale',
  CancellationStuck = 'cancellation-stuck',
}

export enum ObservedAlertSeverity {
  Critical = 'critical',
  Warning = 'warning',
}

export type ObservedAlert = {
  id: string;
  kind:
    | ObservedAlertKind.TaskFailed
    | ObservedAlertKind.DependencyFailed
    | ObservedAlertKind.DependencyBlocked
    | ObservedAlertKind.ActivityStale
    | ObservedAlertKind.CancellationStuck;
  severity: ObservedAlertSeverity;
  task_id: string;
  first_observed_at: number;
  reason: string;
};

export type ObservedTask = {
  id: string;
  kind: string;
  kind_label: string;
  trigger: string;
  status: string;
  source_commit: string;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  created_at: number;
  updated_at: number;
  lease_until: number;
  agent_id: string;
  pod_name: string;
  latest_attempt_status: string;
  latest_attempt_started_at: number;
  latest_attempt_completed_at: number;
  latest_activity_at: number;
  latest_error: string;
  latest_summary: string;
  dependencies: ObservedDependency[];
  activity: ObservedActivity[];
};

export type ObserverSnapshot = {
  generated_at: number;
  copy: ObserverCopy;
  agents: ObservedAgent[];
  active_task_count: number;
  tasks: ObservedTask[];
  alerts: ObservedAlert[];
  alerts_truncated: boolean;
};
