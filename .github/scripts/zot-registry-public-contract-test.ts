import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

async function read(relative: string): Promise<string> {
  return Bun.file(resolve(root, relative)).text();
}

function requireFragment(input: {
  source: string;
  fragment: string;
  message: string;
}): void {
  if (!input.source.includes(input.fragment)) {
    throw new Error(input.message);
  }
}

function forbidFragment(input: {
  source: string;
  fragment: string;
  message: string;
}): void {
  if (input.source.includes(input.fragment)) {
    throw new Error(input.message);
  }
}

const registryTask = await read("infra/tasks/registry.yml");
const zot = await read("infra/k0s/manifests/registry/zot.yaml");
const traefik = await read("infra/traefik-dynamic.yaml");
const compose = await read("infra/compose.yaml");
const hosts = await read("infra/k0s/config/registry-hosts.toml");
const hive = await read("infra/tasks/hive.yml");
const sccache = await read("infra/tasks/sccache.yml");
const sccacheBucketEnsure = sccache.slice(
  sccache.indexOf("  sccache:bucket:ensure:"),
  sccache.indexOf("  sccache:check:"),
);

for (const fragment of [
  "registry.dev.nokey.sh",
  "nook-zot-htpasswd",
  "nook-zot-registry-loopback.service",
  "disable --now",
  "Host must not listen on :5000",
  "gh secret set NOOK_REGISTRY_PASSWORD",
  "kubectl.*port-forward.*nook-zot",
]) {
  const assertion = {
    source: registryTask,
    fragment,
    message: `missing registry contract: ${fragment}`,
  };
  requireFragment(assertion);
}
for (const fragment of ["kubectl port-forward --", "port-forward --address"]) {
  const assertion = {
    source: registryTask,
    fragment,
    message: `prohibited registry path: ${fragment}`,
  };
  forbidFragment(assertion);
}
for (const fragment of [
  "clusterIP: 10.96.90.10",
  '"htpasswd"',
  "nook-zot-htpasswd",
  '"urls": ["https://index.docker.io"]',
  '"onDemand": true',
  '"preserveDigest": true',
  '"anonymousPolicy": ["read"]',
  '"nook-hive": {',
  '"users": ["__NOOK_REGISTRY_USERNAME__"]',
  "kind: Service",
  'requests:\n              cpu: "2"\n              memory: 4Gi',
  'limits:\n              cpu: "8"\n              memory: 12Gi',
]) {
  const assertion = {
    source: zot,
    fragment,
    message: `missing Zot contract: ${fragment}`,
  };
  requireFragment(assertion);
}
if (!/cidr:\s*10\.0\.0\.0\/8/.test(zot)) {
  throw new Error("Zot ingress must retain the private-network CIDR");
}
for (const fragment of [
  "Host(`registry.dev.nokey.sh`)",
  "Host(`sccache.dev.nokey.sh`)",
  "http://10.96.90.10:5000",
  "http://127.0.0.1:8333",
]) {
  const assertion = {
    source: traefik,
    fragment,
    message: `missing Traefik contract: ${fragment}`,
  };
  requireFragment(assertion);
}
for (const fragment of ["127.0.0.1:6379", "HostSNI("]) {
  const assertion = {
    source: traefik,
    fragment,
    message: `prohibited Traefik contract: ${fragment}`,
  };
  forbidFragment(assertion);
}
for (const fragment of [
  "network_mode: host",
  "seaweedfs",
  "chrislusf/seaweedfs",
  "-s3.port=8333",
  "--entryPoints.websecure.transport.respondingTimeouts.readTimeout=15m",
]) {
  const assertion = {
    source: compose,
    fragment,
    message: `missing Compose contract: ${fragment}`,
  };
  requireFragment(assertion);
}
for (const fragment of ["\n  redis:", "443:443", "5000:5000", "6380"]) {
  const assertion = {
    source: compose,
    fragment,
    message: `prohibited Compose contract: ${fragment}`,
  };
  forbidFragment(assertion);
}
const hostsAssertion = {
  source: hosts,
  fragment: 'server = "https://registry.dev.nokey.sh"',
  message: "containerd must use the authenticated public registry endpoint",
};
requireFragment(hostsAssertion);
for (const source of [hosts, hive]) {
  const assertion = {
    source,
    fragment: "127.0.0.1:5000",
    message: "loopback registry references are prohibited",
  };
  forbidFragment(assertion);
}
const hiveAssertion = {
  source: hive,
  fragment: "registry.dev.nokey.sh/nook-hive",
  message: "Hive must publish through the public Zot endpoint",
};
requireFragment(hiveAssertion);
requireFragment({
  source: sccacheBucketEnsure,
  fragment: "docker.io/amazon/aws-cli:2.27.50@sha256:",
  message: "clean-host sccache bootstrap must not depend on Zot",
});
forbidFragment({
  source: sccacheBucketEnsure,
  fragment: "registry.dev.nokey.sh/amazon/aws-cli",
  message: "sccache bootstrap cannot use Zot before k0s deploys it",
});

console.log("Public Zot registry contract: ok");
