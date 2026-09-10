const process = require('node:process');

const [mode = '', value = '0'] = process.argv.slice(2);

if (mode === 'output') process.stdout.write('x'.repeat(Number(value)));
if (mode === 'signal') process.kill(process.pid, 'SIGTERM');
