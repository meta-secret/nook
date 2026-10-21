# ARC Persistent BuildKit Runner Platform

## Overview

Actions Runner Controller executes trusted GitHub Actions jobs in disposable
Kubernetes Pods.

The runner Pods use the ordinary k0s runtime. They do not use Kata. Each
qualified build node owns one persistent rootless BuildKit shard.

This document owns:

- ARC runner placement;
- the rootless BuildKit boundary;
- node-local cache persistence;
- cache distribution; and
- ARC credential ownership.

## Runner boundary

Runner Pods are disposable and unprivileged.

Build-capable runner Pods receive:

- the Docker CLI and Buildx client;
- a node-local BuildKit service address;
- an ephemeral work directory; and
- no Kubernetes service-account token.

They do not receive:

- a Docker daemon;
- Podman;
- DinD;
- a host Docker or containerd socket;
- a host path;
- a privileged security context; or
- a Kata runtime class.

The Docker CLI is a BuildKit client. It must not be treated as a general
container-runtime API. Browser-only job Pods consume prepared images or
artifacts under the `arc-browser-job` role. Their distinct hook supplies no
BuildKit environment, client mount, client init container, or BuildKit ingress
permission.

## Compute and placement

ARC keeps no warm runner Pod. It creates one Pod for each queued job and removes
that Pod after completion.

Browser-only jobs use Rise-S-2. General execution requires `arc-workload: build`
and `arc-tier` in `[primary, secondary]`, admitting Rise-S-1 and the home worker.
Hive retains Rise-S-1, home, and OVH. Mixed container jobs retain Rise-S-1 and
OVH because they also require `arc-container-job: true`; home lacks that label.
Required node eligibility separates these workloads before soft preferences
choose a node within the build pool.

- General `nook-k0s` retains a ceiling of 35.
- Mixed `nook-k0s-container` decreases from 20 to 16.
- Browser-only `nook-k0s-browser` has a ceiling of 4.
- Separately owned `nook-k0s-hive` retains a ceiling of 10.
- The aggregate ceiling remains 65; it is not a throughput guarantee.

Build nodes retain tier preferences: Rise-S-1 scores 100, the home 7950X3D
scores 90, and the control/storage worker scores 1. Home's 250 Mbps link
requires at least 32 seconds per decimal GB before protocol or storage overhead.
New placements may need cold imports despite retained caches.

This general-only restriction is a bounded placement experiment. It reduces
eligible capacity from 80 to 48 logical CPUs and approximately 371.5 to 245.8 GiB
allocatable memory. These totals are
not reservations: execution Pods and BuildKit have no CPU or memory requests
or limits. The unchanged 35-runner ceiling can therefore increase contention
or queue time on the two eligible hosts, with 40% fewer eligible CPUs.
Equal-count spread is not CPU-weighted, and each job retains all-CPU parallelism.
General jobs have no OVH fallback; mixed PR work can still run on OVH, so its
latency remains placement-dependent.
The existing scale set has no per-job placement control for preflight alone.

### Browser capacity and availability

The selected Rise-S-2 host has 16 logical CPUs and approximately 62 GiB memory.
The separation assessment observed a 466 GiB disk with 97 GiB free.
These are capacity observations, not reserved resources or performance promises.

- Browser concurrency is bounded by the four-runner ceiling.
- Exhausting four runner slots queues additional browser work.
- An unavailable or unschedulable Rise-S-2 leaves browser work queued.
- There is no automatic overflow to build nodes.
- Its retained BuildKit shard may still perform idle garbage collection or
  background I/O. Separation removes ordinary build scheduling, not the daemon.
- Explicit maintenance benchmarks may use all four retained shards.
  They are outside ordinary workload placement and require their own authorization.

**Prohibited:** silently route browser work to a build node when Rise-S-2 is
unavailable, or call the configured ceiling a measured speedup.

**Required:** report the queue and node condition. Measure full hosted runs
after an authorized rollout before claiming improved latency.

### Shared execution spread

