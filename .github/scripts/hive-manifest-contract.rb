#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"
require "json"
require "tmpdir"
require "fileutils"
require "open3"

root = File.expand_path("../..", __dir__)
load_yaml = lambda do |path|
  YAML.safe_load(File.read(File.join(root, path)), aliases: true)
end
load_yaml_stream = lambda do |path|
  File.read(File.join(root, path))
    .split(/^---\s*$/)
    .map { |document| YAML.safe_load(document, aliases: true) }
end

deployment = load_yaml.call("infra/k0s/manifests/hive/deployment.yaml")
dispatcher_deployment = load_yaml.call("infra/k0s/manifests/hive/dispatcher.yaml")
observer_deployment = load_yaml.call("infra/k0s/manifests/hive/observer.yaml")
reaper_deployment = load_yaml.call("infra/k0s/manifests/hive/reaper-controller.yaml")
pod = deployment.fetch("spec").fetch("template").fetch("spec")
unless [deployment, dispatcher_deployment, observer_deployment, reaper_deployment]
       .all? { |manifest| manifest.dig("spec", "replicas").zero? }
  raise "Hive must remain paused until duplicate repair orchestration is corrected"
end
unless pod["runtimeClassName"] == "kata-dragonball" &&
       pod.dig("nodeSelector", "nook.nokey.sh/node-role") == "compute"
  raise "Hive must use Kata Dragonball on the qualified compute tier"
end
raise "Hive must disable automatic service-account tokens" unless pod["automountServiceAccountToken"] == false
unless pod["serviceAccountName"] == "hive-auth-persistence"
  raise "Hive Pod identity must only persist rotated authentication"
end
raise "Hive must not use hostPath" if pod.fetch("volumes").any? { |volume| volume.key?("hostPath") }

containers = pod.fetch("initContainers") + pod.fetch("containers")
containers.each do |container|
  security = container.fetch("securityContext")
  raise "#{container.fetch("name")} is privileged" if security["privileged"] == true
  unless security["allowPrivilegeEscalation"] == false
    raise "#{container.fetch("name")} permits privilege escalation"
  end
  unless security.dig("capabilities", "drop")&.include?("ALL")
    raise "#{container.fetch("name")} does not drop all capabilities"
  end
end

worker = pod.fetch("containers").find { |container| container.fetch("name") == "hive" }
broker = pod.fetch("containers").find { |container| container.fetch("name") == "auth-broker" }
coordinator = pod.fetch("containers").find { |container| container.fetch("name") == "coordinator" }
reaper = pod.fetch("containers").find { |container| container.fetch("name") == "pod-reaper" }
unless worker.dig("securityContext", "seccompProfile", "type") == "Localhost" &&
       worker.dig(
         "securityContext",
         "seccompProfile",
         "localhostProfile"
       ) == "nook/hive-bubblewrap.json"
  raise "Hive worker must allow rootless Bubblewrap mounts inside the Kata guest"
end
if (containers - [worker]).any? do |container|
     container.dig("securityContext", "seccompProfile", "type") == "Localhost"
   end
  raise "Only the Kata-isolated Hive worker may use the local seccomp profile"
end
worker_mounts = worker.fetch("volumeMounts").map { |mount| mount.fetch("name") }
broker_mounts = broker.fetch("volumeMounts").map { |mount| mount.fetch("name") }
coordinator_mounts = coordinator.fetch("volumeMounts").map { |mount| mount.fetch("name") }
reaper_mounts = reaper.fetch("volumeMounts").map { |mount| mount.fetch("name") }
raise "Hive worker must not mount Codex credentials" if worker_mounts.include?("codex-auth-source")
raise "Hive worker must not mount the broker auth home" if worker_mounts.include?("broker-auth-home")
raise "Hive worker must not mount the broker API token" if worker_mounts.include?("broker-auth-api")
unless broker_mounts.include?("codex-auth-source") &&
       broker_mounts.include?("broker-auth-home") &&
       broker_mounts.include?("broker-auth-api") &&
       worker_mounts.include?("auth-channel")
  raise "Hive auth broker boundary is incomplete"
end
worker_environment_entries = worker.fetch("env")
worker_environment = worker_environment_entries.map { |entry| entry.fetch("name") }
coordinator_environment = coordinator.fetch("env").map { |entry| entry.fetch("name") }
if worker_environment.any? { |name| name.start_with?("NEO4J_") } ||
   worker_mounts.include?("trust-bundle")
  raise "Hive worker must not receive Neo4j credentials or trust material"
end
unless coordinator_environment.include?("NEO4J_PASSWORD") &&
       coordinator_mounts.include?("trust-bundle") &&
       coordinator_mounts.include?("coordinator-channel") &&
       worker_mounts.include?("coordinator-channel")
  raise "Hive coordinator credential boundary is incomplete"
end
github_token = worker_environment_entries.find { |entry| entry["name"] == "GH_TOKEN" }
unless github_token&.dig("valueFrom", "secretKeyRef", "name") == "hive-github-publication" &&
       github_token&.dig("valueFrom", "secretKeyRef", "key") == "token"
  raise "Trusted Hive agents must receive the repository GitHub token directly"
end
unless reaper_mounts.include?("reaper-auth") &&
       !reaper_mounts.include?("broker-auth-api") &&
       !reaper_mounts.include?("reaper-api")
  raise "Hive reaper must use only its opaque controller credential"
end
worker_environment = worker.fetch("env").to_h { |entry| [entry.fetch("name"), entry["value"]] }
unless worker_environment["HIVE_SEALED_GUEST"] == "1"
  raise "Hive worker must select native sealed-guest Taskfile formatting"
end
unless worker_environment["HIVE_TASK_TIMEOUT_SECONDS"] == "21600"
  raise "Hive worker must allow the complete six-hour repair lifecycle"
end
unless worker_environment["HIVE_LEASE_SECONDS"] == "3600" &&
       worker_environment["HIVE_HEARTBEAT_SECONDS"] == "60"
  raise "Hive workers must renew a one-hour lease every minute"
end
unless worker_environment["HIVE_CODEX_MODEL"] == "gpt-5.6-sol" &&
       worker_environment["HIVE_CODEX_REASONING_EFFORT"] == "medium"
  raise "Hive workers must pin Codex GPT-5.6-sol with medium reasoning"
end
unless worker_environment["HIVE_CODEX_LINUX_SANDBOX_EXE"] ==
       "/usr/local/bin/hive-codex-linux-sandbox"
  raise "Hive workers must select the Restricted-Pod Codex sandbox wrapper"
end
trust_initializers = [
  pod.fetch("initContainers"),
  dispatcher_deployment.dig("spec", "template", "spec", "initContainers"),
  observer_deployment.dig("spec", "template", "spec", "initContainers")
].map do |init_containers|
  init_containers.find { |container| container["name"] == "neo4j-trust" }
                 .fetch("command")
                 .last
