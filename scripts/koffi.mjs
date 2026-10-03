import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// npm installs only the host's koffi binary; a universal mac build needs both.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'node_modules/koffi/package.json'), 'utf8'))

for (const arch of ['arm64', 'x64']) {
  const name = `@koromix/koffi-darwin-${arch}`
  const dest = path.join(root, 'node_modules', name)
  if (existsSync(path.join(dest, `darwin_${arch}`, 'koffi.node'))) continue
  const tmp = mkdtempSync(path.join(tmpdir(), 'kumo-koffi-'))
  try {
    const tgz = execFileSync('npm', ['pack', `${name}@${version}`, '--silent', '--pack-destination', tmp], { encoding: 'utf8' }).trim().split('\n').pop()
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', dest, '--strip-components=1'])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`staged ${name}@${version}`)
}
