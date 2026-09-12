import { z } from "zod";

type Optional<T> = T | void;

export interface ResourceEnvelope {
  requests?: Optional<{
    cpu?: Optional<string>;
    memory?: Optional<string>;
    "ephemeral-storage"?: Optional<string>;
  }>;
  limits?: Optional<{
    cpu?: Optional<string>;
    memory?: Optional<string>;
    "ephemeral-storage"?: Optional<string>;
  }>;
}

export type ArcEnvironmentVariable =
  | { name: string; value: string }
  | {
      name: string;
      valueFrom: { fieldRef: { fieldPath: string } };
    };

export interface ArcContainer {
  name: string;
  env?: Optional<ArcEnvironmentVariable[]>;
  resources?: Optional<ResourceEnvelope>;
}

export interface ArcVolume {
  name: string;
  hostPath?: Optional<{ path: string }>;
}

export interface ArcValues {
  runnerScaleSetName: string;
  minRunners: number;
  maxRunners: number;
  template: {
    spec: {
      runtimeClassName?: Optional<string>;
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
  if?: Optional<string>;
  "runs-on"?: Optional<string>;
  steps?: Optional<Array<{ run?: Optional<string>; uses?: Optional<string> }>>;
  uses?: Optional<string>;
}

export interface WorkflowManifest {
  jobs?: Optional<Record<string, WorkflowJob>>;
}

const resourceFields = z.object({
  cpu: z.string().optional(),
  memory: z.string().optional(),
  "ephemeral-storage": z.string().optional(),
});
const resources = z.object({
  requests: resourceFields.optional(),
  limits: resourceFields.optional(),
});
const environment = z.union([
  z.object({ name: z.string(), value: z.string() }),
  z.object({
    name: z.string(),
    valueFrom: z.object({ fieldRef: z.object({ fieldPath: z.string() }) }),
  }),
]);
const container = z.object({
  name: z.string(),
  env: z.array(environment).optional(),
  resources: resources.optional(),
});
export const arcValuesSchema = z.object({
  runnerScaleSetName: z.string(),
  minRunners: z.number(),
  maxRunners: z.number(),
  template: z.object({
    spec: z.object({
      runtimeClassName: z.string().optional(),
      automountServiceAccountToken: z.boolean(),
      initContainers: z.array(container),
      containers: z.array(container),
      volumes: z.array(
        z.object({
          name: z.string(),
          hostPath: z.object({ path: z.string() }).optional(),
        }),
      ),
    }),
  }),
});
export const arcHookSchema = z.object({
  data: z.object({ "content.yaml": z.string() }),
});
export const arcPodSchema = z.object({
  spec: z.object({
    initContainers: z.array(container),
    containers: z.array(container),
  }),
});
export const workflowSchema = z.object({
  jobs: z
    .record(
      z.string(),
      z.object({
        if: z.string().optional(),
        "runs-on": z.string().optional(),
        uses: z.string().optional(),
        steps: z
          .array(
            z.object({
              run: z.string().optional(),
              uses: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export const arcCoordinatorSchema = z.object({
  template: z.object({ spec: z.object({ containers: z.array(container) }) }),
});
