#!/usr/bin/env python3
"""Behavior regression for k0s CNI migration after controller rewrite."""

import json
import os
import pathlib
import subprocess
import tempfile
import textwrap


ROOT = pathlib.Path(__file__).resolve().parents[2]
TASKFILE = ROOT / "infra/tasks/k0s.yml"
START = '        cni_migrated="$cni_was_unmasqueraded"\n'
END = (
    "        if sudo -n test -e "
    "/var/lib/hive/k0s-recovery/neo4j-secrets.yaml.enc; then\n"
)


def migration_source():
    taskfile = TASKFILE.read_text(encoding="utf-8")
    embedded = taskfile.split(START, 1)[1].split(END, 1)[0]
    return 'cni_migrated="$cni_was_unmasqueraded"\n' + textwrap.dedent(embedded)


def main():
    with tempfile.TemporaryDirectory() as directory:
        work = pathlib.Path(directory)
        mock_bin = work / "bin"
        mock_bin.mkdir()
        log = work / "commands.log"
        namespace_state = work / "namespace-state.json"
        namespace_state.write_text(
            json.dumps({"hive-data": "data", "hive-system": "workers"}),
            encoding="utf-8",
        )
        namespace_manifest = work / "infra/k0s/manifests/namespaces.yaml"
        namespace_manifest.parent.mkdir(parents=True)
        namespace_manifest.write_text(
            (ROOT / "infra/k0s/manifests/namespaces.yaml").read_text(
                encoding="utf-8"
            ),
            encoding="utf-8",
        )
        cni = work / "10-kuberouter.conflist"
        cni.write_text(
            '{"plugins":[{"type":"bridge","ipMasq":true}]}\n',
            encoding="utf-8",
        )
        sudo = mock_bin / "sudo"
        sudo.write_text(
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import json
                import os
                import pathlib
                import subprocess
                import sys

                args = sys.argv[1:]
                if args and args[0] == "-n":
                    args = args[1:]
                with pathlib.Path(os.environ["MOCK_LOG"]).open("a") as log:
                    log.write(" ".join(args) + "\\n")
                if args[:2] == ["test", "-s"]:
                    raise SystemExit(0 if pathlib.Path(args[2]).stat().st_size else 1)
                if args and args[0] == "jq":
                    raise SystemExit(subprocess.run(args).returncode)
                if args[:4] == ["k0s", "kubectl", "create", "namespace"]:
                    print("apiVersion: v1")
                    print("kind: Namespace")
                    print("metadata:")
                    print(f"  name: {args[4]}")
                if args[:3] == ["k0s", "kubectl", "apply"]:
                    if args[-2:] == ["-f", "-"]:
                        manifest = sys.stdin.read()
                    else:
                        manifest = pathlib.Path(args[-1]).read_text()
                    state_path = pathlib.Path(os.environ["MOCK_NAMESPACE_STATE"])
                    state = json.loads(state_path.read_text())
                    for document in manifest.split("---"):
                        if "kind: Namespace" not in document:
                            continue
                        namespace = next(
                            (
                                line.split(":", 1)[1].strip()
                                for line in document.splitlines()
                                if line.strip().startswith("name:")
                            ),
                            "",
                        )
                        if namespace not in state:
                            continue
                        role = next(
                            (
                                line.split(":", 1)[1].strip()
                                for line in document.splitlines()
                                if line.strip().startswith("hive.nook.sh/role:")
                            ),
                            "",
                        )
                        state[namespace] = role
                    state_path.write_text(json.dumps(state))
                if args[:4] == ["k0s", "kubectl", "get", "deployment/hive"]:
                    raise SystemExit(0)
                if args[:4] == [
                    "k0s",
                    "kubectl",
                    "get",
                    "deployment/hive-workbench-dispatcher",
                ]:
                    raise SystemExit(0)
                if args[:4] == [
                    "k0s",
                    "kubectl",
                    "get",
                    "deployment/hive-reaper-controller",
                ]:
                    raise SystemExit(0)
                """
            ),
            encoding="utf-8",
        )
        sudo.chmod(0o755)
        harness = work / "harness.sh"
        harness.write_text(
            f"""#!/usr/bin/env bash
set -euo pipefail
cni_config={cni}
cni_config_next=""
cni_was_unmasqueraded=true
remote_dir={work}
{migration_source()}
""",
            encoding="utf-8",
        )
        harness.chmod(0o755)
        env = {
            **os.environ,
            "PATH": f"{mock_bin}:{os.environ['PATH']}",
            "MOCK_LOG": str(log),
            "MOCK_NAMESPACE_STATE": str(namespace_state),
        }
        subprocess.run([str(harness)], env=env, check=True)
        assert json.loads(namespace_state.read_text(encoding="utf-8")) == {
            "hive-data": "data",
            "hive-system": "workers",
        }
        commands = log.read_text(encoding="utf-8")
        namespace_apply = (
            "k0s kubectl apply "
            f"-f {namespace_manifest}"
        )
        assert namespace_apply in commands, namespace_apply
        for deployment in (
            "hive",
            "hive-workbench-dispatcher",
            "hive-reaper-controller",
        ):
            restart = (
                "k0s kubectl rollout restart "
                f"deployment/{deployment} --namespace hive-system"
            )
            status = (
                "k0s kubectl rollout status "
                f"deployment/{deployment} --namespace hive-system --timeout=10m"
            )
            assert restart in commands, restart
            assert status in commands, status
        assert "k0s kubectl rollout restart deployment/coredns" in commands
        print("k0s CNI rewrite migration rollouts: ok")


if __name__ == "__main__":
    main()
