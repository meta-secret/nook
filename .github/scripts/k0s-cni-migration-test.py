#!/usr/bin/env python3
"""Behavior regression for k0s CNI migration after controller rewrite."""

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
                if args[:3] == ["k0s", "kubectl", "create"]:
                    print("apiVersion: v1")
                if args[:3] == ["k0s", "kubectl", "apply"]:
                    sys.stdin.buffer.read()
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
{migration_source()}
""",
            encoding="utf-8",
        )
        harness.chmod(0o755)
        env = {
            **os.environ,
            "PATH": f"{mock_bin}:{os.environ['PATH']}",
            "MOCK_LOG": str(log),
        }
        subprocess.run([str(harness)], env=env, check=True)
        commands = log.read_text(encoding="utf-8")
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