Build-pool execution Pods use native topology spread on `kubernetes.io/hostname`
with `maxSkew: 1` and `whenUnsatisfiable: DoNotSchedule`.
General and Hive selectors count `arc-spread-group` values `general`, `hive`,
and `container` together. The mixed container hook's spread selector counts
only `container`, excluding general/Hive runners from mixed-job spread counts.
Both count within the Pod's namespace, currently `arc-runners`.
Container-runner managers, listeners and BuildKit daemons are excluded.
General runners include lightweight orchestration jobs; the rule does not
measure actual CPU use or active BuildKit solves.

Both `nodeAffinityPolicy` and `nodeTaintsPolicy` are `Honor`. Counts include
only hosts eligible for the incoming Pod, preserving each pool's placement
constraints. No `minDomains` or `matchLabelKeys` override is configured.
General runners count two eligible build hosts; Hive retains three. Mixed container
jobs count Rise-S-1 and the OVH control/storage host. Browser-only jobs remain
on Rise-S-2 outside these build-pool spread constraints.

The existing preferred terms retain these marginal penalties per matching Pod:

- Home: 25 from the hostname term.
- Rise-S-1: 50, combining hostname (25) and standard-host (25).
- Control/storage: 100, combining hostname (25), standard-host (25),
  and overflow-host (50).

Every node has its ordinary hostname label. The two additional topology labels
contain that node's unique name and are deliberately absent outside their
capacity tier. They are used only in preferred terms. Deployment applies them
through `infra:arc:placement:labels` before updating runner templates.
Do not use these partial topology labels for required anti-affinity or spread
constraints. For example, two jobs on home contribute the same raw penalty as
one job on Rise-S-1. The scheduler also scores existing Pods' preferences,
normalizes the scores, and combines them with its other plugins; these numbers
are neither guaranteed allocation ratios nor concurrency limits.

Multiple execution Pods may share a host. Scheduling keeps the incoming Pod's
matching count within one of the minimum across its eligible hosts.
The rule applies during scheduling; it does not evict existing Pods.

Hard spread can still queue a Pod when a least-loaded eligible host cannot
accept it because of resources or other scheduling constraints. The unchanged
container hook fails a job Pod that remains Pending for ten minutes.
Scale-set ceilings bound allocated runners, including Pending Pods, rather
than simultaneous execution slots. Observe real placement and node use with
`task infra:arc:placement:status`.

- **Prohibited:** impose one execution Pod per host to enforce balanced placement.
- **Required:** allow another Pod on an occupied host when the eligible-host
  counts satisfy `maxSkew: 1`.
  Compare queue time and execution time after rollout before claiming a speedup.

The Remote `ci:pr:e2e` matrix retains `max-parallel: 2`. GitHub queues additional
matrix jobs before runner assignment. Its sealed browser jobs use the single
Rise-S-2 browser host. Each admitted job uses all available logical CPUs for
Playwright workers. The matrix limit does not reserve the host or guarantee
isolation from other workflows.

### Deployment and resource policy

Full platform deployment keeps all build nodes quarantined until listeners are ready, exposes
both Rise nodes together, then home, then overflow. The existing Hive Helm
release keeps ownership of its image, credentials and security settings.
`infra:arc:placement:hive` updates its build-pool node selector, affinity and
topology spread constraints using the general runner's deployed policy, with
required tier affinity explicitly restored to `[primary, secondary, overflow]`.
Hive must already be installed by its owner; a missing release is a deployment error.

Before an authorized rollout, inspect Hive's live Helm execution template and
its `arc-spread-group: hive` label. Confirm the shared policy reaches its actual
execution Pods, not a manager template, before using `infra:arc:placement:hive`.
The separately owned release is not defined by the checked-in general template.
Committing this policy does not deploy it or establish a measured improvement.

The browser ceiling replaces four slots from the mixed scale set.
Runner, job and BuildKit containers have no CPU or memory requests or limits.
Tools retain automatic full-CPU
parallelism. Support-container memory envelopes and storage sizes remain
unchanged. Do not infer available CPUs from a Kubernetes request: CPU affinity,
cgroup quota and tool configuration determine runtime parallelism.

