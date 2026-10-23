import { resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";
import {
  OperationalCommandProbe,
  OperationalContractFailureKind,
  OperationalContractSource,
  OperationalProbeStream,
  type OperationalContractFailure,
} from "./operational-contract";

/** Exercises the native jq guards used before broad ARC activation. */
export class ArcBuildkitUpdateContract {
  constructor(private readonly root: string) {}

  async assert(): Promise<Result<void, OperationalContractFailure>> {
    const source = await new OperationalContractSource(
      resolve(this.root, "infra/tasks/arc.yml"),
    ).read();
    if (source.isErr()) return err(source.error);
    const convergence = source.value.match(
      /jq -en --argjson state "\$buildkit_state" --argjson pods "\$buildkit_pods" '([^']+)'/,
    )?.[1];
    const cardinality = source.value.match(
      /"\$buildkit_manifest" \| jq -e '([^']+)'/,
    )?.[1];
    const annotation = source.value.match(
      /jq --arg hash "\$config_hash" '([^']+)'/,
    )?.[1];
    const bundle = source.value.match(/\| jq -s '([^']+)'/)?.[1];
    if (!convergence || !cardinality || !annotation || !bundle) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "BuildKit prepared-template or convergence guard is missing",
      });
    }
    const state = {
      metadata: { generation: 2 },
      spec: {
        replicas: 4,
        template: { spec: { containers: [{ image: "desired" }] } },
      },
      status: { observedGeneration: 2, updateRevision: "new" },
    };
    const pod = {
      metadata: { labels: { "controller-revision-hash": "new" } },
      spec: { containers: [{ name: "buildkitd", image: "desired" }] },
      status: { conditions: [{ type: "Ready", status: "True" }] },
    };
    const metadata = { name: "nook-buildkit", namespace: "arc-runners" };
    const config = {
      kind: "ConfigMap",
      metadata,
      data: { config: "retained" },
    };
    const workload = {
      kind: "StatefulSet",
      metadata,
      spec: { template: { metadata: {} } },
    };
    const rendered = new OperationalCommandProbe({
      cmd: ["jq", "-cs", bundle],
      stdin: new Blob([JSON.stringify(config), "\n", JSON.stringify(workload)]),
      stdout: OperationalProbeStream.Pipe,
      stderr: OperationalProbeStream.Pipe,
    }).execute();
    if (rendered.isErr()) return err(rendered.error);
    if (
      rendered.value.exitCode !== 0 ||
      rendered.value.stdout.trim() !==
        JSON.stringify({
          apiVersion: "v1",
          kind: "List",
          items: [config, workload],
        })
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message:
          "BuildKit must bundle every native kubectl JSON object before checksum preparation",
      });
    }
    const fixtures = [
      {
        guard: convergence,
        state,
        input: { items: [pod, pod, pod, pod] },
        expected: "true",
      },
      {
        guard: convergence,
        state,
        input: { items: [pod, pod, pod] },
        expected: "false",
      },
      {
        guard: convergence,
        state: { ...state, status: { ...state.status, observedGeneration: 1 } },
        input: { items: [pod, pod, pod, pod] },
        expected: "false",
      },
      {
        guard: convergence,
        state,
        input: {
          items: [
            pod,
            pod,
            pod,
            {
              ...pod,
              metadata: { labels: { "controller-revision-hash": "old" } },
            },
          ],
        },
        expected: "false",
      },
      {
        guard: convergence,
        state,
        input: {
          items: [
            pod,
            pod,
            pod,
            {
              ...pod,
              spec: { containers: [{ name: "buildkitd", image: "old" }] },
            },
          ],
        },
        expected: "false",
      },
      {
        guard: convergence,
        state,
        input: {
          items: [
            pod,
            pod,
            pod,
            {
              ...pod,
              status: { conditions: [{ type: "Ready", status: "False" }] },
            },
          ],
        },
        expected: "false",
      },
      {
        guard: `$pods | (${cardinality})`,
        state,
        input: { items: [config, workload] },
        expected: "true",
      },
      {
        guard: `$pods | (${cardinality})`,
        state,
        input: { items: [config] },
        expected: "false",
      },
      {
        guard: `$pods | (${cardinality})`,
        state,
        input: { items: [workload] },
        expected: "false",
      },
      {
        guard: `$pods | (${cardinality})`,
        state,
        input: { items: [config, config, workload] },
        expected: "false",
      },
      {
        guard: `$pods | (${cardinality})`,
        state,
        input: { items: [config, workload, workload] },
        expected: "false",
      },
      {
        guard: `$pods | (${annotation}) | .items[0] == $pods.items[0] and .items[1].spec.template.metadata.annotations["nook.nokey.sh/buildkit-config-sha256"] == $hash`,
        state,
        input: { items: [config, workload] },
        expected: "true",
      },
    ];
    for (const fixture of fixtures) {
      const result = new OperationalCommandProbe({
        cmd: [
          "jq",
          "-cn",
          "--arg",
          "hash",
          "checksum",
          "--argjson",
          "state",
          JSON.stringify(fixture.state),
          "--argjson",
          "pods",
          JSON.stringify(fixture.input),
          fixture.guard,
        ],
        stdout: OperationalProbeStream.Pipe,
        stderr: OperationalProbeStream.Pipe,
      }).execute();
      if (result.isErr()) return err(result.error);
      if (
        result.value.exitCode !== 0 ||
        result.value.stdout.trim() !== fixture.expected
      ) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message:
            "BuildKit must prepare one checksummed template and reject incomplete OnDelete convergence",
        });
      }
    }
    const annotationIndex = source.value.indexOf("jq --arg hash");
    const applyIndex = source.value.indexOf(
      "' | kubectl apply -f -",
      annotationIndex,
    );
    const gateIndex = source.value.indexOf(
      "jq -en --argjson state",
      applyIndex,
    );
    const activationIndex = source.value.lastIndexOf(
      "- task: arc:build-hosts:activate",
    );
    if (
      annotationIndex < 0 ||
      applyIndex < annotationIndex ||
      gateIndex < applyIndex ||
      activationIndex < gateIndex
    ) {
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message:
          "BuildKit checksum preparation and full convergence must precede host activation",
      });
    }
    return ok();
  }
}
