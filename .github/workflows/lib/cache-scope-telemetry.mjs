/** Owns cache scope and publication capability reporting from job environment. */
export class CacheScopeTelemetry {
  /** @param {NodeJS.ProcessEnv} environment */
  constructor(environment) {
    this.environment = environment;
  }

  record() {
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
          ? `nook-build-compile-v4${this.environment.GHA_CACHE_SCOPE_SUFFIX}`
          : "",
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
