#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

def named(items, name)
  items.find { |item| item["name"] == name } || raise("missing container: #{name}")
end

unless ARGV.length == 2
  abort "usage: arc-hive-values.rb BASE_VALUES OUTPUT_VALUES"
end

values = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true)
hive_values = Marshal.load(Marshal.dump(values))
hive_values["runnerScaleSetName"] = "nook-k0s-hive"
hive_values["minRunners"] = 0
hive_values["maxRunners"] = 10
pod_template = hive_values.fetch("template")
pod_template.fetch("metadata").fetch("labels")["nook.nokey.sh/role"] = "arc-hive-runner"
pod_template.fetch("metadata").fetch("labels")["nook.nokey.sh/arc-spread-group"] = "hive"
pod = pod_template.fetch("spec")
pod.fetch("topologySpreadConstraints").fetch(0).fetch("labelSelector").fetch("matchLabels")[
  "nook.nokey.sh/arc-spread-group"
] = "hive"
pod["runtimeClassName"] = "kata-qemu-runtime-rs"
pod.fetch("initContainers").reject! do |container|
  %w[prepare-container-runtime-state container-runtime].include?(container["name"])
end
pod.fetch("volumes").reject! do |volume|
  volume["name"] == "container-runtime-state"
end

buildkit = named(pod.fetch("initContainers"), "buildkit")
buildkit.fetch("resources").fetch("requests")["cpu"] = "1"
buildkit.fetch("resources").fetch("requests")["memory"] = "4Gi"
buildkit.fetch("resources").fetch("limits")["cpu"] = "4"
buildkit.fetch("resources").fetch("limits")["memory"] = "4Gi"

pod.fetch("initContainers").concat(
  [
    {
      "name" => "prepare-hive-neo4j",
      "image" => "neo4j:2026.06.0-community@sha256:ba2b859bdbe7017a9baa1a7b5681ac9732198753719b0a502e3645feddfdec72",
      "command" => ["/bin/sh", "-ceu", "chown 7474:7474 /data"],
      "securityContext" => {
        "allowPrivilegeEscalation" => false,
        "capabilities" => { "drop" => ["ALL"], "add" => ["CHOWN"] },
        "runAsUser" => 0,
        "seccompProfile" => { "type" => "RuntimeDefault" }
      },
      "volumeMounts" => [{ "name" => "neo4j-data", "mountPath" => "/data" }],
      "resources" => {
        "requests" => { "cpu" => "10m", "memory" => "32Mi" },
        "limits" => { "cpu" => "100m", "memory" => "128Mi" }
      }
    },
    {
      "name" => "prepare-hive-test-runtime",
      "image" => "rust:1.97-trixie@sha256:3382bd20aa942806c533e9a73cd000474fb3ef173f71e684cc9b942675781769",
      "command" => [
        "/bin/sh",
        "-ceu",
        "chown 1001:1001 /var/run/nook-hive-tests && chmod 0700 /var/run/nook-hive-tests"
      ],
      "securityContext" => {
        "allowPrivilegeEscalation" => false,
        "capabilities" => { "drop" => ["ALL"], "add" => ["CHOWN", "FOWNER"] },
        "runAsUser" => 0,
        "seccompProfile" => { "type" => "RuntimeDefault" }
      },
      "volumeMounts" => [
        { "name" => "hive-test-exchange", "mountPath" => "/var/run/nook-hive-tests" }
      ],
      "resources" => {
        "requests" => { "cpu" => "10m", "memory" => "32Mi" },
        "limits" => { "cpu" => "100m", "memory" => "128Mi" }
      }
    }
  ]
)

runner = named(pod.fetch("containers"), "runner")
runner.fetch("env").reject! do |item|
  %w[DOCKER_HOST NOOK_CONTAINER_RUNTIME].include?(item["name"])
end
runner.fetch("env") << { "name" => "NOOK_ARC_HIVE", "value" => "1" }
runner.fetch("resources").fetch("requests")["cpu"] = "500m"
runner.fetch("resources").fetch("requests")["memory"] = "1Gi"
runner.fetch("resources").fetch("limits")["cpu"] = "1"
runner.fetch("resources").fetch("limits")["memory"] = "1Gi"
runner.fetch("volumeMounts") << {
  "name" => "hive-test-exchange",
  "mountPath" => "/var/run/nook-hive-tests"
}

