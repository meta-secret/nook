import process from 'node:process';

const socketPath = process.argv[2];
const nonce = process.argv[3];

if (!socketPath || !nonce) {
  process.stderr.write('Module expert authentication broker is unavailable.\n');
  process.exit(1);
}

let credential = '';

type AuthenticationBrokerClientData = [Bun.Socket, Buffer];

const socketOptions: Bun.UnixSocketOptions = {
  unix: socketPath,
  socket: {
    binaryType: 'buffer',
    data: (...parameters: AuthenticationBrokerClientData) => {
      const [socket, data] = parameters;
      credential += data.toString('utf8');
      if (credential.length > 16_384) {
        credential = '';
        socket.close();
        process.exitCode = 1;
      }
    },
    end: () => {
      const normalizedCredential = credential.trim();
      credential = '';
      if (!normalizedCredential) {
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${normalizedCredential}\n`);
    },
    error: () => {
      credential = '';
      process.exitCode = 1;
    },
    open: (socket) => {
      socket.write(`${nonce}\n`);
    },
  },
};

try {
  await Bun.connect(socketOptions);
} catch {
  credential = '';
  process.exitCode = 1;
}