end
trust_initializers.each do |initializer|
  Dir.mktmpdir("hive-trust-contract") do |directory|
    system_ca = File.join(directory, "system-ca.crt")
    neo4j_ca = File.join(directory, "neo4j-ca.crt")
    trust_bundle = File.join(directory, "ca-certificates.crt")
    File.write(system_ca, "system-ca\n")
    File.write(neo4j_ca, "neo4j-ca\n")
    command = initializer
      .gsub("/etc/ssl/certs/ca-certificates.crt", system_ca)
      .gsub("/run/neo4j/ca.crt", neo4j_ca)
      .gsub("/trust/ca-certificates.crt", trust_bundle)
    2.times do
      unless system("bash", "-ceu", command, out: File::NULL, err: File::NULL)
        raise "Hive Neo4j trust initialization must survive Kata sandbox recreation"
      end
    end
    unless File.read(trust_bundle) == "system-ca\nneo4j-ca\n" &&
           File.stat(trust_bundle).mode & 0o777 == 0o444
      raise "Hive Neo4j trust initialization produced the wrong bundle"
    end
  end
end
unless worker.dig("readinessProbe", "exec", "command") ==
       ["test", "-f", "/workspace/.hive-worker-ready"]
  raise "Hive readiness does not prove broker and Neo4j registration"
end
unless dispatcher_deployment.dig("spec", "template", "spec", "runtimeClassName") ==
       "kata-qemu-runtime-rs" &&
       dispatcher_deployment.dig("spec", "template", "spec", "nodeSelector",
                                 "nook.nokey.sh/node-role") == "compute" &&
       dispatcher_deployment.dig("spec", "template", "spec", "volumes")
         .find { |volume| volume["name"] == "temporary" }
         .dig("emptyDir", "sizeLimit") == "1Gi" &&
       dispatcher_deployment.dig("spec", "template", "spec", "automountServiceAccountToken") ==
       false
  raise "Hive Workbench dispatcher must remain token-free on Kata QEMU compute"
end
observer_pod = observer_deployment.dig("spec", "template", "spec")
unless observer_pod["automountServiceAccountToken"] == false &&
       observer_pod["runtimeClassName"].nil?
  raise "Hive observer must remain token-free infrastructure"
end
observer = observer_pod.fetch("containers")
  .find { |container| container["name"] == "observer" }
observer_environment = observer.fetch("env").map { |entry| entry.fetch("name") }
observer_coordinator = observer_pod.fetch("containers")
  .find { |container| container["name"] == "coordinator" }
observer_coordinator_environment = observer_coordinator.fetch("env")
  .map { |entry| entry.fetch("name") }
unless observer.fetch("args") == ["observer"] &&
       observer_environment.include?("HIVE_COORDINATOR_SOCKET") &&
       !observer_environment.include?("NEO4J_PASSWORD") &&
       observer_coordinator.fetch("args") == ["observer-coordinator"] &&
       observer_coordinator_environment.include?("NEO4J_PASSWORD") &&
       observer.dig("securityContext", "readOnlyRootFilesystem") == true
  raise "Hive observer must use the typed coordinator boundary without graph credentials"
end
observer_manifest_text = File.read(
  File.join(root, "infra/k0s/manifests/hive/observer.yaml")
)
unless observer_manifest_text.include?("name: hive-observer") &&
       observer_manifest_text.include?("type: ClusterIP") &&
       observer_manifest_text.include?("path: /healthz")
  raise "Hive observer must remain cluster-private and health-checked"
end
dispatcher_environment = dispatcher_deployment
  .dig("spec", "template", "spec", "containers")
  .find { |container| container["name"] == "dispatcher" }
  .fetch("env")
  .to_h { |entry| [entry.fetch("name"), entry["value"]] }
unless dispatcher_environment["HIVE_WORKBENCH_REPOSITORY_URL"] ==
       "https://github.com/meta-secret/nook-workbench.git" &&
       dispatcher_environment["HIVE_WORKBENCH_CHECKOUT"] == "/tmp/nook-workbench" &&
       dispatcher_environment["HIVE_WORKBENCH_HEALTH_PATH"] ==
       "/tmp/hive-workbench-dispatcher-health" &&
       dispatcher_environment["HIVE_WORKBENCH_HEALTH_MAX_AGE_SECONDS"] == "600"
  raise "Hive dispatcher must reconcile a cached public Workbench Git snapshot"
end
dispatcher = dispatcher_deployment
  .dig("spec", "template", "spec", "containers")
  .find { |container| container["name"] == "dispatcher" }
dispatcher_health_command = ["/usr/local/bin/hive", "workbench-dispatcher-health"]
dispatcher_progress_command = dispatcher_health_command + ["--progress"]
unless dispatcher.dig("startupProbe", "exec", "command") == dispatcher_progress_command &&
       dispatcher.dig("readinessProbe", "exec", "command") == dispatcher_health_command &&
       dispatcher.dig("livenessProbe", "exec", "command") == dispatcher_progress_command
  raise "Hive dispatcher health must detect stale polling and process exhaustion"
end

manifest_text = File.read(File.join(root, "infra/k0s/manifests/hive/deployment.yaml"))
raise "Hive must not mount the host Docker socket" if manifest_text.include?("hostPath")
if manifest_text.match?(/DOCKER_HOST|docker-channel|docker-data|sealed-builder|privileged:\s*true/)
  raise "Hive must not run a nested or privileged Docker daemon"
end
unless manifest_text.include?("neo4j+s://hive-neo4j.hive-data.svc.cluster.local:7687")
  raise "Hive must verify encrypted Bolt traffic"
end

network_policies = File
  .read(File.join(root, "infra/k0s/manifests/hive/network-policy.yaml"))
  .split(/^---\s*$/)
  .map { |document| YAML.safe_load(document, aliases: true) }
  .compact
network = network_policies
  .find { |document| document.dig("metadata", "name") == "hive-worker-egress" }
api_network = network_policies
  .find { |document| document.dig("metadata", "name") == "hive-worker-kubernetes-api" }
dispatcher_network = network_policies
  .find { |document| document.dig("metadata", "name") == "hive-dispatcher-reaper" }
observer_network = network_policies
  .find { |document| document.dig("metadata", "name") == "hive-observer-egress" }
reaper_network = network_policies
  .find { |document| document.dig("metadata", "name") == "hive-reaper-controller" }
raise "Hive worker Kubernetes API policy is missing" unless api_network
unless api_network.dig("spec", "podSelector", "matchLabels", "app.kubernetes.io/name") == "hive"
  raise "Only Hive worker Pods may reach the Kubernetes API"