## Persistent local BuildKit shards

The `nook-buildkit` StatefulSet has four replicas. Required anti-affinity keeps
one replica on each qualified node.

Each replica uses:

- rootless BuildKit `v0.32.2`;
- a retained 128 GiB local persistent volume;
- the host path `/var/lib/nook-arc-buildkit/state` behind that volume;
- garbage collection through the shared policy below; and
- no CPU or memory requests or limits.

The shared four-node ConfigMap retains its preceding age-filtered GC policies.
The ordinary layer policy keeps configured `112GB` maximum use, `16GB` free
space, and `64GB` reserved space.
Its final `all = true` policy uses `minFreeSpace = "33%"` and retains the
`64GB` reserved floor, which BuildKit parses as 64 GiB.
BuildKit measures `statfs.Bfree`, including filesystem-reserved blocks, rather
than usable `Bavail`. Its native percentage conversion targets approximately
25% usable space on the assessed Rise-S-2 filesystem. This is not a universal
usable-space guarantee: actual reclamation depends on native GC eligibility
and the retained floor.

Build-host key quotas follow these rules:

- **Persistent floor**
  - Store `kernel.keys.maxkeys=20000` in
    `/etc/sysctl.d/91-nook-buildkit-keyring.conf`.
  - Store `kernel.keys.maxbytes=2000000` in the same file.
- **Reason**
  - Rootless shards concentrate their processes under host UID 1000.
  - Debian permits only 200 keys per user by default.
  - Concurrent solves can exhaust that quota.
  - runc then reports a misleading `disk quota exceeded` error.
- **Deployment**
  - `task infra:arc:deploy` quarantines every declared build host before
    applying the settings or starting BuildKit storage convergence.
  - It verifies the effective values before reactivating any host.
  - Deployment fails closed when either value is below its declared floor.

Rootless BuildKit uses `--oci-worker-no-process-sandbox`. An unprivileged
Kubernetes Pod cannot mount the nested `/proc` required by BuildKit's normal
OCI process sandbox. A production build probe must execute a `RUN` vertex;
daemon startup alone does not prove this mode works.

This means concurrent solves on one shard do not have a process-isolation
boundary. Only trusted same-repository jobs may use these scale sets. Fork,
Dependabot, and other untrusted jobs remain on GitHub-hosted runners. Build
publication refs and credentials remain job scoped, but they are not a sandbox
for hostile build instructions.

The manifest and deployment retain exactly four BuildKit storage nodes:

- two Rise-S workers;
- the home worker; and
- KS-6.

Adding another node requires its retained PV and a matching StatefulSet replica
in the same change. Deployment fails closed when the qualified-node inventory
differs. Rise-S-2 remains in that storage inventory even though ordinary build
producers are excluded from its workload pool. Separation does not delete or
move its cached layers.

The node-local Service uses `internalTrafficPolicy: Local`. A runner therefore
reaches only the BuildKit endpoint on its own node.

The cache survives:

- runner Pod deletion;
- concurrent jobs;
- BuildKit Pod recreation; and
- ARC controller restarts.

A node loss removes only that node's local shard. Zot remains the portable
fallback.

## Cache distribution

Multiple jobs on one node share one BuildKit content store. BuildKit owns
concurrency and content-addressed deduplication.

Jobs must keep publication identities separate:

- Main publishes shared refs under `nook/buildcache/**`.
- Pull requests use exact-commit refs under `nook/remote-buildcache/**`.

Distribution follows these rules:

- A job scheduled on another node may miss the local shard. It imports from Zot
  once. Later jobs on that node reuse the hydrated local state.
- The design avoids copying a fixed-size cache image. Only referenced
  content-addressed blobs move through Zot.
- Production Dockerfiles name Zot directly where practical. BuildKit also
  mirrors unqualified `docker.io` pulls through `registry.dev.nokey.sh`.
- Zot is an on-demand Docker Hub mirror. It preserves upstream digests. A
  missing public blob is fetched centrally once and then retained.
