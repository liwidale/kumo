import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.platform === 'win32' ? 'kumo-hook.exe' : 'kumo-hook'
const args = ['build', '--release', '--manifest-path', path.join(root, 'relay/Cargo.toml')]
const mac = process.platform === 'darwin' && process.argv.includes('--universal')

if (mac) {
  for (const t of ['aarch64-apple-darwin', 'x86_64-apple-darwin']) execFileSync('cargo', [...args, '--target', t], { stdio: 'inherit' })
  mkdirSync(path.join(root, 'resources/relay'), { recursive: true })
  execFileSync('lipo', [
    '-create',
    path.join(root, 'relay/target/aarch64-apple-darwin/release', exe),
    path.join(root, 'relay/target/x86_64-apple-darwin/release', exe),
    '-output',
    path.join(root, 'resources/relay', exe),
  ])
} else {
  execFileSync('cargo', args, { stdio: 'inherit' })
  mkdirSync(path.join(root, 'resources/relay'), { recursive: true })
  copyFileSync(path.join(root, 'relay/target/release', exe), path.join(root, 'resources/relay', exe))
}
console.log('relay staged')