end
internet_block = network
  .dig("spec", "egress")
  .flat_map { |rule| rule.fetch("to", []) }
  .map { |destination| destination["ipBlock"] }
  .compact
  .find { |block| block["cidr"] == "0.0.0.0/0" }
raise "Hive Internet egress rule is missing" unless internet_block
private_ranges = %w[10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16]
missing_ranges = private_ranges - internet_block.fetch("except")
raise "Hive Internet egress includes private ranges: #{missing_ranges.join(", ")}" unless missing_ranges.empty?
raise "Hive dispatcher egress policy is missing" unless dispatcher_network
raise "Hive observer egress policy is missing" unless observer_network
observer_ports = observer_network.dig("spec", "egress")
  .flat_map { |rule| rule.fetch("ports", []) }
unless observer_ports.any? { |port| port["protocol"] == "UDP" && port["port"] == 53 } &&
       observer_ports.any? { |port| port["protocol"] == "TCP" && port["port"] == 7687 } &&
       observer_ports.none? { |port| port["port"] == 443 }
  raise "Hive observer may reach only DNS and Neo4j"
end
dispatcher_egress = dispatcher_network.dig("spec", "egress")
dispatcher_ports = dispatcher_egress.flat_map { |rule| rule.fetch("ports", []) }
unless dispatcher_ports.any? { |port| port["protocol"] == "UDP" && port["port"] == 53 } &&
       dispatcher_ports.any? { |port| port["protocol"] == "TCP" && port["port"] == 7687 } &&
       dispatcher_ports.any? { |port| port["protocol"] == "TCP" && port["port"] == 8080 } &&
       dispatcher_ports.any? { |port| port["protocol"] == "TCP" && port["port"] == 443 }
  raise "Hive dispatcher must reach DNS, Neo4j, the reaper, and GitHub"
end
dispatcher_internet = dispatcher_egress
  .flat_map { |rule| rule.fetch("to", []) }
  .map { |destination| destination["ipBlock"] }
  .compact
  .find { |block| block["cidr"] == "0.0.0.0/0" }
unless dispatcher_internet && (private_ranges - dispatcher_internet.fetch("except")).empty?
  raise "Hive dispatcher Internet egress must exclude private ranges"
end
raise "Hive reaper NetworkPolicy is missing" unless reaper_network
reaper_callers = reaper_network.dig("spec", "ingress")
  .flat_map { |rule| rule.fetch("from", []) }
  .map { |source| source.dig("podSelector", "matchLabels", "app.kubernetes.io/name") }
unless reaper_callers.include?("hive") && reaper_callers.include?("hive-workbench-dispatcher")
  raise "Hive reaper must admit workers and the Workbench dispatcher"
end
unless reaper_deployment.dig("spec", "template", "spec", "serviceAccountName") ==
       "hive-reaper-controller"
  raise "Hive reaper controller must use a distinct Pod-deletion identity"
end
reaper_rbac = load_yaml_stream.call("infra/k0s/manifests/hive/lifecycle-rbac.yaml")
  .find do |document|
    document["kind"] == "Role" &&
      document.dig("metadata", "name") == "hive-reaper-controller"
  end
reconciled_policies = reaper_rbac.fetch("rules")
  .find { |rule| rule["resources"] == ["networkpolicies"] }
  .fetch("resourceNames")
unless reconciled_policies.sort == %w[
  hive-dispatcher-reaper
  hive-observer-egress
  hive-worker-egress
]
  raise "Hive reaper RBAC must cover every reconciled NetworkPolicy"
end
reaper_pod = reaper_deployment.dig("spec", "template", "spec")
unless reaper_pod.dig("securityContext", "fsGroup") == 1000 &&
       reaper_pod.dig("securityContext", "fsGroupChangePolicy") == "OnRootMismatch"
  raise "Hive reaper controller must read projected credentials as its non-root group"
end
reaper_volumes = reaper_pod.fetch("volumes").to_h { |volume| [volume.fetch("name"), volume] }
unless reaper_volumes.dig("reaper-auth", "secret", "defaultMode") == 0o440 &&
       reaper_volumes.dig("kubernetes-api", "projected", "defaultMode") == 0o440
  raise "Hive reaper credentials must remain group-readable and not world-readable"
end
reaper_command = reaper_deployment
  .dig("spec", "template", "spec", "containers")
  .find { |container| container["name"] == "controller" }
  .fetch("command")
unless reaper_command == [
  "/usr/local/bin/bun",
  "/usr/local/share/nook/hive-reaper-controller.ts"
]
  raise "Hive reaper controller must run through the pinned Bun runtime"
end
reaper_source = File.read(
  File.join(root, "agentic-ai/minds/hive/controller/reaper.ts")
)
unless reaper_source.include?('const tokenPath = "/run/kubernetes/token"') &&
       reaper_source.include?('const reaperTokenPath = "/run/reaper-auth/token"') &&
       reaper_source.include?("async reconcileNeo4jPolicy()") &&
       reaper_source.include?('"hive-observer-egress"') &&
       reaper_source.include?("resourceVersion: policy.metadata.resourceVersion") &&
       reaper_source.include?("error.status !== 409") &&
       reaper_source.include?("Bun.sleep(10_000)")
  raise "Hive reaper controller must reload credentials and reject stale policy writes"
end

kata = load_yaml.call("infra/k0s/manifests/kata/values.yaml")
unless kata.dig("image", "reference")&.match?(/\A[^@]+@sha256:[0-9a-f]{64}\z/)
  raise "Kata installer image is not pinned by digest"
end

neo4j = load_yaml.call("infra/k0s/manifests/neo4j/values.yaml")
unless neo4j.dig("image", "customImage")&.match?(/\A[^@]+@sha256:[0-9a-f]{64}\z/)
  raise "Neo4j image is not pinned by digest"
end
unless neo4j.dig("services", "neo4j", "enabled") == false
  raise "Neo4j external LoadBalancer must remain disabled"
end
unless neo4j.dig("ssl", "bolt", "privateKey", "secretName") == "hive-neo4j-tls" &&
       neo4j.dig("ssl", "bolt", "publicCertificate", "secretName") == "hive-neo4j-tls"
  raise "Neo4j Bolt TLS certificate configuration is incomplete"
end
unless neo4j.dig("config", "server.bolt.tls_level") == "REQUIRED"
  raise "Neo4j Bolt listener must require TLS"
end

zot_resources = load_yaml_stream.call("infra/k0s/manifests/registry/zot.yaml").compact
zot_resource = lambda do |kind, name|
  zot_resources.find do |resource|
    resource["kind"] == kind && resource.dig("metadata", "name") == name
  end || raise("Missing Zot #{kind} #{name}")