- Main build producers run on ARC and retain their persistent local graph. The
  portable WASM dependency writer and proof use the configured general ARC
  scale set. Fresh cache-only builders still prove child manifest digest, blob
  readability, and expensive dependency hits without relying on one warmed
  BuildKit process.

## Resource envelopes

The resource envelopes are:

- General runner, container-scale-set coordinator, and container-job containers
  declare no resource requests or limits.
- A selected execution Pod shares node CPU with BuildKit and other infrastructure.
- Hostname topology spread balances selected execution Pods across eligible
  nodes while allowing multiple jobs per host.
- Scale-set ceilings bound aggregate runner count.
- Support init containers retain their role-specific memory envelopes.
- Empty-directory size limits continue to bound disposable storage.
- The persistent BuildKit shard performs compilation, layer extraction,
  import, and export. It must not inherit fractional control-plane CPU limits.
- Zot may use up to 8 CPU and 12 GiB because it serves all nodes.

These are operational starting points. Live CPU, memory, disk, and network
measurements decide future changes.

## Credential ownership

The ARC controller token is repository scoped.

Store it in:

- the `arc-runners/nook-arc-github` Kubernetes Secret; and
- `~/.nook/github/arc-controller-token` with mode `0600`.

Credential rules are:

- The token needs repository runner-registration authority. It receives no
  organization permission.
- Runner Pods do not receive that token.
- BuildKit uses the existing narrow registry and compiler-cache credentials
  provided by trusted workflows.
- Fork and Dependabot jobs remain on hosted runners without private
  credentials.
- Run `task infra:arc:fallback` before emergency ARC credential revocation.

## Operations and validation

### Workload-separation rollout

Source changes do not apply live placement. Obtain approval for the scoped
maintenance rollout before running the following steps.
Keep the PR's `ci:full-e2e` label removed while preparing the new pool.
`NOOK_BROWSER_RUNS_ON` is not an activation gate: the workflow's default
already selects `nook-k0s-browser` when the variable is absent.

1. Run `task infra:arc:separation:drain` to stop new assignments.
   - Existing jobs finish naturally. Pending and terminating runner objects
     also block the next step until ARC removes them.
2. Run `task infra:arc:separation:apply` after the drain completes.
   - It runs `infra:k0s:sync` to upload the checked-out infrastructure sources
     before rendering or applying remote manifests.
   - It applies placement labels, hooks, and scale-set templates with admission
     still stopped. Hive retains its separately owned non-placement settings.
3. Run `task infra:arc:separation:resume` after apply succeeds.
   - It checks for old runner templates before restoring ceilings 35/16/4/10.
   - A failed check remains visible; the workflow does not automatically recover.
4. Run `task infra:arc:separation:activate` to register the explicit
   `NOOK_BROWSER_RUNS_ON` value after the new pool is ready.
5. Use `task infra:arc:separation:status` for read-only configuration evidence.
   - Registration and configuration do not prove real job placement or latency.
   - After the approved rollout, restore `ci:full-e2e` through PR Lifecycle.
     Validate actual browser/build placement and full hosted runs.

These steps preserve active jobs, BuildKit daemons, all retained PVs, and the
node-local Service. They do not restart the ARC controller, buy capacity, or
perform broad platform deployment.

- Drain and resume update pools through sequential Helm calls. A partial
  failure can leave earlier pools changed and later pools unchanged.
- Inspect native Helm and ARC status after a partial failure. Diagnose the
  failure before rerunning the relevant ordinary phase. There is no automatic recovery.
- Apply keeps admission at zero after its idle check succeeds.

For a general-only fast-tier rollout, use the same approved drain, apply,
resume, and status sequence. The existing browser registration does not need
another `activate` step. Resume and status check general fast-tier affinity,
Hive's three-tier affinity, and unchanged manager eligibility. Before rollout,
the pools remain running at their existing ceilings; they are not already paused.
Only after a successful drain is admission disabled for all pools; a failed apply or
pre-resume check leaves admission stopped. A partial resume can instead leave
some pools running, as described above.

