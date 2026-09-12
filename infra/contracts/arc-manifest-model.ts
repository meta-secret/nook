import { z } from "zod";

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
export const arcValuesSchema: z.ZodType<ArcValues> = z.object({
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
export const arcHookSchema: z.ZodType<ArcContainerHook> = z.object({
  data: z.object({ "content.yaml": z.string() }),
});
export const arcPodSchema: z.ZodType<ArcContainerPodTemplate> = z.object({
  spec: z.object({
    initContainers: z.array(container),
    containers: z.array(container),
  }),
});
export const workflowSchema: z.ZodType<WorkflowManifest> = z.object({
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

export const arcCoordinatorSchema: z.ZodType<{
  template: { spec: { containers: ArcContainer[] } };
}> = z.object({
  template: z.object({ spec: z.object({ containers: z.array(container) }) }),
});