end
zot_config = JSON.parse(
  zot_resource.call("ConfigMap", "nook-zot").dig("data", "config.json")
)
unless zot_config.dig("storage", "rootDirectory") == "/var/lib/registry" &&
       zot_config.dig("storage", "dedupe") == true &&
       zot_config.dig("storage", "gc") == true
  raise "Zot must use persistent deduplicated storage with garbage collection"
end
unless zot_config.dig("http", "compat") == ["docker2s2"]
  raise "Zot must preserve Docker Schema 2 manifests and digests"
end
zot_mirror = zot_config.dig("extensions", "sync", "registries")&.find do |registry|
  registry["urls"] == ["https://index.docker.io"]
end
unless zot_config.dig("extensions", "sync", "enable") == true &&
       zot_mirror&.fetch("onDemand") == true &&
       zot_mirror&.fetch("tlsVerify") == true &&
       zot_mirror&.fetch("preserveDigest") == true
  raise "Zot must be the digest-preserving on-demand Docker Hub mirror"
end
unless zot_config.dig(
  "http", "accessControl", "repositories", "**", "anonymousPolicy"
) == ["read"]
  raise "Public upstream images must be readable through Zot without runner credentials"
end
unless zot_config.dig(
  "http", "accessControl", "repositories", "nook-hive", "policies"
)&.any? do |policy|
  policy["users"] == ["__NOOK_REGISTRY_USERNAME__"] &&
    policy["actions"]&.sort == %w[create delete read update]
end
  raise "Private Hive images must not inherit anonymous mirror access"
end
zot_pv = zot_resource.call("PersistentVolume", "nook-zot-data")
unless zot_pv.dig("spec", "persistentVolumeReclaimPolicy") == "Retain" &&
       zot_pv.dig("spec", "local", "path") == "/var/lib/hive/zot"
  raise "Zot data must use the retained host-local volume"
end
zot_pvc = zot_resource.call("PersistentVolumeClaim", "nook-zot-data")
unless zot_pvc.dig("spec", "volumeName") == "nook-zot-data" &&
       zot_pvc.dig("spec", "storageClassName") == "nook-zot-local-retain"
  raise "Zot PVC must bind only the retained Zot volume"
end
zot_deployment = zot_resource.call("Deployment", "nook-zot")
zot_pod = zot_deployment.dig("spec", "template", "spec")
zot_container = zot_pod.fetch("containers").find { |container| container["name"] == "zot" }
unless zot_deployment.dig("spec", "strategy", "type") == "Recreate" &&
       zot_pod["automountServiceAccountToken"] == false &&
       zot_pod.dig("securityContext", "runAsNonRoot") == true &&
       zot_container.dig("securityContext", "readOnlyRootFilesystem") == true &&
       zot_container.dig("securityContext", "allowPrivilegeEscalation") == false &&
       zot_container.dig("securityContext", "capabilities", "drop")&.include?("ALL")
  raise "Zot workload hardening is incomplete"
end
unless zot_container["image"]&.match?(
  %r{\Aghcr\.io/project-zot/zot-linux-amd64@sha256:[0-9a-f]{64}\z}
)
  raise "Zot image must use the upstream platform image pinned by digest"
end
zot_service = zot_resource.call("Service", "nook-zot")
unless zot_service.dig("spec", "type") == "ClusterIP" &&
       zot_service.dig("spec", "clusterIP") == "10.96.90.10" &&
       zot_service.dig("spec", "ports")&.any? { |port| port["port"] == 5000 }
  raise "Zot must expose only a fixed ClusterIP Service for Traefik"
end
if zot_resources.any? { |resource| %w[Ingress HTTPRoute NodePort LoadBalancer].include?(resource["kind"]) } ||
   zot_service.dig("spec", "type") != "ClusterIP"
  raise "Zot must not have a public Kubernetes Ingress/NodePort/LoadBalancer endpoint"
end
zot_network = zot_resource.call("NetworkPolicy", "nook-zot")
ingress_ports = zot_network.dig("spec", "ingress")&.flat_map { |rule| rule["ports"] || [] } || []
unless zot_network.dig("spec", "policyTypes")&.sort == %w[Egress Ingress] &&
       ingress_ports.any? { |port| port["port"] == 5000 && port["protocol"] == "TCP" }
  raise "Zot NetworkPolicy must allow only registry TCP/5000 ingress to the ClusterIP path"
end
htpasswd_volume = zot_pod.fetch("volumes").find { |volume| volume["name"] == "htpasswd" }
unless htpasswd_volume&.dig("secret", "secretName") == "nook-zot-htpasswd"
  raise "Zot must mount the htpasswd Secret"
end
unless zot_container.dig("volumeMounts")&.any? { |mount| mount["name"] == "htpasswd" }
  raise "Zot container must mount htpasswd auth material"
end

infra_root_path = File.join(root, "infra/Taskfile.yml")
infra_root = File.read(infra_root_path)
infra_taskfiles = infra_root
  .scan(/^\s+taskfile:\s+(tasks\/[a-z0-9-]+\.yml)\s*$/)
  .flatten
  .map { |relative_path| File.join(root, "infra", relative_path) }
available_taskfiles = Dir.glob(File.join(root, "infra/tasks/*.yml")).sort
unless infra_taskfiles.sort == available_taskfiles
  raise "Every infrastructure domain Taskfile must be reachable from infra/Taskfile.yml"
end
infra_taskfiles.unshift(infra_root_path)
infra_taskfile = infra_taskfiles.map { |path| File.read(path) }.join("\n")
kata_tasks = File.read(File.join(root, "infra/tasks/kata.yml"))
hive_tasks = File.read(File.join(root, "infra/tasks/hive.yml"))
hive_deploy_task = hive_tasks.match(
  /^  hive:deploy:\n(?<body>.*?)(?=^  hive:seccomp:install:)/m
)&.[](:body)
hive_seccomp_task = hive_tasks.match(
  /^  hive:seccomp:install:\n(?<body>.*?)(?=^  hive:diagnose:)/m
)&.[](:body)
kata_guest_seccomp_task = kata_tasks.match(
  /^  kata:guest-seccomp:enable:\n(?<body>.*?)(?=^  kata:diagnose:)/m
)&.[](:body)
seccomp_profile = load_yaml.call("infra/k0s/seccomp/hive-bubblewrap.json")
allowed_syscalls = seccomp_profile
  .fetch("syscalls")
  .select { |rule| rule["action"] == "SCMP_ACT_ALLOW" }
  .flat_map { |rule| rule.fetch("names") }
