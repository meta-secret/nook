const RUST_DEPENDENCY_ROOTS = [
  "agentic-ai/minds/",
  "nook-app/nook-platform/",
  "preflight/",
] as const;
const CRATES_IO_SOURCE =
  "registry+https://github.com/rust-lang/crates.io-index";

export interface RustDependencyContent {
  readonly path: string;
  readonly content: string;
  readonly baseline?: string;
}
export class RustDependencyDocument {
  constructor(private readonly input: RustDependencyContent) {}
  validateSources(): void {
    const { path, content, baseline = "" } = this.input;
    const current = new CargoSourceText(content);
    const previous = new CargoSourceText(baseline);
    const introduced = path.endsWith("Cargo.lock")
      ? [...current.lockSources()].filter(
          (source) =>
            source !== CRATES_IO_SOURCE && !previous.lockSources().has(source),
        )
      : path.endsWith("Cargo.toml")
        ? [...current.gitSources()].filter(
            (source) => !previous.gitSources().has(source),
          )
        : [];
    if (introduced.length > 0)
      throw new Error(`Dependency update used a non-crates.io source: ${path}`);
  }
}
class CargoSourceText {
  constructor(private readonly content: string) {}
  lockSources(): Set<string> {
    const content = this.content;

    return new Set(
      [...content.matchAll(/^\s*source\s*=\s*["']([^"']+)["']/gmu)].map(
        (m) => m[1]!,
      ),
    );
  }
  gitSources(): Set<string> {
    const content = this.content;

    return new Set(
      [...content.matchAll(/\bgit\s*=\s*["']([^"']+)["']/gu)].map((m) => m[1]!),
    );
  }
}
export class RustDependencyPath {
  constructor(private readonly path: string) {}
  isAllowed(): boolean {
    const path = this.path;

    if (!RUST_DEPENDENCY_ROOTS.some((root) => path.startsWith(root))) {
      return false;
    }
    const basename = path.slice(path.lastIndexOf("/") + 1);
    return (
      basename === "Cargo.toml" ||
      basename === "Cargo.lock" ||
      path.endsWith(".rs")
    );
  }
  isOrchestrationControl(): boolean {
    const path = this.path;

    const lower = path.toLowerCase();
    const basename = lower.slice(lower.lastIndexOf("/") + 1);
    return (
      /(^|\/)(?:\.github|\.task|\.cursor|scripts)\//u.test(lower) ||
      /^(?:taskfile\.ya?ml|makefile|justfile|build\.rs|dockerfile(?:\..*)?|docker-compose.*)$/u.test(
        basename,
      ) ||
      basename.includes("bake")
    );
  }
}
