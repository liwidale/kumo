import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(dir, 'build')
fs.mkdirSync(outDir, { recursive: true })
await build({
  entryPoints: [path.join(dir, 'promo.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome130',
  outfile: path.join(outDir, 'promo.js'),
  loader: { '.svg': 'text' },
  logLevel: 'error',
})
fs.writeFileSync(
  path.join(outDir, 'promo.html'),
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}canvas{display:block}</style></head><body><canvas id="c"></canvas><script src="promo.js"></script></body></html>',
)
console.log('promo built')
