use std::{fs, path::PathBuf};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(path: &str) -> String {
    fs::read_to_string(repository_root().join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

#[test]
fn kubernetes_cache_proof_reuses_production_workloads() {
    let overlay = read("infra/sim/kubernetes-cache/kustomization.yaml");
    for required in [
        "../../k0s/manifests/namespaces.yaml",
        "../../k0s/manifests/registry/zot.yaml",
        "../../k0s/manifests/arc/buildkit.yaml",
        "../../k0s/manifests/arc/network-policy.yaml",
        "$patch: delete",
        "name: nook-buildkit-rise-s-2",
        "path: /spec/replicas\n        value: 3",
        "nook-zot.hive-data.svc.cluster.local:5000",
    ] {
        assert!(
            overlay.contains(required),
            "Kubernetes cache overlay is missing its production-derived contract: {required}"
        );
    }
    assert!(
        !overlay.contains("apiVersion: apps/v1"),
        "the simulation must patch production workloads instead of copying them"
    );
}

#[test]
fn kubernetes_cache_cluster_is_pinned_isolated_and_bounded() {
    let contracts = read("infra/sim/kubernetes-cache/contracts.ts");
    let runtime = read("infra/sim/kubernetes-cache/runtime.ts");
    let proof = read("infra/sim/kubernetes-cache/prove.ts");
    for required in [
        "k3d version ${K3D_VERSION}",
        "refusing to replace existing k3d cluster",
        "nook-cache-proof",
    ] {
        assert!(
            proof.contains(required) || contracts.contains(required),
            "Kubernetes cache proof is missing: {required}"
        );
    }
    for required in [
        "rancher/k3s:v1.36.2-k3s1@sha256:6a47cea22c4b834d4ba72c89d291696b79ebe406251f90b446e4dff03513dd87",
        "--agents",
        "\"3\"",
        "--service-cidr=10.96.0.0/12@server:0",
        "--cluster-dns=10.96.0.10@server:0",
        "--kubeconfig-update-default=false",
        "delete exact k3d proof cluster",
    ] {
        assert!(
            runtime.contains(required) || contracts.contains(required),
            "isolated k3d lifecycle is missing: {required}"
        );
    }
    for forbidden in [
        "sh\", \"-c",
        "--volume /var/run/docker.sock",
        "-v /var/run/docker.sock",
        "docker:dind",
        "--privileged",
        "--kubeconfig-update-default=true",
    ] {
        assert!(
            !runtime.contains(forbidden) && !proof.contains(forbidden),
            "k3d proof must not broaden its runtime authority: {forbidden}"
        );
    }
}

#[test]
fn kubernetes_cache_clients_prove_security_and_portability() {
    let jobs = read("infra/sim/kubernetes-cache/jobs.ts");
    let proof = read("infra/sim/kubernetes-cache/prove.ts");
    let platform = read("infra/sim/kubernetes-cache/platform.ts");
    for required in [
        "automountServiceAccountToken: false",
        "allowPrivilegeEscalation: false",
        "readOnlyRootFilesystem: true",
        "capabilities:\n              drop: [\"ALL\"]",
        "network-policy-denied",
        "registry-write-denied",
        "cache-proof-execution-marker",
        "cached RUN step executed",
    ] {
        assert!(
            jobs.contains(required),
            "Kubernetes cache client boundary is missing: {required}"
        );
    }
    for required in [
        "privileged: true",
        "/var/run/docker.sock",
        "/run/containerd/containerd.sock",
        "hostPath:",
    ] {
        assert!(
            platform.contains(required) && platform.contains("assertExcludes"),
            "runtime manifest assertion is missing: {required}"
        );
    }
    for required in [
        "cache-main-local-reuse",
        "cache-main-restart-reuse",
        "cache-main-fresh-shard",
        "cache-isolated-a-publish",
        "cache-isolated-b-publish",
        "cache-isolated-a-restore",
        "cache-isolated-b-restore",
        "restartBuildkitPod",
        "restartZot",
        "kubernetes cache runtime proof passed",
    ] {
        assert!(
            proof.contains(required),
            "cache proof scenario is missing: {required}"
        );
    }
    for required in ["--for=create", ".metadata.uid"] {
        assert!(
            jobs.contains(required),
            "cache restart identity proof is missing: {required}"
        );
    }
}

#[test]
fn kubernetes_cache_proof_has_one_pinned_hosted_entrypoint() {
    let task = read("infra/tasks/kubernetes-cache.yml");
    let batch = read(".github/scripts/remote-task-batch.sh");
    let workflow = read(".github/workflows/remote.yml");
    let root_readme = read("README.md");
    let remote_guidance = read(".cortex/workflows/remote-execution.md");
    assert!(task.contains("bun run infra/sim/kubernetes-cache/prove.ts"));
    assert!(batch.contains("kubernetes-cache:prove) echo \"task infra:kubernetes-cache:prove\""));
    assert!(batch.contains("kubernetes-cache:prove must be dispatched as a single hosted task"));
    assert!(batch.contains("ci:pr:e2e|kubernetes-cache:prove) echo 45"));
    assert!(root_readme.contains("task infra:kubernetes-cache:prove"));
    assert!(
        remote_guidance
            .contains("The hosted VM's existing Docker daemon creates the k3d node containers.")
    );
    for required in [
        "(inputs.tasks || inputs.task) == 'kubernetes-cache:prove'",
        "K3D_VERSION: v5.9.0",
        "06d8f25bc3a971c4eb29e0ff08429b180402db0f4dec838c9eac427e296800a0",
        "k3d-linux-amd64",
        "sha256sum --check --strict",
        "NOOK_K3D_BIN=$k3d_path",
    ] {
        assert!(
            workflow.contains(required),
            "hosted k3d setup is missing: {required}"
        );
    }
}
