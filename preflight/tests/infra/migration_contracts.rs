use std::{env, fs, path::PathBuf};

struct MigrationContractFixture;

impl MigrationContractFixture {
    fn read(path: &str) -> String {
        let root = env::var_os("NOOK_REPO_ROOT").map_or_else(
            || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
            PathBuf::from,
        );
        fs::read_to_string(root.join(path))
            .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
    }

    fn ordered(source: &str, earlier: &str, later: &str) {
        let earlier_index = source
            .find(earlier)
            .unwrap_or_else(|| panic!("migration contract is missing {earlier}"));
        let later_index = source
            .find(later)
            .unwrap_or_else(|| panic!("migration contract is missing {later}"));
        assert!(
            earlier_index < later_index,
            "migration must perform {earlier} before {later}"
        );
    }

    fn k0s_install() -> String {
        let tasks = Self::read("infra/tasks/k0s.yml");
        tasks
            .split("\n  k0s:install:\n")
            .nth(1)
            .and_then(|tail| tail.split("\n  k0s:").next())
            .unwrap_or_else(|| panic!("infra must define the k0s install task"))
            .to_owned()
    }

    fn registry_deploy() -> String {
        let tasks = Self::read("infra/tasks/registry.yml");
        tasks
            .split("\n  registry:deploy:\n")
            .nth(1)
            .and_then(|tail| tail.split("\n  registry:check:\n").next())
            .unwrap_or_else(|| panic!("infra must define the Zot deploy task"))
            .to_owned()
    }
}

#[test]
fn k0s_encryption_migration_reuses_one_consistent_legacy_key() {
    let install = MigrationContractFixture::k0s_install();

    for legacy_path in [
        "/var/lib/k0s/pki/hive-encryption-provider.yaml",
        "/var/lib/hive/k0s-recovery/encryption-provider.yaml",
        "/var/lib/nook/k0s-recovery/encryption-provider.yaml",
    ] {
        assert!(install.contains(legacy_path));
    }
    assert!(install.contains("cmp --silent \"$legacy_provider_source\" \"$candidate\""));
    assert!(install.contains("Refusing divergent legacy k0s encryption-provider files"));
    assert!(install.contains("Refusing divergent current and legacy k0s encryption providers"));
    assert!(
        install.contains("\"$legacy_provider_source\" \\\n            \"$encryption_provider\"")
    );
}

#[test]
fn k0s_encryption_migration_generates_a_key_only_without_current_or_legacy_state() {
    let install = MigrationContractFixture::k0s_install();
    let reuse = "if ! sudo -n test -s \"$encryption_provider\" &&\n          test -n \"$legacy_provider_source\"; then";
    let generation = "if ! sudo -n test -s \"$encryption_provider\"; then\n          encryption_key=\"$(openssl rand -base64 32)\"";

    assert!(install.contains(reuse));
    assert!(install.contains(generation));
    MigrationContractFixture::ordered(&install, reuse, generation);
}

#[test]
fn zot_data_migration_stops_the_legacy_workload_before_moving_storage() {
    let deploy = MigrationContractFixture::registry_deploy();

    MigrationContractFixture::ordered(
        &deploy,
        "kubectl scale deployment/nook-zot --namespace hive-data --replicas=0",
        "sudo -n mv \"$legacy_zot_dir\" \"$zot_dir\"",
    );
    MigrationContractFixture::ordered(
        &deploy,
        "kubectl rollout status deployment/nook-zot --namespace hive-data --timeout=10m",
        "sudo -n mv \"$legacy_zot_dir\" \"$zot_dir\"",
    );
}

#[test]
fn zot_data_migration_refuses_dual_populated_directories() {
    let deploy = MigrationContractFixture::registry_deploy();

    assert!(deploy.contains(
        "legacy_has_data=\"$(sudo -n find \"$legacy_zot_dir\" -mindepth 1 -print -quit)\""
    ));
    assert!(
        deploy
            .contains("current_has_data=\"$(sudo -n find \"$zot_dir\" -mindepth 1 -print -quit)\"")
    );
    assert!(deploy.contains("test -n \"$legacy_has_data\" && test -n \"$current_has_data\""));
    assert!(deploy.contains("Refusing to merge populated legacy and current Zot stores"));
}

#[test]
fn zot_volume_migration_validates_legacy_identity_before_deletion() {
    let deploy = MigrationContractFixture::registry_deploy();
    let dual_refusal = "Refusing ambiguous Zot PVCs in both legacy and current namespaces";
    let volume_validation = "test \"$legacy_volume\" = nook-zot-data";
    let path_validation = "test \"$legacy_path\" = /var/lib/hive/zot";
    let delete_claim_command = "kubectl delete pvc nook-zot-data --namespace hive-data --wait=true";
    let delete_volume_command = "kubectl delete pv nook-zot-data --wait=true";

    MigrationContractFixture::ordered(&deploy, dual_refusal, volume_validation);
    MigrationContractFixture::ordered(&deploy, volume_validation, path_validation);
    MigrationContractFixture::ordered(&deploy, path_validation, delete_claim_command);
    MigrationContractFixture::ordered(&deploy, delete_claim_command, delete_volume_command);
}

#[test]
fn zot_migration_applies_the_new_namespace_and_storage_path() {
    let deploy = MigrationContractFixture::registry_deploy();

    assert!(
        deploy.contains("kubectl apply -f \"$remote_dir/infra/k0s/manifests/namespaces.yaml\"")
    );
    assert!(deploy.contains("sudo -n install -d -m 0750 -o 10001 -g 10001 /var/lib/nook/zot"));
    assert!(deploy.contains("kubectl apply -f \"$rendered_manifest\""));
    assert!(deploy.contains(
        "kubectl rollout status deployment/nook-zot \\\n          --namespace nook-infra"
    ));
    assert!(deploy.contains("kubectl get pvc nook-zot-data --namespace nook-infra"));
}