pod.fetch("initContainers").concat(
  [
    {
      "name" => "neo4j",
      "image" => "neo4j:2026.06.0-community@sha256:ba2b859bdbe7017a9baa1a7b5681ac9732198753719b0a502e3645feddfdec72",
      "restartPolicy" => "Always",
      "env" => [
        { "name" => "NEO4J_AUTH", "value" => "neo4j/hive-integration-password" },
        { "name" => "NEO4J_server_memory_heap_initial__size", "value" => "256m" },
        { "name" => "NEO4J_server_memory_heap_max__size", "value" => "1g" },
        { "name" => "NEO4J_server_memory_pagecache_size", "value" => "256m" }
      ],
      "ports" => [
        { "name" => "bolt", "containerPort" => 7687 },
        { "name" => "http", "containerPort" => 7474 }
      ],
      "startupProbe" => {
        "tcpSocket" => { "port" => "bolt" },
        "periodSeconds" => 2,
        "failureThreshold" => 90
      },
      "readinessProbe" => {
        "tcpSocket" => { "port" => "bolt" },
        "periodSeconds" => 2,
        "failureThreshold" => 10
      },
      "securityContext" => {
        "allowPrivilegeEscalation" => false,
        "capabilities" => { "drop" => ["ALL"] },
        "runAsNonRoot" => true,
        "runAsUser" => 7474,
        "runAsGroup" => 7474,
        "seccompProfile" => { "type" => "RuntimeDefault" }
      },
      "volumeMounts" => [{ "name" => "neo4j-data", "mountPath" => "/data" }],
      "resources" => {
        "requests" => { "cpu" => "250m", "memory" => "1Gi" },
        "limits" => { "cpu" => "1", "memory" => "2Gi" }
      }
    },
    {
      "name" => "hive-test-runtime",
      "image" => "rust:1.97-trixie@sha256:3382bd20aa942806c533e9a73cd000474fb3ef173f71e684cc9b942675781769",
      "restartPolicy" => "Always",
      "command" => ["/bin/bash", "/opt/nook/run-hive-test-runtime"],
      "env" => [
        { "name" => "RUST_BACKTRACE", "value" => "1" },
        { "name" => "HIVE_NEO4J_TEST_URI", "value" => "127.0.0.1:7687" },
        { "name" => "HIVE_NEO4J_TEST_USERNAME", "value" => "neo4j" },
        { "name" => "HIVE_NEO4J_TEST_PASSWORD", "value" => "hive-integration-password" }
      ],
      "securityContext" => {
        "allowPrivilegeEscalation" => false,
        "capabilities" => { "drop" => ["ALL"] },
        "runAsNonRoot" => true,
        "runAsUser" => 1001,
        "runAsGroup" => 1001,
        "seccompProfile" => { "type" => "RuntimeDefault" }
      },
      "volumeMounts" => [
        { "name" => "hive-test-exchange", "mountPath" => "/var/run/nook-hive-tests" },
        {
          "name" => "hive-test-runtime-script",
          "mountPath" => "/opt/nook/run-hive-test-runtime",
          "subPath" => "run-hive-test-runtime",
          "readOnly" => true
        }
      ],
      "resources" => {
        "requests" => { "cpu" => "500m", "memory" => "512Mi" },
        "limits" => { "cpu" => "4", "memory" => "4Gi" }
      }
    }
  ]
)

pod.fetch("volumes") << { "name" => "neo4j-data", "emptyDir" => { "sizeLimit" => "4Gi" } }
pod.fetch("volumes").concat(
  [
    { "name" => "hive-test-exchange", "emptyDir" => { "sizeLimit" => "1Gi" } },
    {
      "name" => "hive-test-runtime-script",
      "configMap" => {
        "name" => "nook-arc-hive-test-runtime",
        "defaultMode" => 0o555
      }
    }
  ]
)

File.write(ARGV.fetch(1), YAML.dump(hive_values))
