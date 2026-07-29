import type { SentinelDashboard } from "$lib/components/login/sentinel-dashboard-portal";

export enum SentinelDashboardChoiceKind {
  NotChosen = "not-chosen",
  Chosen = "chosen",
}

export type SentinelDashboardChoice =
  | { kind: SentinelDashboardChoiceKind.NotChosen }
  | {
      kind: SentinelDashboardChoiceKind.Chosen;
      dashboard: SentinelDashboard;
    };

export enum VaultCreationWizardStep {
  Choose = "choose",
  SimpleCreate = "simple-create",
  SentinelDashboard = "sentinel-dashboard",
  SentinelPolicy = "sentinel-policy",
  SentinelCeremony = "sentinel-ceremony",
  Join = "join",
}

export enum ChosenVaultPath {
  Undecided = "undecided",
  Simple = "simple",
  Sentinel = "sentinel",
  Join = "join",
}
