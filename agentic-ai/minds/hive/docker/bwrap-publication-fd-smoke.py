#!/usr/bin/env python3
import os
import socket
import subprocess


parent, child = socket.socketpair()
fd = child.fileno()
os.set_inheritable(fd, True)
environment = os.environ.copy()
environment["HIVE_PUBLICATION_FD"] = str(fd)
subprocess.run(
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
        "python3",
        "-c",
        "import os; fd=int(os.environ['HIVE_PUBLICATION_FD']); os.fstat(fd)",
    ],
    check=True,
    env=environment,
    pass_fds=(fd,),
)
parent.close()
child.close()
print("result=ok")
