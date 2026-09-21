# Nook Dependency Audit Integration

Library selection and language-specific adoption thresholds come from Meta-Cortex.
Nook's Loom dependency audit provides the repository evidence.

## Required actions

Include repository manifests when adding or reviewing dependencies:

```yaml
dependencyPopularity:
  includeRepositoryManifests: true
  minNpmWeeklyDownloads: 10000
  minGitHubStars: 100
  minCratesIoDownloads: 50000
  minCratesIoRecentDownloads: 1000
```

The owning hosted validation stage runs `task loom:dependency-popularity`.
Resolve failed findings before delivery. Product validation remains in Nook-owned
Rust domain code; this audit measures dependency adoption only.

**Prohibited:** treat a popular package as the authority for vault policy.

**Preferred:** use it for commodity mechanics behind the existing typed boundary.