unless seccomp_profile["defaultAction"] == "SCMP_ACT_ERRNO" &&
       %w[clone clone3 mount pivot_root setns umount2 unshare].all? do |name|
         allowed_syscalls.include?(name)
       end &&
       !allowed_syscalls.include?("bpf") &&
       !allowed_syscalls.include?("perf_event_open") &&
       kata_guest_seccomp_task&.include?("disable_guest_seccomp = false") &&
       kata_guest_seccomp_task&.include?("katacontainers.io/kata-runtime=true") &&
       kata_guest_seccomp_task&.include?("control-storage") &&
       kata_guest_seccomp_task&.include?("Deferred guest seccomp on offline Kata node") &&
       kata_guest_seccomp_task&.include?('-J "$controller_target"') &&
       hive_deploy_task&.include?("task: kata:guest-seccomp:enable") &&
       hive_deploy_task&.include?("task: hive:seccomp:install") &&
       hive_seccomp_task&.include?("/var/lib/k0s/kubelet/seccomp/nook") &&
       hive_seccomp_task&.include?("nook.nokey.sh/node-role=compute") &&
       hive_seccomp_task&.include?("No compute nodes require the Hive seccomp profile yet") &&
       hive_seccomp_task&.include?("Deferred Hive seccomp on offline compute node") &&
       hive_seccomp_task&.include?('-J "$controller_target"')
  raise "Hive deploy must install its deny-by-default Bubblewrap seccomp profile"
end
unless hive_deploy_task&.include?('if test "$desired_hive_replicas" = 0; then') &&
       hive_deploy_task&.include?("Hive workloads are intentionally paused at zero replicas")
  raise "Paused Hive deployment must not wait for or inspect live workers"
end
kubernetes_tools_task = infra_taskfile.match(
  /^  kubernetes:tools:install:\n(?<body>.*?)(?=^  kubernetes:tools:status:)/m
)&.[](:body)
raise "Kubernetes operator tools install task is missing" unless kubernetes_tools_task
unless kubernetes_tools_task.include?("https://dl.k8s.io/release/$kubectl_version/bin/linux/amd64/kubectl") &&
       kubernetes_tools_task.include?("https://get.helm.sh/$helm_asset") &&
       kubernetes_tools_task.include?("https://github.com/derailed/k9s/releases/download/$k9s_version/$k9s_asset") &&
       kubernetes_tools_task.scan("sha256sum --check").length >= 3 &&
       kubernetes_tools_task.include?("/usr/local/bin/kubectl") &&
       kubernetes_tools_task.include?("/usr/local/bin/helm") &&
       kubernetes_tools_task.include?("/usr/local/bin/k9s")
  raise "Kubernetes operator tools must use pinned verified standalone binaries"
end
unless infra_taskfile.include?("create token nook-operator") &&
       infra_taskfile.include?("--duration=15m") &&
       infra_taskfile.include?("client.authentication.k8s.io/v1") &&
       infra_taskfile.include?("--exec-interactive-mode=Never") &&
       infra_taskfile.include?("! grep -Eq 'client-(certificate|key)-data:'") &&
       infra_taskfile.include?('chmod 0600 "$kubeconfig"') &&
       infra_taskfile.include?('[ "$existing_clusters" = local ]') &&
       infra_taskfile.include?('[ "$existing_contexts" = Default ]') &&
       infra_taskfile.include?('[ "$existing_users" = user ]') &&
       infra_taskfile.include?('Refusing to replace existing $default_kubeconfig') &&
       infra_taskfile.include?("kubectl get --raw=/readyz")
  raise "Kubernetes console must use short-lived direct SSH credentials"
end
k0s_install_task = infra_taskfile.match(
  /^  k0s:install:\n(?<body>.*?)(?=^  k0s:status:)/m
)&.[](:body)
raise "k0s install task is missing" unless k0s_install_task
k0s_status_task = infra_taskfile.match(
  /^  k0s:status:\n(?<body>.*?)(?=^  k0s:network:refresh:)/m
)&.[](:body)
raise "k0s status task is missing" unless k0s_status_task
unless infra_taskfile.include?("--exclude='agentic-ai/minds/target'")
  raise "Hive source synchronization does not exclude Rust build output"
end
formatter_sync_program = infra_taskfile.match(
  /IFS= read -r -d '' formatter_sync_program <<'FORMATTER_SYNC' \|\| true\n(?<body>.*?)^        FORMATTER_SYNC$/m
)&.[](:body)
raise "Formatter sync replacement program is missing" unless formatter_sync_program
Dir.mktmpdir("nook-formatter-sync-source") do |source|
  Dir.mktmpdir("nook-formatter-sync-remote") do |remote_parent|
    remote = File.join(remote_parent, "home", "nook", ".local", "share", "nook-infra")
    source_formatter = File.join(source, ".github", "formatting")
    remote_formatter = File.join(remote, ".github", "formatting")
    FileUtils.mkdir_p(source_formatter)
    FileUtils.mkdir_p(remote_formatter)
    File.write(File.join(source_formatter, "current"), "current\n")
    File.write(File.join(remote_formatter, "removed"), "stale\n")
    pipeline = Open3.pipeline(
      ["tar", "-cf", "-", ".github/formatting"],
      ["bash", "-c", formatter_sync_program, "--", remote, File.join(remote_parent, "home")],
      chdir: source
    )
    unless pipeline.all?(&:success?) &&
           File.read(File.join(remote_formatter, "current")) == "current\n" &&
           !File.exist?(File.join(remote_formatter, "removed"))
      raise "Formatter sync must replace the staged directory and remove stale files"
    end
  end
end
unless infra_taskfile.include?(
         '--build-context "nook-sccache-helpers=$remote_dir/nook-app/nook-platform/docker"'
       ) &&
       infra_taskfile.include?(
         '--build-context "nook-formatter=$remote_dir/.github/formatting"'
       ) &&
       infra_taskfile.include?('"$remote_dir/.github/formatting"') &&
       infra_taskfile.include?("nook-app/nook-platform/docker/sccache-wrapper.sh")
  raise "Hive deployment build is missing a named external tool context"
end
normalized_recovery_key = "tr -d '\\r\\n' > \"$recovery_key\""
unless infra_taskfile.include?("neo4j-secrets.yaml.hmac") &&
       infra_taskfile.include?("openssl dgst -sha256 -mac HMAC") &&
       infra_taskfile.scan(normalized_recovery_key).length == 2 &&
       infra_taskfile.include?('test "$actual_mac" = "$expected_mac_value"') &&
       infra_taskfile.include?("hive-system/hive-codex-auth") &&
       infra_taskfile.include?("hive-system/hive-github-publication")
  raise "Hive recovery snapshots are not authenticated before restore"
end
unless infra_taskfile.include?("chown root:root") &&
       infra_taskfile.include?("chmod 0600") &&
       infra_taskfile.include?(
         "--modify user:kube-apiserver:r--,mask::r--"
       )
  raise "k0s encryption provider must use root ownership and a read-only API-server ACL"
