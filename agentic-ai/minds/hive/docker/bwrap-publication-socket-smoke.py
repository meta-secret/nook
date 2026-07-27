#!/usr/bin/env python3
import json
import os
import socket
import subprocess
import tempfile
import threading


with tempfile.TemporaryDirectory(prefix="hive-publication-smoke-") as directory:
    socket_path = os.path.join(directory, "broker.sock")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(socket_path)
    os.chmod(socket_path, 0o600)
    listener.listen(1)

    def serve_ping() -> None:
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

    broker = threading.Thread(target=serve_ping)
    broker.start()

    environment = os.environ.copy()
    environment["HIVE_PUBLICATION_SOCKET"] = socket_path
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
            "--chdir",
            "/workspace",
            "hive",
            "github",
            "ping",
        ],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )
    broker.join()
    listener.close()

    if json.loads(completed.stdout) != {"status": "ok"}:
        raise RuntimeError(f"unexpected publication response: {completed.stdout!r}")

print("result=ok")
