import { spawn } from 'node:child_process'

const script = `
import { exitCiAgent } from './dist/main/exit.js'
setInterval(() => {}, 1000)
console.log('smoke: about to exitCiAgent(0)')
exitCiAgent(0)
console.log('smoke: UNREACHABLE')
`

const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
})

let out = ''
child.stdout.on('data', (d) => {
  out += d
})
child.stderr.on('data', (d) => {
  out += d
})

const started = Date.now()
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    resolve({ hung: true, code: null, ms: Date.now() - started, out })
  }, 5000)
  child.on('exit', (code, signal) => {
    clearTimeout(timer)
    resolve({ hung: false, code, signal, ms: Date.now() - started, out })
  })
})

console.log(JSON.stringify(result, null, 2))
if (result.hung || result.code !== 0) {
  console.error('FAIL: exitCiAgent did not terminate cleanly')
  process.exit(1)
}
console.log('PASS: exitCiAgent terminated despite open handles')
