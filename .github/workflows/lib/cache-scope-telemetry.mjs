/** Owns cache scope and publication capability reporting from job environment. */
export class CacheScopeTelemetry {
  /** @param {NodeJS.ProcessEnv} environment */
  constructor(environment) {
    this.environment = environment;
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
    const parentRef =
      parentScopeSuffix.length > 0 && registryHost.length > 0
        ? `${registryHost}/nook/remote-buildcache/nook-build-compile${parentScopeSuffix}:buildcache`
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
        scope: this.environment.GHA_CACHE_SCOPE_SUFFIX
          ? `nook-build-compile${this.environment.GHA_CACHE_SCOPE_SUFFIX}`
          : "",
        parent_scope_suffix: parentScopeSuffix,
        parent_ref: parentRef,
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
