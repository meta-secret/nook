import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import {
  OperationalCommandProbe,
  OperationalProbeStream,
  OperationalContractSource,
  OperationalYamlDocument,
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";

const resourceSchema = z.object({
  requests: z
    .object({ cpu: z.string().optional(), memory: z.string().optional() })
    .optional(),
  limits: z
    .object({ cpu: z.string().optional(), memory: z.string().optional() })
    .optional(),
});
const initSchema = z.object({
  name: z.string(),
  image: z.string(),
  restartPolicy: z.string().optional(),
  resources: resourceSchema.optional(),
});
const containerSchema = z.object({
  name: z.string(),
  env: z
    .array(z.object({ name: z.string(), value: z.string().optional() }))
    .optional(),
  resources: resourceSchema.optional(),
});
const hiveSchema = z.object({
  runnerScaleSetName: z.string(),
  minRunners: z.number(),
  maxRunners: z.number(),
  template: z.object({
    spec: z.object({
      runtimeClassName: z.string().optional(),
      nodeSelector: z.record(z.string(), z.string()),
      initContainers: z.array(initSchema),
      containers: z.array(containerSchema),
      volumes: z.array(
        z.object({ hostPath: z.object({ path: z.string() }).optional() }),
      ),
    }),
  }),
});
type HiveInitContainer = z.infer<typeof initSchema>;
type HiveContainer = z.infer<typeof containerSchema>;
type HiveValues = z.infer<typeof hiveSchema>;

class HiveContainerResourceContract {
  constructor(private readonly request: HiveInitContainer | HiveContainer) {}
  execute(): Result<void, OperationalContractFailure> {
    const container = this.request;

    const resources = container.resources;
    if (!resources) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `Hive ARC ${container.name} must retain its non-CPU resource envelope`,
      });
    }
    const { limits = {}, requests = {} } = resources;
    if (
      Object.keys(requests).includes("cpu") ||
      Object.keys(limits).includes("cpu")
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: `Hive ARC ${container.name} must not declare CPU requests or limits`,
      });
    }
    return ok();
  }
}

class HiveRenderedValuesContract {
  constructor(private readonly hiveValues: HiveValues) {}
  assert(): Result<void, OperationalContractFailure> {
    const hiveValues = this.hiveValues;
    if (hiveValues.runnerScaleSetName !== "nook-k0s-hive") {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive must use its ARC scale set",
      });
    }
    if (hiveValues.minRunners !== 0 || hiveValues.maxRunners !== 10) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC must scale from zero through ten fresh runners",
      });
    }
    const hivePod = hiveValues.template.spec;
    if ("runtimeClassName" in hivePod) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC must use the default Kubernetes runtime",
      });
    }
    if (hivePod.nodeSelector["nook.nokey.sh/arc-build"] !== "true") {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC must run only on qualified build nodes",
      });
    }
    const sidecars = new Map(
      hivePod.initContainers.map((item) => [item.name, item]),
    );
    if (sidecars.has("container-runtime") || sidecars.has("buildkit")) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC must use the persistent BuildKit service only",
      });
    }
    const hiveRunner = hivePod.containers.find(
      (item) => item.name === "runner",
    );
    if (!hiveRunner) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC must retain its runner container",
      });
    }
    for (const container of hivePod.initContainers) {
      const envelope = new HiveContainerResourceContract(container).execute();
      if (envelope.isErr()) return err(envelope.error);
    }
    if ("resources" in hiveRunner) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC runner must not declare resource requests or limits",
      });
    }
    if (
      hiveRunner?.env?.some((item) =>
        ["DOCKER_HOST", "NOOK_CONTAINER_RUNTIME"].includes(item.name),
      )
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC runner must not target the general Podman API",
      });
    }
    for (const name of ["neo4j", "hive-test-runtime"]) {
      if (sidecars.get(name)?.restartPolicy !== "Always") {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `Hive ARC ${name} must be a native sidecar`,
        });
      }
    }
    const hiveTestRuntime = sidecars.get("hive-test-runtime");
    if (
      hiveTestRuntime?.resources?.requests?.memory !== "512Mi" ||
      hiveTestRuntime.resources.limits?.memory !== "4Gi"
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC test runtime must retain its memory envelope",
      });
    }
    const neo4j = sidecars.get("neo4j");
    if (
      neo4j?.resources?.requests?.memory !== "1Gi" ||
      neo4j.resources.limits?.memory !== "2Gi"
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC Neo4j must retain its memory envelope",
      });
    }
    if (
      !sidecars
        .get("neo4j")
        ?.image.includes("neo4j:2026.06.0-community@sha256:")
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC Neo4j must be versioned and digest-pinned",
      });
    }
    if (hivePod.volumes.some((volume) => "hostPath" in volume)) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Hive ARC must not mount host paths",
      });
    }

    return ok();
  }
}
class HiveRenderWorkspace {
  constructor(private readonly directory: string) {}
  async render(
    root: string,
  ): Promise<Result<void, OperationalContractFailure>> {
    const path = join(this.directory, "values.yaml");
    const rendered = new OperationalCommandProbe({
      cmd: [
        resolve(root, "infra/k0s/scripts/arc-hive-values.rb"),
        resolve(root, "infra/k0s/manifests/arc/runner-scale-set-values.yaml"),
        path,
      ],
      stdout: OperationalProbeStream.Pipe,
      stderr: OperationalProbeStream.Pipe,
    }).execute();
    if (rendered.isErr()) return err(rendered.error);
    if (rendered.value.exitCode !== 0)
      return err({
        kind: OperationalContractFailureKind.Command,
        message: "Hive ARC values failed to render",
      });
    const source = await new OperationalContractSource(path).read();
    if (source.isErr()) return err(source.error);
    const values = new OperationalYamlDocument(source.value).decode(hiveSchema);
    if (values.isErr()) return err(values.error);
    return new HiveRenderedValuesContract(values.value).assert();
  }
  remove(): Result<void, OperationalContractFailure> {
    try {
      rmSync(this.directory, { recursive: true, force: true });
      return ok();
    } catch {
      return err({
        kind: OperationalContractFailureKind.Cleanup,
        message: "Unable to remove Hive ARC render workspace",
      });
    }
  }
}
export class ArcHiveRenderContract {
  constructor(private readonly request: { root: string }) {}
  private createWorkspace(): Result<
    HiveRenderWorkspace,
    OperationalContractFailure
  > {
    try {
      return ok(
        new HiveRenderWorkspace(
          mkdtempSync(join(tmpdir(), "nook-arc-hive-values-")),
        ),
      );
    } catch {
      return err({
        kind: OperationalContractFailureKind.Source,
        message: "Unable to create Hive ARC render workspace",
      });
    }
  }
  async execute(): Promise<Result<void, OperationalContractFailure>> {
    const workspace = this.createWorkspace();
    if (workspace.isErr()) return err(workspace.error);
    const rendered = await workspace.value.render(this.request.root);
    const cleanup = workspace.value.remove();
    if (rendered.isErr() && cleanup.isErr())
      return err({
        kind: OperationalContractFailureKind.Combined,
        message: rendered.error.message + "\n" + cleanup.error.message,
        failures: [rendered.error, cleanup.error],
      });
    return rendered.isErr() ? rendered : cleanup;
  }
}
