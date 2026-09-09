export interface ResourceEnvelope {
  requests?: {
    cpu?: string;
    memory?: string;
    "ephemeral-storage"?: string;
  };
  limits?: {
    cpu?: string;
    memory?: string;
    "ephemeral-storage"?: string;
  };
}

export type ArcEnvironmentVariable =
  | { name: string; value: string }
  | {
      name: string;
      valueFrom: { fieldRef: { fieldPath: string } };
    };

export interface ArcContainer {
  name: string;
  env?: ArcEnvironmentVariable[];
  resources?: ResourceEnvelope;
}

export interface ArcVolume {
  name: string;
  hostPath?: { path: string };
}

export interface ArcValues {
  runnerScaleSetName: string;
  minRunners: number;
  maxRunners: number;
  template: {
    spec: {
      runtimeClassName?: string;
      automountServiceAccountToken: boolean;
      initContainers: ArcContainer[];
      containers: ArcContainer[];
      volumes: ArcVolume[];
    };
  };
}

export interface ArcContainerHook {
  data: { "content.yaml": string };
}

export interface ArcContainerPodTemplate {
  spec: { initContainers: ArcContainer[]; containers: ArcContainer[] };
}

export interface WorkflowJob {
  if?: string;
  "runs-on"?: string;
  steps?: Array<{ run?: string; uses?: string }>;
  uses?: string;
}

export interface WorkflowManifest {
  jobs?: Record<string, WorkflowJob>;
}
