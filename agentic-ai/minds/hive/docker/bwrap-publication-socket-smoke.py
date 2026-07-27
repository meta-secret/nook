#!/usr/bin/env python3
import json
import os
import socket
import subprocess
import tempfile
import threading


with tempfile.TemporaryDirectory(
    prefix="hive-publication-smoke-", dir="/workspace"
) as directory:
    os.chmod(directory, 0o700)
    socket_path = os.path.join(directory, "broker.sock")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.settimeout(5)
    listener.bind(socket_path)
    os.chmod(socket_path, 0o600)
    listener.listen(1)
    broker_errors: list[Exception] = []

    def serve_ping() -> None:
        try:
            connection, _ = listener.accept()
            with connection:
                request = json.loads(connection.makefile().readline())
                if request != {"operation": "ping"}:
                    raise RuntimeError(f"unexpected publication request: {request!r}")
                response = {
                    "result": "value",
                    "value": {"status": "ok"},
                }
                connection.sendall((json.dumps(response) + "\n").encode())
        except Exception as error:
            broker_errors.append(error)

    broker = threading.Thread(target=serve_ping, daemon=True)
    broker.start()

    environment = os.environ.copy()
    environment["HIVE_PUBLICATION_SOCKET"] = socket_path
    client_error: Exception | None = None
    completed: subprocess.CompletedProcess[str] | None = None
    try:
        completed = subprocess.run(
            [
                "bwrap",
                "--unshare-user",
                "--unshare-pid",
                "--unshare-net",
                "--ro-bind",
                "/",
                "/",
                "--dev",
                "/dev",
                "--tmpfs",
                "/tmp",
                "--bind",
                "/workspace",
                "/workspace",
                "--chdir",
                "/workspace",
                "hive",
                "github",
                "ping",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
            env=environment,
        )
    except Exception as error:
        client_error = error
    finally:
        listener.close()
        broker.join(timeout=6)

    if broker.is_alive():
        raise RuntimeError("publication smoke broker did not terminate") from client_error
    if broker_errors:
        raise RuntimeError("publication smoke broker failed") from broker_errors[0]
    if client_error is not None:
        raise client_error
    if completed is None:
        raise RuntimeError("publication smoke client did not return a result")
    if json.loads(completed.stdout) != {"status": "ok"}:
        raise RuntimeError(f"unexpected publication response: {completed.stdout!r}")

print("result=ok")