end
if infra_taskfile.include?("chown kube-apiserver:root")
  raise "kube-apiserver must not own the writable encryption provider"
end
unless infra_taskfile.include?(
  "sudo -n test -f /etc/systemd/system/k0scontroller.service"
)
  raise "k0s install must detect the existing controller unit idempotently"
end
unless infra_taskfile.include?("kubectl get nodes -o name") &&
       infra_taskfile.include?("grep -q '^node/'")
  raise "k0s install must wait for worker registration before Node readiness"
end
unless infra_taskfile.include?("nook-k0s.nft") &&
       infra_taskfile.include?(
         '^[[:space:]]*include[[:space:]]+"/etc/nftables.d/nook-k0s\.nft"'
       ) &&
       infra_taskfile.include?(
         'input iifname "kube-bridge" ip saddr 10.244.0.0/16 tcp dport { 6443, 8132, 10250 }'
       ) &&
       infra_taskfile.include?(
         'forward iifname "kube-bridge" ip saddr 10.244.0.0/16 accept'
       ) &&
       infra_taskfile.include?("nft --handle list chain") &&
       infra_taskfile.include?("nft delete rule") &&
       k0s_install_task.include?("set -Eeuo pipefail") &&
       k0s_install_task.include?("trap rollback_k0s_firewall ERR") &&
       k0s_install_task.include?("trap rollback_k0s_firewall EXIT") &&
       k0s_install_task.include?("trap 'exit 129' HUP") &&
       k0s_install_task.include?("trap 'exit 130' INT") &&
       k0s_install_task.include?("trap 'exit 143' TERM") &&
       k0s_install_task.include?('> "$firewall_previous_live"') &&
       k0s_install_task.include?("flush chain inet bynull_filter") &&
       k0s_install_task.include?('nft --file "$firewall_previous_live"') &&
       infra_taskfile.include?("rm -f /etc/nftables.d/nook-k0s.nft") &&
       infra_taskfile.include?("nft --check --file") &&
       !infra_taskfile.include?("systemctl reload nftables")
  raise "k0s install must persist narrow Pod control-plane and egress firewall rules"
end
firewall_rollback = k0s_install_task.index("trap rollback_k0s_firewall ERR")
k0s_download = k0s_install_task.index('k0s_asset="k0s-${k0s_version}-amd64"')
k0s_final_status = k0s_install_task.rindex("sudo -n k0s status")
firewall_commit = k0s_install_task.rindex("trap - ERR")
unless firewall_rollback && k0s_download && k0s_final_status && firewall_commit &&
       firewall_rollback < k0s_download &&
       k0s_final_status < firewall_commit
  raise "k0s firewall rollback must remain armed through final install verification"
end
unless k0s_install_task.index('> "$firewall_previous_live"') <
       k0s_install_task.index("trap rollback_k0s_firewall ERR")
  raise "k0s firewall rollback must snapshot live owned rules before mutation"
end
unless k0s_install_task.scan(/trap .*EXIT/).length == 2
  raise "k0s temporary cleanup must not replace the armed firewall EXIT rollback"
end
unless infra_taskfile.scan('nft list chain inet bynull_filter forward |').length >= 3 &&
       infra_taskfile.scan('grep -E "policy drop" >/dev/null').length >= 4
  raise "k0s operations must enforce default-drop input and forward policies"
end
docker_version_check = infra_taskfile.index(
  "case \"$(docker version --format"
)
compose_shutdown = infra_taskfile.index(
  'docker compose --file "$compose_file" down --remove-orphans'
)
docker_chain_repair = infra_taskfile.index(
  "sudo -n iptables --table nat --new-chain DOCKER"
)
unless docker_version_check && docker_chain_repair && compose_shutdown &&
       docker_version_check < docker_chain_repair &&
       docker_chain_repair < compose_shutdown
  raise "Docker recovery must verify compatibility and restore chains before stopping services"
end
k0s_config = load_yaml.call("infra/k0s/config/k0s.yaml")
unless k0s_config.dig("spec", "network", "kuberouter", "ipMasq") == true
  raise "k0s must masquerade Pod traffic destined outside the cluster"
end
unless k0s_config.dig("spec", "api", "address") == "10.201.0.1" &&
       k0s_config.dig("spec", "api", "sans").include?("10.201.0.1") &&
       infra_taskfile.include?("K0S_API_ADDRESS: 10.201.0.1") &&
       infra_taskfile.include?("nook-k0s-api-address.service") &&
       infra_taskfile.include?(
         "ExecStart=/usr/sbin/ip address replace 10.201.0.1/32 dev lo"
       ) &&
       infra_taskfile.include?(
         "systemctl enable nook-k0s-api-address.service"
       ) &&
       infra_taskfile.include?(
         "systemctl restart nook-k0s-api-address.service"
       ) &&
       infra_taskfile.include?(
         "systemctl is-enabled --quiet nook-k0s-api-address.service"
       ) &&
       infra_taskfile.include?(
         "systemctl is-active --quiet nook-k0s-api-address.service"
       )
  raise "k0s must expose its API on the stable Hive loopback address"
end
policy_refresh = k0s_install_task.index(
  "kubectl patch networkpolicy \"$policy\""
)
controller_restart = k0s_install_task.index(
  "systemctl restart k0scontroller"
)
unless policy_refresh && controller_restart && policy_refresh < controller_restart
  raise "k0s upgrades must allow the stable API endpoint before controller restart"
end
unless k0s_install_task.include?('path: "/spec/egress/-"') &&
       k0s_install_task.include?('ports: [{protocol: "TCP", port: 6443}]')
  raise "legacy Hive policies must gain a complete stable API egress rule"
end
unless k0s_install_task.include?(
         "name: hive-worker-kubernetes-api"
       ) &&
       k0s_install_task.include?(
         "kubectl apply -f -"
       )
  raise "legacy Hive workers must gain a transitional stable API policy"
end
unless k0s_status_task.include?(
         "systemctl is-enabled --quiet nook-k0s-api-address.service"
       ) &&
       k0s_status_task.include?(
         "systemctl is-active --quiet nook-k0s-api-address.service"
       ) &&
       k0s_status_task.include?(
         "grep -F '{{.K0S_API_ADDRESS}}/32'"
       )
  raise "k0s status must verify persistent stable API address state"
end
unless k0s_status_task.include?("/etc/nftables.conf") &&
       k0s_status_task.include?("/etc/nftables.d/nook-k0s.nft") &&
       k0s_status_task.include?("cmp --silent") &&
       k0s_status_task.include?('input_rules="$(sudo -n nft list chain') &&
       k0s_status_task.include?('forward_rules="$(sudo -n nft list chain') &&
       k0s_status_task.scan("grep -Ec").length >= 2
  raise "k0s status must verify exact persisted and unique live firewall state"
