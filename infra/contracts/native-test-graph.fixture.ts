import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export class NativeTestGraphContract {
  constructor(private readonly root: string) {}

  assert(): void {
    const product = this.read(
      "nook-app/nook-platform/docker/rust/base/Dockerfile",
    );
    const sourceStart = product.indexOf(
      "FROM builder-core-deps AS builder-native-source-base",
    );
    const testsStart = product.indexOf(
      "FROM builder-native-common-source AS builder-native-common-test",
    );
    const reportStart = product.indexOf(
      "FROM builder-native-core-source AS builder-debug",
    );
    expect(sourceStart).toBeGreaterThanOrEqual(0);
    expect(testsStart).toBeGreaterThan(sourceStart);
    expect(reportStart).toBeGreaterThan(testsStart);
    const sources = product.slice(sourceStart, testsStart);
    expect(sources).toContain(
      "COPY nook-app/nook-platform/Cargo.toml nook-app/nook-platform/Cargo.lock ./",
    );
    expect(sources).toContain("COPY nook-app/nook-platform/.cargo .cargo");
    expect(sources).toContain("COPY nook-app/nook-platform/.config .config");
    expect(sources).toContain("COPY nook-app/nook-platform/clippy.toml clippy.toml");
    expect(sources).toContain(
      "CARGO_LLVM_COV_DENY_WARNINGS=1 cargo llvm-cov clean --workspace",
    );
    expect(sources).not.toMatch(/cargo (?:test|nextest|clippy|build)\b/);
    expect(sources).toContain("--exclude=coverage-floor.json");
    expect(sources).toContain("--exclude=.cortex");
    expect(sources).toContain("--exclude=README*");
    expect(sources).not.toMatch(/(?:FROM|COPY --from=).*?-test\b/);
    const report = product.slice(
      reportStart,
      product.indexOf("FROM scratch AS coverage-export"),
    );
    expect(report).toContain(
      "COPY nook-app/nook-platform/nook-core/coverage-floor.json nook-core/coverage-floor.json",
    );
    expect(report).toContain("cargo llvm-cov report --failure-mode any");
    expect(report).toContain('--fail-under-lines "$floor"');
    expect(report).toContain('test "$coverage_status" -eq 0');
    expect(report).not.toContain("cargo llvm-cov nextest");
    for (const leaf of [
      { stage: "common", package: "nook-app-common" },
      { stage: "authenticator", package: "nook-authenticator-domain" },
      { stage: "replication", package: "nook-replication" },
      { stage: "auth2", package: "nook-auth2" },
      { stage: "event-log", package: "nook-event-log" },
      { stage: "companion", package: "nook-companion-core" },
      { stage: "core", package: "nook-core" },
    ]) {
      expect(sources).toContain(
        `nook-app/nook-platform/${leaf.package}/ ${leaf.package}/`,
      );
      const start = product.indexOf(
        `FROM builder-native-${leaf.stage}-source AS builder-native-${leaf.stage}-test`,
      );
      expect(start).toBeGreaterThanOrEqual(testsStart);
      const body = product.slice(start, product.indexOf("\nFROM ", start + 1));
      expect(body).toContain(
        `cargo llvm-cov nextest --locked --no-report --profile ci -p ${leaf.package}`,
      );
      expect(body).toContain(
        `LLVM_PROFILE_FILE_NAME='${leaf.package}-%p-%m.profraw'`,
      );
      expect(body).toContain("cp target/nextest/ci/junit.xml");
      expect(body).toContain("-exec cp --parents -t");
      expect(body).not.toContain("--no-tests=pass");
      expect(report).toContain(
        `COPY --from=builder-native-${leaf.stage}-test /opt/nook/native-test-artifacts/${leaf.package}/profiles/*.profraw target/llvm-cov-target/`,
      );
      expect(report).toContain(
        `COPY --from=builder-native-${leaf.stage}-test /opt/nook/native-test-artifacts/${leaf.package}/objects/ target/llvm-cov-target/debug/native-tests/${leaf.package}/`,
      );
    }
    const verificationStart = product.indexOf(
      "FROM builder-debug AS pr-rust-verify",
    );
    expect(verificationStart).toBeGreaterThan(reportStart);
    const verification = product.slice(
      verificationStart,
      product.indexOf("FROM scratch AS pr-wasm-artifacts"),
    );
    expect(verification).toContain(
      "-p nook-companion-wasm -p nook-wasm-composition-tests",
    );
    expect(verification).not.toMatch(/cargo (?:test|build|llvm-cov)\b/);
    expect(this.read("nook-app/ci/pr.docker-bake.hcl")).toContain(
      "cache-from = rust_native_source_cache_from",
    );
  }

  private read(path: string): string {
    return readFileSync(join(this.root, path), "utf8");
  }
}
