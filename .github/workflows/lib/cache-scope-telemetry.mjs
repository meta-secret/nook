/** Owns cache scope and publication capability reporting from job environment. */
export const CompilePhaseStatus = Object.freeze({
  NotRequested: "not_requested",
  NotStarted: "not_started",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
});

export const CompilePhaseCacheExportMode = Object.freeze({
  Max: "max",
  Disabled: "disabled",
});

/** @typedef {import("./cache-telemetry-contracts.mjs").CompilePhaseStatus} CompilePhaseStatusValue */

export class CacheScopeTelemetry {
  /** @param {NodeJS.ProcessEnv} environment */
  constructor(environment) {
    this.environment = environment;
  }

  /** @param {string} value @returns {CompilePhaseStatusValue} */
  compilePhaseStatus(value) {
    switch (value) {
      case CompilePhaseStatus.NotRequested:
      case CompilePhaseStatus.NotStarted:
      case CompilePhaseStatus.Running:
      case CompilePhaseStatus.Completed:
      case CompilePhaseStatus.Failed:
        return value;
      default:
        return CompilePhaseStatus.NotStarted;
    }
  }

  record() {
    const parentScopeSuffix =
      typeof this.environment.GHA_CACHE_PARENT_SCOPE_SUFFIX === "string"
        ? this.environment.GHA_CACHE_PARENT_SCOPE_SUFFIX
        : "";
    const registryHost =
      typeof this.environment.NOOK_REGISTRY_CACHE_HOST === "string"
        ? this.environment.NOOK_REGISTRY_CACHE_HOST
        : "";
    const currentScopeSuffix =
      typeof this.environment.GHA_CACHE_SCOPE_SUFFIX === "string"
        ? this.environment.GHA_CACHE_SCOPE_SUFFIX
        : "";
    const compileRequested =
      this.environment.NOOK_REMOTE_TASK_SELECTION === "build:compile";
    const currentRef =
      currentScopeSuffix.length > 0 && registryHost.length > 0
        ? `${registryHost}/nook/remote-buildcache/nook-build-compile${currentScopeSuffix}:buildcache`
        : "";
    const parentRef =
      parentScopeSuffix.length > 0 && registryHost.length > 0
        ? `${registryHost}/nook/remote-buildcache/nook-build-compile${parentScopeSuffix}:buildcache`
        : "";
    const compileImportsEnabled =
      compileRequested &&
      typeof this.environment.GHA_CACHE_ENABLED === "string" &&
      this.environment.GHA_CACHE_ENABLED.length > 0 &&
      currentRef.length > 0;
    const foundationCacheFrom = compileImportsEnabled ? [currentRef] : [];
    if (
      compileImportsEnabled &&
      parentRef.length > 0 &&
      parentScopeSuffix !== currentScopeSuffix
    ) {
      foundationCacheFrom.push(parentRef);
    }
    const sourceCacheFrom = compileImportsEnabled ? [currentRef] : [];
    const foundationExportEnabled =
      compileRequested &&
      typeof this.environment.GHA_CACHE_WRITE_ENABLED === "string" &&
      this.environment.GHA_CACHE_WRITE_ENABLED.length > 0 &&
      this.environment.NOOK_COMPILE_CACHE_MODE === "publish" &&
      currentRef.length > 0;
    const foundationStatusValue =
      typeof this.environment.NOOK_BUILD_COMPILE_FOUNDATION_STATUS === "string"
        ? this.environment.NOOK_BUILD_COMPILE_FOUNDATION_STATUS
        : "";
    const sourceStatusValue =
      typeof this.environment.NOOK_BUILD_COMPILE_SOURCE_STATUS === "string"
        ? this.environment.NOOK_BUILD_COMPILE_SOURCE_STATUS
        : "";
    const cacheAvailability = Object.entries(this.environment)
      .filter(([name]) => /^GHA_CACHE_(?:EXACT|MAIN)_.+_AVAILABLE$/.test(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => ({ name, available: value === "1" }));
    return {
      scope: "",
      compile_dependencies: {
        scope: "",
        available: false,
        write_enabled: false,
        export_enabled: false,
      },
      compile_source: {
        scope: currentScopeSuffix.length > 0
          ? `nook-build-compile${currentScopeSuffix}`
          : "",
        parent_scope_suffix: parentScopeSuffix,
        parent_ref: parentRef,
      },
      compile_phases: {
        foundation: {
          requested: compileRequested,
          target: "build-compile-foundation",
          status: compileRequested
            ? foundationStatusValue.length > 0
              ? this.compilePhaseStatus(foundationStatusValue)
              : CompilePhaseStatus.NotStarted
            : CompilePhaseStatus.NotRequested,
          cache_from: foundationCacheFrom,
          cache_to: {
            enabled: foundationExportEnabled,
            ref: foundationExportEnabled ? currentRef : "",
            mode: foundationExportEnabled
              ? CompilePhaseCacheExportMode.Max
              : CompilePhaseCacheExportMode.Disabled,
          },
          input_refs_access_verified:
            compileRequested &&
            this.environment.NOOK_BUILD_COMPILE_CACHE_IMPORTS_VERIFIED === "1",
        },
        source_compile: {
          requested: compileRequested,
          target: "build-compile",
          status: compileRequested
            ? sourceStatusValue.length > 0
              ? this.compilePhaseStatus(sourceStatusValue)
              : CompilePhaseStatus.NotStarted
            : CompilePhaseStatus.NotRequested,
          cache_from: sourceCacheFrom,
          cache_to: {
            enabled: false,
            ref: "",
            mode: CompilePhaseCacheExportMode.Disabled,
          },
        },
      },
      imports: {
        probes_complete:
          this.environment.GHA_CACHE_EXACT_PROBES_COMPLETE === "1",
        failure_class:
          this.environment.GHA_CACHE_EXACT_PROBE_FAILURE_CLASS || "none",
        availability: cacheAvailability,
      },
    };
  }
}
