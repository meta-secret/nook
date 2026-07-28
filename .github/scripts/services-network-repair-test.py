#!/usr/bin/env python3
"""Behavior regression for Taskfile-owned Docker network repair."""

import os
import pathlib
import subprocess
import tempfile
import textwrap


ROOT = pathlib.Path(__file__).resolve().parents[2]
TASKFILE = ROOT / "infra/tasks/host-services.yml"
START = "  services:repair-network:\n"
SCRIPT_START = "        set -euo pipefail\n"
END = "        REMOTE\n"


def repair_source(remote_dir):
    task = TASKFILE.read_text(encoding="utf-8").split(START, 1)[1]
    embedded = task.split(SCRIPT_START, 1)[1].split(END, 1)[0]
    source = "#!/usr/bin/env bash\nset -euo pipefail\n" + textwrap.dedent(embedded)
    return source.replace(
        'remote_dir="{{.INFRA_REMOTE_DIR}}"',
        f"remote_dir={remote_dir}",
    )


def write_executable(path, source):
    path.write_text(source, encoding="utf-8")
    path.chmod(0o755)


def run_case(existing, version="26.1.4"):
    with tempfile.TemporaryDirectory() as directory:
        work = pathlib.Path(directory)
        (work / "compose.yaml").write_text("services: {}\n", encoding="utf-8")
        mock_bin = work / "bin"
        mock_bin.mkdir()
        log = work / "commands.log"
        state = work / "state"
        state.mkdir()
        for item in existing:
            (state / item).touch()

        write_executable(
            mock_bin / "docker",
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import os
                import pathlib
                import sys

                args = sys.argv[1:]
                with pathlib.Path(os.environ["MOCK_LOG"]).open("a") as log:
                    log.write("docker " + " ".join(args) + "\\n")
                if args[:2] == ["version", "--format"]:
                    print(os.environ["MOCK_DOCKER_VERSION"])
                """
            ),
        )
        write_executable(
            mock_bin / "sudo",
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import os
                import pathlib
                import sys

                args = sys.argv[1:]
                if args and args[0] == "-n":
                    args = args[1:]
                log_path = pathlib.Path(os.environ["MOCK_LOG"])
                with log_path.open("a") as log:
                    log.write("sudo " + " ".join(args) + "\\n")
                if not args or args[0] != "iptables":
                    raise SystemExit(f"unexpected sudo command: {args}")
                table = args[args.index("--table") + 1]
                state = pathlib.Path(os.environ["MOCK_STATE"])
                if "--list" in args:
                    chain = args[args.index("--list") + 1]
                    raise SystemExit(0 if (state / f"{table}-{chain}").exists() else 1)
                if "--new-chain" in args:
                    chain = args[args.index("--new-chain") + 1]
                    (state / f"{table}-{chain}").touch()
                    raise SystemExit(0)
                chain = args[args.index("--check") + 1] if "--check" in args else args[args.index("--append") + 1]
                marker = state / f"{table}-{chain}-return"
                if "--check" in args:
                    raise SystemExit(0 if marker.exists() else 1)
                marker.touch()
                """
            ),
        )
        write_executable(mock_bin / "curl", "#!/bin/sh\nexit 0\n")
        harness = work / "harness.sh"
        write_executable(harness, repair_source(work))
        env = {
            **os.environ,
            "PATH": f"{mock_bin}:{os.environ['PATH']}",
            "MOCK_LOG": str(log),
            "MOCK_STATE": str(state),
            "MOCK_DOCKER_VERSION": version,
        }
        result = subprocess.run(
            [str(harness)],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        commands = log.read_text(encoding="utf-8")
        return result.returncode, commands


def main():
    code, missing = run_case(set())
    assert code == 0
    for command in (
        "--table nat --new-chain DOCKER",
        "--table filter --new-chain DOCKER",
        "--table filter --new-chain DOCKER-ISOLATION-STAGE-1",
        "--table filter --new-chain DOCKER-ISOLATION-STAGE-2",
    ):
        assert command in missing
    assert missing.rindex("sudo iptables") < missing.index(
        " down --remove-orphans"
    )

    code, partial = run_case(
        {
            "nat-DOCKER",
            "filter-DOCKER",
            "filter-DOCKER-ISOLATION-STAGE-1",
        }
    )
    assert code == 0
    partial_commands = partial.splitlines()
    assert "sudo iptables --table nat --new-chain DOCKER" not in partial_commands
    assert (
        "sudo iptables --table filter --new-chain DOCKER"
        not in partial_commands
    )
    assert (
        "sudo iptables --table filter --new-chain DOCKER-ISOLATION-STAGE-1"
        not in partial_commands
    )
    assert "--table filter --new-chain DOCKER-ISOLATION-STAGE-2" in partial
    assert "--append DOCKER-ISOLATION-STAGE-1 --jump RETURN" in partial
    assert "--append DOCKER-ISOLATION-STAGE-2 --jump RETURN" in partial

    code, unsupported = run_case(set(), version="27.0.1")
    assert code == 1
    assert "iptables" not in unsupported
    assert " down --remove-orphans" not in unsupported
    assert " up --detach --wait" not in unsupported
    print("Docker network repair missing, partial, and version guards: ok")


if __name__ == "__main__":
    main()
