import english from '../locales/en.json';
import russian from '../locales/ru.json';
import type { ObserverCopy } from './types';

export function emergencyCopy(locale: string): ObserverCopy {
  const catalog = locale.toLocaleLowerCase().startsWith('ru')
    ? russian
    : english;
  return {
    product_name: catalog.product_name,
    product_description: '',
    overview: '',
    workers: '',
    queue: '',
    needs_attention: '',
    recent_activity: '',
    all_tasks: '',
    search_tasks: '',
    no_tasks: '',
    no_tasks_description: '',
    no_search_results: '',
    no_search_results_description: '',
    no_attention: '',
    no_attention_description: '',
    task_details: '',
    trigger: '',
    source_revision: '',
    current_attempt: '',
    dependencies: '',
    timeline: '',
    no_activity: '',
    no_dependencies: '',
    attempt: '',
    last_seen: '',
    updated: '',
    stale: '',
    healthy: '',
    idle: '',
    running: '',
    ready: '',
    blocked: '',
    failed: '',
    critical: '',
    warning: '',
    alert_task_failed: '',
    alert_dependency_failed: '',
    alert_dependency_blocked: '',
    alert_activity_stale: '',
    alert_cancellation_stuck: '',
    cancelling: '',
    cancelled: '',
    completed: '',
    unavailable: catalog.unavailable,
    unavailable_description: catalog.unavailable_description,
    retry_connection: catalog.retry_connection,
    close_details: '',
  };
}
