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
  static async assert(root: string): Promise<void> {
    for (const consumer of Object.values(DockerfileFrontendConsumer)) {
      const source = await Bun.file(resolve(root, consumer)).text();
      const firstLine = source.split("\n", 1)[0];
      if (firstLine !== TrustedDockerfileFrontendPin.Stable) {
        throw new Error(`${consumer} must pin the trusted Dockerfile frontend`);
      }
    }
  }
}

export async function assertDockerfileFrontendContract(input: {
  root: string;
}): Promise<void> {
  await DockerfileFrontendContract.assert(input.root);
}