Decide whether to retain or manually roll back the experiment using observed
queue and execution times. Retain it only when comparable hosted runs improve
end-to-end latency without new scheduling failures. If queue or execution
regressions offset the preflight gain, or general work cannot schedule on the
remaining hosts, request manual rollback. Rollback requires approval too. With admission
drained and idle, check out the previous reviewed placement source, run its
same sync/apply sequence, verify
the previous templates, and resume the original 35/16/4/10 ceilings. Inspect
native Helm and ARC status after any failure before retrying the relevant phase.
There is no automatic rollback, job cancellation, controller restart, or cache/PV
mutation. Source review and unchanged ceilings do not establish a speedup;
compare hosted queue time, placement, and execution time after an approved rollout.

**Prohibited:** run `infra:arc:deploy` to apply only workload separation, delete
old runner Pods to bypass the drain, or claim a speedup from registration alone.

**Required:** use the approved scoped sequence, inspect a failure before any
further mutation, and report measured hosted results separately from configuration.

### Full platform operations

Deploy the platform with:

```bash
task infra:arc:deploy
```

Provision a declared OVH worker from provider-ready state with:

```bash
task infra:ovh:server:deploy INFRA_OVH_SERVER=nook-rise-s-2
```

Provisioning preserves these boundaries:

- The provider adapter reads OVH credentials from `~/.nook/ovh-api.json`. A
  candidate credential is authenticated before it atomically replaces that
  file.
- OVH's standard installer owns Debian and software RAID. The Taskfile owns the
  generic SSH and sudo baseline plus all later convergence.
- Each declared worker has a stable Ed25519 SSH host identity under
  `~/.nook/infra/ovh-host-identities`. The standard installer receives that key
  through its provider-authenticated post-install customization.
- Bootstrap accepts only the matching SHA-256 fingerprint. It never trusts an
  unauthenticated `ssh-keyscan` result.

The workflow then performs these operations:

1. Verify the exact service, address, hardware range, datacenter, and current OS.
2. Cordon the exact existing node and wait for active ARC jobs to finish.
3. Drain remaining workloads before the provider may reinstall the server.
4. Recheck the target immediately before any destructive reinstall.
5. Install Debian when the server is blank or recovery is explicitly forced.
6. Verify the pinned SSH host identity and apply the idempotent base contract.
7. Require effective SSH hardening and a non-degraded two-member RAID1 array.
8. Reconcile WireGuard, k0s, ARC storage, and runner placement.

Recovery preserves these boundaries:

- Replacing an installed OS requires the explicit
  `INFRA_OVH_ALLOW_REINSTALL=true` disaster-recovery input. That input also
  forces a reinstall when the reported OS already matches.
- The recovery path removes the old Kubernetes node, WireGuard peer, routes,
  and stale mesh SSH identities before onboarding the replacement.
- Recovering an unchanged installed server has these requirements:
  - Its matching host identity must already exist in the private store.
  - The adapter refuses to invent an identity that was never installed.
  - Restore the identity backup or explicitly reinstall the server when the
    identity is missing.
- Cloud-init user-data is not used with the standard OVH image. OVH exposes
  that customization only for BYOI and BYOLinux. Owning a custom image pipeline
  would add recovery risk. BYOI would also bypass the standard software RAID
  install.
- Ironic is not part of this boundary. OVH already owns PXE, BMC, and physical
  installation lifecycle.

Inspect the live state with:

```bash
task infra:arc:status
```

Measure every node with:

```bash
task infra:arc:buildkit:benchmark
```

The benchmark must prove:

1. one ready BuildKit endpoint on each of four nodes;
2. a cold solve on each local shard;
3. a faster `CACHED` replay;
4. a new BuildKit Pod UID after restart;
5. the same node and persistent volume after restart; and
6. another `CACHED` replay after restart.

Repository contracts reject the retired Kata, Podman, seed-cloner, cache-primary
scale set, DinD, host socket, privileged runner, and runner host-path designs.