end
unless infra_taskfile.include?(
         '-f "$remote_dir/infra/k0s/manifests/hive/lifecycle-rbac.yaml"'
       ) &&
       infra_taskfile.include?(
         'kubectl rollout status deployment/hive-reaper-controller'
       )
  raise "standalone Neo4j upgrades must deploy the endpoint-policy reconciler"
end
unless infra_taskfile.include?("rollout restart deployment/coredns") &&
       infra_taskfile.include?("rollout status deployment/coredns") &&
       infra_taskfile.include?("cni_config=/etc/cni/net.d/10-kuberouter.conflist") &&
       k0s_install_task.index("cni_was_unmasqueraded=false") <
       k0s_install_task.index("systemctl restart k0scontroller") &&
       infra_taskfile.include?(".ipMasq = true") &&
       infra_taskfile.include?('if test "$cni_migrated" = true') &&
       infra_taskfile.include?("hive-workbench-dispatcher") &&
       infra_taskfile.include?("hive-reaper-controller")
  raise "k0s install must refresh CoreDNS after applying CNI configuration"
end
unless infra_taskfile.include?("k0s:network:refresh:") &&
       infra_taskfile.include?("Recreate egress-capable Pods")
  raise "k0s must expose a Taskfile-owned CNI migration refresh"
end
unless infra_taskfile.include?("docker build") &&
       infra_taskfile.include?("--network host") &&
       infra_taskfile.include?("secret_args=()") &&
       infra_taskfile.include?(
         'if test -s "$access_file" && test -s "$secret_file"'
       ) &&
       infra_taskfile.include?(
         '--secret "id=sccache_s3_access_key,src=$access_file"'
       ) &&
       infra_taskfile.include?(
         '--secret "id=sccache_s3_secret_key,src=$secret_file"'
       )
  raise "Hive image builds must optionally use authenticated SeaweedFS S3 sccache"
end
unless infra_taskfile.include?("hive:diagnose:") &&
       infra_taskfile.include?("kubectl get endpoints kubernetes") &&
       infra_taskfile.include?('.name == "hive" and .ready == true') &&
       infra_taskfile.match?(/base64 --decode\s+\|\s+sha256sum/)
  raise "Hive deployment diagnostics, lifecycle selection, or secret rollout checks are incomplete"
end
k0s_api_rule = api_network.dig("spec", "egress").any? do |rule|
  rule.fetch("to", []).any? do |destination|
    destination.dig("ipBlock", "cidr") == "HIVE_K0S_API_CIDR"
  end &&
    rule.fetch("ports", []).any? do |port|
      port["protocol"] == "TCP" && port["port"] == 6443
    end
end
unless k0s_api_rule
  raise "Hive workers must reach the real k0s API endpoint after Service DNAT"
end
neo4j_rule = network.dig("spec", "egress").any? do |rule|
  cidrs = rule.fetch("to", []).map { |destination| destination.dig("ipBlock", "cidr") }.compact
  cidrs.include?("HIVE_NEO4J_SERVICE_CIDR") &&
    cidrs.include?("HIVE_NEO4J_ENDPOINT_CIDR") &&
    rule.fetch("ports", []).any? do |port|
      port["protocol"] == "TCP" && port["port"] == 7687
    end
end
unless neo4j_rule
  raise "Hive workers must reach Neo4j before and after Service DNAT"
end
unless infra_taskfile.scan("kubectl get service hive-neo4j").length >= 2 &&
       infra_taskfile.scan("kubectl get endpoints hive-neo4j").length >= 2 &&
       infra_taskfile.include?("current_neo4j_endpoint_ip") &&
       infra_taskfile.scan('k0s_api_ip="{{.K0S_API_ADDRESS}}"').length >= 2 &&
       infra_taskfile.scan(
         's|HIVE_NEO4J_SERVICE_CIDR|$neo4j_service_ip/32|g'
       ).length >= 2 &&
       infra_taskfile.scan(
         's|HIVE_NEO4J_ENDPOINT_CIDR|$neo4j_endpoint_ip/32|g'
       ).length >= 2 &&
       infra_taskfile.scan(
         's|HIVE_K0S_API_CIDR|$k0s_api_ip/32|g'
       ).length >= 2
  raise "Hive NetworkPolicy must use live data endpoints and the stable k0s API address"
end
hive_taskfile = File.read(File.join(root, "agentic-ai/minds/hive/Taskfile.yml"))
unless hive_taskfile.include?('docker cp "$container:/build/hive/src" "$formatted/hive-src"')
  raise "Hive formatting does not apply the entire checked workspace"
end
unless hive_taskfile.include?("--target verify-export") &&
       hive_taskfile.include?("--target test-export") &&
       hive_taskfile.include?('type=local,dest=$verified') &&
       hive_taskfile.include?('test -f "$verified/hive-sandbox-package-passed"') &&
       !hive_taskfile.include?("--target test-runner") &&
       !hive_taskfile.include?("--load")
  raise "Hive verification must export only tests and sandbox package proof from BuildKit"
end
unless hive_taskfile.include?('if [ -n "${HIVE_NEO4J_TEST_URI:-}" ]') &&
       !hive_taskfile.include?(
         'HIVE_NEO4J_TEST_URI=${HIVE_NEO4J_TEST_URI:-127.0.0.1:7687}'
       )
  raise "standalone Hive tests must keep destructive Neo4j integration opt-in"
end

unless infra_taskfile.include?("hive:queue:status:") &&
       infra_taskfile.include?("hive:queue:retry:") &&
       infra_taskfile.include?("hive:queue:cancel:") &&
       infra_taskfile.include?("/usr/local/bin/hive queue status") &&
       infra_taskfile.include?("/usr/local/bin/hive queue retry-failed-main") &&
       infra_taskfile.include?("/usr/local/bin/hive queue cancel") &&
       infra_taskfile.include?('--release-id "$release_id"')
  raise "Hive queue inspection, cancellation, and bounded failed-task recovery must remain Taskfile-owned"
end
hive_dockerfile = File.read(File.join(root, "agentic-ai/minds/hive/Dockerfile"))
unless hive_dockerfile.include?(
  "COPY hive/controller/reaper.ts /usr/local/share/nook/hive-reaper-controller.ts"
)
  raise "Hive runtime must copy the reaper controller from the minds build context"
end
hive_sandbox_wrapper = File.read(
  File.join(root, "agentic-ai/minds/hive/docker/codex-linux-sandbox-no-proc.sh")
)
unless hive_dockerfile.match?(/apt-get install.*?bubblewrap/m)
  raise "Hive runtime must include bubblewrap for the Codex workspace sandbox"
