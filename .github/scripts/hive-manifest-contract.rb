#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"
require "tmpdir"

root = File.expand_path("../..", __dir__)
load_yaml = lambda do |path|
  YAML.safe_load(File.read(File.join(root, path)), aliases: true)
end

deployment = load_yaml.call("infra/k0s/manifests/hive/deployment.yaml")
dispatcher_deployment = load_yaml.call("infra/k0s/manifests/hive/dispatcher.yaml")
observer_deployment = load_yaml.call("infra/k0s/manifests/hive/observer.yaml")
reaper_deployment = load_yaml.call("infra/k0s/manifests/hive/reaper-controller.yaml")
pod = deployment.fetch("spec").fetch("template").fetch("spec")
raise "Hive must keep four warm workers" unless deployment.dig("spec", "replicas") == 4
raise "Hive must use Kata Dragonball" unless pod["runtimeClassName"] == "kata-dragonball"
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
unless worker_environment["HIVE_CODEX_MODEL"] == "gpt-5.6-terra" &&
       worker_environment["HIVE_CODEX_REASONING_EFFORT"] == "low"
  raise "Hive workers must pin Codex GPT-5.6 with Light reasoning"
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
unless dispatcher_deployment.dig("spec", "replicas") == 1 &&
       dispatcher_deployment.dig("spec", "template", "spec", "runtimeClassName") ==
       "kata-dragonball" &&
       dispatcher_deployment.dig("spec", "template", "spec", "automountServiceAccountToken") ==
       false
  raise "Hive Workbench dispatcher must remain one token-free Kata replica"
end
observer_pod = observer_deployment.dig("spec", "template", "spec")
unless observer_deployment.dig("spec", "replicas") == 1 &&
       observer_pod["automountServiceAccountToken"] == false &&
       observer_pod["runtimeClassName"].nil?
  raise "Hive observer must remain one token-free infrastructure replica"
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
       dispatcher_environment["HIVE_WORKBENCH_CHECKOUT"] == "/tmp/nook-workbench"
  raise "Hive dispatcher must reconcile a cached public Workbench Git snapshot"
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
  .last
unless reaper_command.include?("token('/run/kubernetes/token')") &&
       reaper_command.include?('expected = token("/run/reaper-auth/token")') &&
       reaper_command.include?("def reconcile_neo4j_policy():") &&
       reaper_command.include?('"hive-observer-egress"') &&
       reaper_command.include?('"resourceVersion": policy["metadata"][') &&
       reaper_command.include?("if error.code != 409:") &&
       reaper_command.include?("time.sleep(10)")
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
       hive_deploy_task&.include?("task: kata:guest-seccomp:enable") &&
       hive_deploy_task&.include?("task: hive:seccomp:install") &&
       hive_seccomp_task&.include?("/var/lib/k0s/kubelet/seccomp/nook")
  raise "Hive deploy must install its deny-by-default Bubblewrap seccomp profile"
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
unless infra_taskfile.include?('--build-context "nook-app=$remote_dir/nook-app"') &&
       infra_taskfile.include?("nook-app/docker/sccache-wrapper.sh")
  raise "Hive deployment build is missing its named nook-app context"
end
unless infra_taskfile.include?("neo4j-secrets.yaml.hmac") &&
       infra_taskfile.include?("hmac.compare_digest") &&
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
       infra_taskfile.include?("if test -s \"$redis_password\"") &&
       infra_taskfile.include?(
         "--secret \"id=sccache_redis_password,src=$redis_password\""
       )
  raise "Hive image builds must optionally use authenticated Redis sccache"
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
unless hive_taskfile.include?("for crate in hive lace")
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
       infra_taskfile.include?("/usr/local/bin/hive queue status") &&
       infra_taskfile.include?("/usr/local/bin/hive queue retry-failed-main") &&
       infra_taskfile.include?('--release-id "$release_id"')
  raise "Hive queue inspection and bounded failed-task recovery must remain Taskfile-owned"
end
hive_dockerfile = File.read(File.join(root, "agentic-ai/minds/hive/Dockerfile"))
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
unless hive_taskfile.include?(
         'SCCACHE_REDIS_PASSWORD_FILE: \'{{default "../../.nook/cache/redis-password"'
       ) &&
       hive_taskfile.include?(
         '--secret "id=sccache_redis_password,src=$credential_file"'
       )
  raise "Hive local verification must consume the ignored Redis credential as a BuildKit secret"
end
unless hive_taskfile.include?("Refusing oversized Hive test export") &&
       hive_taskfile.include?("524288")
  raise "Hive test artifact exports must have a hard size ceiling"
end
if hive_taskfile.include?("host.docker.internal")
  raise "Hive verification must not depend on Docker Desktop host aliases"
end

root_agentic_taskfile = File.read(File.join(root, ".task/agentic-ai.yml"))
unless root_agentic_taskfile.include?("hive:guest:format:") &&
       root_agentic_taskfile.include?("cargo fmt --all") &&
       root_agentic_taskfile.include?("bun run format")
  raise "Hive native sealed-guest formatting task is incomplete"
end

hive_workflow = File.read(File.join(root, ".github/workflows/hive.yml"))
unless hive_workflow.scan(".github/scripts/hive-reaper-controller-test.py").length == 2
  raise "Hive controller behavior-test changes must trigger PR and Main verification"
end
unless hive_workflow.scan(".github/scripts/k0s-firewall-rollback-test.py").length == 2
  raise "k0s firewall rollback-test changes must trigger PR and Main verification"
end
unless hive_workflow.include?("run: task hive:verify") &&
       !hive_workflow.include?("run: task hive:check") &&
       !hive_workflow.include?("run: task hive:test")
  raise "Hive workflow must use the parallel BuildKit verification join"
end

puts "Hive Kubernetes manifest contract: ok"
