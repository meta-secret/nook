#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

root = File.expand_path("../..", __dir__)
load_yaml = lambda do |path|
  YAML.safe_load(File.read(File.join(root, path)), aliases: true)
end

deployment = load_yaml.call("infra/k0s/manifests/hive/deployment.yaml")
dispatcher_deployment = load_yaml.call("infra/k0s/manifests/hive/dispatcher.yaml")
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
publisher = pod.fetch("containers").find { |container| container.fetch("name") == "publication-broker" }
reaper = pod.fetch("containers").find { |container| container.fetch("name") == "pod-reaper" }
worker_mounts = worker.fetch("volumeMounts").map { |mount| mount.fetch("name") }
broker_mounts = broker.fetch("volumeMounts").map { |mount| mount.fetch("name") }
coordinator_mounts = coordinator.fetch("volumeMounts").map { |mount| mount.fetch("name") }
publisher_mounts = publisher.fetch("volumeMounts").map { |mount| mount.fetch("name") }
reaper_mounts = reaper.fetch("volumeMounts").map { |mount| mount.fetch("name") }
raise "Hive worker must not mount Codex credentials" if worker_mounts.include?("codex-auth-source")
raise "Hive worker must not mount the broker auth home" if worker_mounts.include?("broker-auth-home")
raise "Hive worker must not mount the broker API token" if worker_mounts.include?("broker-auth-api")
raise "Hive worker must not mount GitHub credentials" if worker_mounts.include?("github-publication")
unless broker_mounts.include?("codex-auth-source") &&
       broker_mounts.include?("broker-auth-home") &&
       broker_mounts.include?("broker-auth-api") &&
       worker_mounts.include?("auth-channel")
  raise "Hive auth broker boundary is incomplete"
end
worker_environment = worker.fetch("env").map { |entry| entry.fetch("name") }
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
unless publisher_mounts.include?("github-publication") &&
       publisher_mounts.include?("publication-channel") &&
       worker_mounts.include?("publication-channel")
  raise "Hive publication broker boundary is incomplete"
end
unless reaper_mounts.include?("reaper-auth") &&
       !reaper_mounts.include?("broker-auth-api") &&
       !reaper_mounts.include?("reaper-api")
  raise "Hive reaper must use only its opaque controller credential"
end
publisher_workspace = publisher
  .fetch("volumeMounts")
  .find { |mount| mount.fetch("name") == "workspace" }
unless publisher_workspace&.fetch("readOnly", false) == true
  raise "Hive publication broker must see the worker workspace read-only"
end
worker_environment = worker.fetch("env").to_h { |entry| [entry.fetch("name"), entry["value"]] }
unless worker_environment["HIVE_SEALED_GUEST"] == "1"
  raise "Hive worker must select native sealed-guest Taskfile formatting"
end
unless worker_environment["HIVE_TASK_TIMEOUT_SECONDS"] == "21600"
  raise "Hive worker must allow the complete six-hour repair lifecycle"
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
       reaper_command.include?('expected = token("/run/reaper-auth/token")')
  raise "Hive reaper controller must reload rotating credentials for every request"
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

infra_taskfile = File.read(File.join(root, "infra/Taskfile.yml"))
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
       infra_taskfile.include?("ip saddr 10.244.0.0/16 tcp dport { 6443, 8132, 10250 }") &&
       infra_taskfile.include?("forward ip saddr 10.244.0.0/16 accept") &&
       infra_taskfile.include?("nft --check --file") &&
       !infra_taskfile.include?("systemctl reload nftables")
  raise "k0s install must persist narrow Pod control-plane and egress firewall rules"
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
unless docker_version_check && compose_shutdown && docker_version_check < compose_shutdown
  raise "Docker recovery must verify compatibility before stopping services"
end
k0s_config = load_yaml.call("infra/k0s/config/k0s.yaml")
unless k0s_config.dig("spec", "network", "kuberouter", "ipMasq") == true
  raise "k0s must masquerade Pod traffic destined outside the cluster"
end
unless infra_taskfile.include?("rollout restart deployment/coredns") &&
       infra_taskfile.include?("rollout status deployment/coredns") &&
       infra_taskfile.include?("cni_config=/etc/cni/net.d/10-kuberouter.conflist") &&
       infra_taskfile.include?(".ipMasq = true")
  raise "k0s install must refresh CoreDNS after applying CNI configuration"
end
unless infra_taskfile.include?("k0s:network:refresh:") &&
       infra_taskfile.include?("Recreate egress-capable Pods")
  raise "k0s must expose a Taskfile-owned CNI migration refresh"
end
unless infra_taskfile.include?("docker build") &&
       infra_taskfile.include?("--network host") &&
       infra_taskfile.include?(
         "--secret \"id=sccache_redis_password,src=$redis_password\""
       )
  raise "Hive image builds must use host networking and authenticated Redis sccache"
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
network_policy_script = File.read(
  File.join(root, "infra/k0s/scripts/apply-hive-network-policy.sh")
)
unless network_policy_script.include?("kubectl get service hive-neo4j") &&
       network_policy_script.include?("kubectl get endpoints hive-neo4j") &&
       network_policy_script.include?("kubectl get endpoints kubernetes") &&
       network_policy_script.include?(
         's|HIVE_NEO4J_SERVICE_CIDR|$neo4j_service_ip/32|g'
       ) &&
       network_policy_script.include?(
         's|HIVE_NEO4J_ENDPOINT_CIDR|$neo4j_endpoint_ip/32|g'
       ) &&
       network_policy_script.include?(
         's|HIVE_K0S_API_CIDR|$k0s_api_ip/32|g'
       ) &&
       infra_taskfile.scan("apply-hive-network-policy.sh").length >= 2
  raise "Hive NetworkPolicy endpoints must be discovered from the live cluster"
end
hive_taskfile = File.read(File.join(root, "agentic-ai/minds/hive/Taskfile.yml"))
unless hive_taskfile.include?("for crate in hive lace")
  raise "Hive formatting does not apply the entire checked workspace"
end

root_agentic_taskfile = File.read(File.join(root, ".task/agentic-ai.yml"))
unless root_agentic_taskfile.include?("hive:guest:format:") &&
       root_agentic_taskfile.include?("cargo fmt --all") &&
       root_agentic_taskfile.include?("bun run format")
  raise "Hive native sealed-guest formatting task is incomplete"
end

puts "Hive Kubernetes manifest contract: ok"