end
unless hive_dockerfile.include?("FROM toolchain AS sandbox-package-check") &&
       hive_dockerfile.include?("bwrap --version") &&
       hive_dockerfile.include?(
         "COPY --from=sandbox-package-check /opt/nook/hive-sandbox-package-passed"
       )
  raise "Hive verification must prove the Bubblewrap package is executable"
end
unless hive_dockerfile.include?(
         "COPY hive/docker/codex-linux-sandbox-no-proc.sh /usr/local/bin/hive-codex-linux-sandbox"
       ) &&
       hive_sandbox_wrapper.include?(
         "exec -a codex-linux-sandbox /usr/local/bin/hive --no-proc"
       )
  raise "Hive runtime must inject Codex's nested Restricted-Pod procfs mode"
end
unless infra_taskfile.include?('kubectl exec "$old_pod"') &&
       infra_taskfile.include?("/usr/bin/setpriv --no-new-privs") &&
       infra_taskfile.include?("/usr/bin/bwrap") &&
       infra_taskfile.include?("--unshare-pid") &&
       infra_taskfile.include?("--ro-bind / /") &&
       infra_taskfile.include?("--bind /workspace /workspace") &&
       infra_taskfile.include?("awk '/^Seccomp:/ {print $2}' /proc/self/status")
  raise "Hive deployment must exercise Bubblewrap inside the live Kata worker"
end
unless hive_dockerfile.match?(/apt-get install.*?gh/m)
  raise "Trusted Hive agents must include the standard GitHub CLI"
end
unless hive_dockerfile.include?(
         'SHELL ["/bin/bash", "-o", "pipefail", "-c"]'
       ) &&
       hive_dockerfile.include?("FROM scratch AS test-export") &&
       hive_dockerfile.include?(
         "COPY --from=test-compile /opt/nook/hive-tests /hive-tests"
       )
  raise "Hive test compilation must propagate Cargo failures and export from scratch"
end
unless hive_taskfile.include?("--target cache-publish") &&
       hive_dockerfile.include?("FROM fetched-dependencies AS test-dependencies") &&
       hive_dockerfile.include?("FROM fetched-dependencies AS clippy-dependencies") &&
       hive_dockerfile.include?("FROM scratch AS cache-publish") &&
       hive_dockerfile.include?("hive-test-dependencies") &&
       hive_dockerfile.include?("hive-clippy-dependencies") &&
       hive_taskfile.include?('HIVE_CACHE_TO')
  raise "Hive cache publication must export release and parallel verification dependency graphs"
end
unless hive_dockerfile.include?("ENV CARGO_BUILD_JOBS=2")
  raise "Hive parallel Cargo branches must fit the ARC CPU and memory envelope"
end
unless hive_taskfile.scan('command+=(--cache-from "$HIVE_CACHE_SEED_FROM")').length == 4
  raise "Hive verification must restore its git-scoped Remote cache before trusted Main fallback"
end
unless hive_taskfile.scan('--build-arg "SCCACHE_ENDPOINT=${SCCACHE_ENDPOINT:-https://sccache.dev.nokey.sh}"').length == 4 &&
       hive_taskfile.scan('--build-arg "SCCACHE_BUCKET=${SCCACHE_BUCKET:-nook-sccache}"').length == 4
  raise "Every Hive BuildKit path must forward the configured SeaweedFS location"
end
hive_delivery_workflow = File.read(File.join(root, ".github/workflows/hive.yml"))
unless hive_delivery_workflow.include?("HIVE_CACHE_TO: type=registry") &&
       hive_delivery_workflow.include?("mode=max,timeout=15m")
  raise "Hive cache publication must permit large registry layer uploads to finish"
end
unless hive_taskfile.include?('${HOME}/.nook/cache/sccache-access-key') &&
       hive_taskfile.include?('${HOME}/.nook/cache/sccache-secret-key') &&
       hive_taskfile.include?(
         '--secret "id=sccache_s3_access_key,src=$access_file"'
       ) &&
       hive_taskfile.include?(
         '--secret "id=sccache_s3_secret_key,src=$secret_file"'
       )
  raise "Hive local verification must consume ignored SeaweedFS S3 credentials as BuildKit secrets"
end
unless hive_taskfile.include?("Refusing oversized Hive test export") &&
       hive_taskfile.include?("524288")
  raise "Hive test artifact exports must have a hard size ceiling"
end
if hive_taskfile.include?("host.docker.internal")
  raise "Hive verification must not depend on Docker Desktop host aliases"
end

hive_workflow = File.read(File.join(root, ".github/workflows/hive.yml"))
root_agentic_taskfile = File.read(File.join(root, ".task/agentic-ai.yml"))
guest_changed_formatter = root_agentic_taskfile.match(
  /^  hive:guest:format:changed:\n(?<body>.*?)(?=^  hive:guest:format:)/m
)&.[](:body)
guest_formatter = root_agentic_taskfile.match(
  /^  hive:guest:format:\n(?<body>.*?)(?=^  hive:guest:pr:ready:)/m
)&.[](:body)
unless guest_changed_formatter&.include?('NOOK_FORMATTER_ROOT:-/opt/nook-formatter') &&
       guest_changed_formatter.include?('bash "$formatter_root/format.sh"') &&
       guest_formatter&.include?("bash .github/scripts/format-host-apply.sh") &&
       !guest_changed_formatter.include?("bun install") &&
       !guest_formatter.include?("bun install")
  raise "Hive native sealed-guest formatting task is incomplete"
end

unless hive_dockerfile.include?("COPY --from=nook-formatter") &&
       hive_dockerfile.include?("/opt/nook-formatter/") &&
       hive_taskfile.scan('--build-context "nook-formatter={{.NOOK_FORMATTER_CONTEXT}}"').length == 8 &&
       hive_workflow.scan(".github/formatting/**").length == 2 &&
       infra_taskfile.include?(".github/formatting")
  raise "Hive runtime must bake and track the canonical external formatter bundle"
end

unless hive_workflow.scan("agentic-ai/minds/hive/controller/reaper.test.ts").length == 2
  raise "Hive controller behavior-test changes must trigger PR and Main verification"
end
unless hive_workflow.scan(".github/scripts/k0s-firewall-rollback-test.ts").length == 2
  raise "k0s firewall rollback-test changes must trigger PR and Main verification"
end
unless hive_workflow.include?("run: task hive:verify") &&
       !hive_workflow.include?("run: task hive:check") &&
       !hive_workflow.include?("run: task hive:test")
  raise "Hive workflow must use the parallel BuildKit verification join"
end

load File.join(__dir__, "hive-cache-contract.rb")

puts "Hive Kubernetes manifest contract: ok"
