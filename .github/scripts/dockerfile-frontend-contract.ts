import { err, ok, type Result } from "neverthrow";
import {
  OperationalContractSource,
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";
import { resolve } from "node:path";

enum DockerfileFrontendConsumer {
  Hive = "agentic-ai/minds/hive/Dockerfile",
  RustNightly = "nook-app/nook-platform/docker/rust/nightly.Dockerfile",
  RustPolicyTools = "nook-app/nook-platform/docker/rust/policy-tools.Dockerfile",
  RustProduct = "nook-app/nook-platform/docker/rust/product.Dockerfile",
  SccacheHealth = "nook-app/nook-platform/docker/sccache-health.Dockerfile",
  WebToolchain = "nook-app/nook-web/docker/toolchain.Dockerfile",
  Web = "nook-app/nook-web/docker/web.Dockerfile",
  WebApp = "nook-app/nook-web/nook-web-app/Dockerfile",
  Preflight = "preflight/Dockerfile",
}

enum TrustedDockerfileFrontendPin {
  Stable = "# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e",
}

export class DockerfileFrontendContract {
  constructor(private readonly root: string) {}
  async assert(): Promise<Result<void, OperationalContractFailure>> {
    for (const consumer of Object.values(DockerfileFrontendConsumer)) {
      const source = await new OperationalContractSource(
        resolve(this.root, consumer),
      ).read();
      if (source.isErr()) return err(source.error);
      const firstLine = source.value.split("\n", 1)[0];
      if (firstLine !== TrustedDockerfileFrontendPin.Stable) {
        return err({
          kind: OperationalContractFailureKind.Requirement,
          message: `${consumer} must pin the trusted Dockerfile frontend`,
        });
      }
    }
    return ok();
  }
}
