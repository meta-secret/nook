import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface HiveResourceEnvelope {
  requests?: { cpu?: string; memory?: string };
  limits?: { cpu?: string; memory?: string };
}

interface HiveInitContainer {
  name: string;
  image: string;
  restartPolicy?: string;
  resources?: HiveResourceEnvelope;
}

interface HiveContainer {
  name: string;
  env?: Array<{ name: string; value?: string }>;
  resources?: HiveResourceEnvelope;
}

interface HiveValues {
  runnerScaleSetName: string;
  minRunners: number;
  maxRunners: number;
  template: {
    spec: {
      runtimeClassName: string;
      nodeSelector: Record<string, string>;
      initContainers: HiveInitContainer[];
      containers: HiveContainer[];
      volumes: Array<{ hostPath?: { path: string } }>;
    };
  };
}

interface HiveRenderContractInput {
  root: string;
}

export async function assertHiveRenderContract(
  input: HiveRenderContractInput,
): Promise<void> {
  const renderedDirectory = mkdtempSync(join(tmpdir(), "nook-arc-hive-values-"));
  try {
    const renderedPath = join(renderedDirectory, "values.yaml");
    const rendered = Bun.spawnSync({
      cmd: [
        resolve(input.root, "infra/k0s/scripts/arc-hive-values.rb"),
        resolve(
          input.root,
          "infra/k0s/manifests/arc/runner-scale-set-values.yaml",
        ),
        renderedPath,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (rendered.exitCode !== 0) {
      throw new Error(
        `Hive ARC values failed to render: ${rendered.stderr.toString()}`,
      );
    }
    const hiveValues = Bun.YAML.parse(
      await Bun.file(renderedPath).text(),
    ) as HiveValues;
    if (hiveValues.runnerScaleSetName !== "nook-k0s-hive") {
      throw new Error("Hive must use its ARC scale set");
    }
    if (hiveValues.minRunners !== 0 || hiveValues.maxRunners !== 10) {
      throw new Error("Hive ARC must scale from zero through ten fresh runners");
    }
    const hivePod = hiveValues.template.spec;
    if (hivePod.runtimeClassName !== "kata-qemu-runtime-rs") {
      throw new Error("Hive ARC must use Kata QEMU");
    }
    if (hivePod.nodeSelector["nook.nokey.sh/arc-build"] !== "true") {
      throw new Error("Hive ARC must run only on qualified build nodes");
    }
    const sidecars = new Map(
      hivePod.initContainers.map((item) => [item.name, item]),
    );
    if (sidecars.has("container-runtime")) {
      throw new Error("Hive ARC must not carry the general Podman runtime");
    }
    const hiveBuildkit = sidecars.get("buildkit");
    if (
      hiveBuildkit?.resources?.limits?.cpu !== "4" ||
      hiveBuildkit?.resources?.requests?.memory !== "4Gi" ||
      hiveBuildkit.resources.limits?.memory !== "4Gi"
    ) {
      throw new Error("Hive ARC BuildKit must retain its 4 CPU and 4 GiB budget");
    }
    const hiveRunner = hivePod.containers.find((item) => item.name === "runner");
    if (hiveRunner?.resources?.limits?.cpu !== "1") {
      throw new Error("Hive ARC runner coordinator must retain one CPU");
    }
    if (
      hiveRunner?.env?.some((item) =>
        ["DOCKER_HOST", "NOOK_CONTAINER_RUNTIME"].includes(item.name),
      )
    ) {
      throw new Error("Hive ARC runner must not target the general Podman API");
    }
    for (const name of ["neo4j", "hive-test-runtime"]) {
      if (sidecars.get(name)?.restartPolicy !== "Always") {
        throw new Error(`Hive ARC ${name} must be a native sidecar`);
      }
    }
    const hiveTestRuntime = sidecars.get("hive-test-runtime");
    if (
      hiveTestRuntime?.resources?.limits?.cpu !== "4" ||
      hiveTestRuntime.resources.limits?.memory !== "4Gi"
    ) {
      throw new Error(
        "Hive ARC test runtime must retain its 4 CPU and 4 GiB budget",
      );
    }
    if (sidecars.get("neo4j")?.resources?.limits?.cpu !== "1") {
      throw new Error("Hive ARC Neo4j must retain one CPU for integration tests");
    }
    if (
      !sidecars
        .get("neo4j")
        ?.image.includes("neo4j:2026.06.0-community@sha256:")
    ) {
      throw new Error("Hive ARC Neo4j must be versioned and digest-pinned");
    }
    if (hivePod.volumes.filter((volume) => "hostPath" in volume).length !== 2) {
      throw new Error("Hive ARC must inherit only the two approved hostPaths");
    }
  } finally {
    rmSync(renderedDirectory, { recursive: true, force: true });
  }
}
