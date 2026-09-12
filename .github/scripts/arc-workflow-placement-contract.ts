import { err, ok, type Result } from "neverthrow";
import {
  OperationalContractSource,
  OperationalYamlDocument,
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { workflowSchema } from "./arc-manifest-model";
export class ArcWorkflowPlacementContract {
  constructor(private readonly root: string) {}
  async assert(): Promise<Result<void, OperationalContractFailure>> {
    const hostedUntrustedBoundary = new Set([
      "ci.yml#scope",
      "hive.yml#verify-fork",
      "hive.yml#console-untrusted",
      "web-research.yml#validate-untrusted",
    ]);
    const workflowsDir = resolve(this.root, ".github/workflows");
    let entries: string[];
    try {
      entries = await readdir(workflowsDir);
    } catch {
      return err({
        kind: OperationalContractFailureKind.Source,
        message: "Unable to read workflow directory",
      });
    }
    const workflowFiles = entries
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .sort();
    let observedHostedExceptions = new Set<string>();

    for (const workflowFile of workflowFiles) {
      const source = await new OperationalContractSource(
        resolve(workflowsDir, workflowFile),
      ).read();
      if (source.isErr()) return err(source.error);
      const decoded = new OperationalYamlDocument(source.value).decode(
        workflowSchema,
      );
      if (decoded.isErr()) return err(decoded.error);
      const workflow = decoded.value;
      const { jobs = {} } = workflow;
      for (const [jobName, job] of Object.entries(jobs)) {
        if (job.uses) continue;
        const placement = job["runs-on"];
        if (!placement) {
          return err({
            kind: OperationalContractFailureKind.Requirement,
            message: `${workflowFile}#${jobName} has no runner placement`,
          });
        }
        const identity = `${workflowFile}#${jobName}`;
        if (placement === "ubuntu-latest") {
          if (!hostedUntrustedBoundary.has(identity)) {
            return err({
              kind: OperationalContractFailureKind.Requirement,
              message: `${identity} routes trusted work to GitHub cloud`,
            });
          }
          observedHostedExceptions = new Set([
            ...observedHostedExceptions,
            identity,
          ]);
          const { if: condition = "" } = job;
          if (
            identity !== "ci.yml#scope" &&
            (!condition.includes("head.repo.full_name") ||
              !condition.includes("dependabot[bot]"))
          ) {
            return err({
              kind: OperationalContractFailureKind.Requirement,
              message: `${identity} must be restricted to forks and Dependabot`,
            });
          }
          continue;
        }
        if (placement.includes("ubuntu-latest")) {
          if (!placement.includes("head.repo.full_name")) {
            return err({
              kind: OperationalContractFailureKind.Requirement,
              message: `${identity} has an unguarded GitHub-hosted fallback`,
            });
          }
          continue;
        }
        if (
          !placement.includes("nook-k0s") &&
          !placement.includes("NOOK_RUNS_ON")
        ) {
          return err({
            kind: OperationalContractFailureKind.Requirement,
            message: `${identity} is not routed through an ARC scale set`,
          });
        }
      }
    }

    for (const exception of hostedUntrustedBoundary) {
      if (!observedHostedExceptions.has(exception)) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `stale hosted runner exception: ${exception}`,
        });
      }
    }
    return ok();
  }
}
