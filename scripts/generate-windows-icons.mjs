import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const icons = path.join(root, 'src-tauri/icons')
const check = process.argv.includes('--check')
const require = createRequire(import.meta.url)
const cli = path.join(path.dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js')
const temporary = mkdtempSync(path.join(tmpdir(), 'kivio-windows-icons-'))

// public/icon.png is the existing full-canvas rounded artwork. The padded
// source-rounded.png, shared PNGs, ICNS and monochrome tray icon belong to macOS.
const outputs = [
  ['icon.ico', 'icon.ico'],
  ['64x64.png', 'windows-tray.png'],
  ...[30, 44, 71, 89, 107, 142, 150, 284, 310].map(size => {
    const name = `Square${size}x${size}Logo.png`
    return [name, name]
  }),
  ['StoreLogo.png', 'StoreLogo.png'],
]

try {
  execFileSync(process.execPath, [cli, 'icon', path.join(root, 'public/icon.png'), '--output', temporary], {
    cwd: root,
    stdio: 'pipe',
  })

  // Windows shell baseline: https://learn.microsoft.com/windows/apps/design/style/iconography/app-icon-construction
  const ico = readFileSync(path.join(temporary, 'icon.ico'))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  const sizes = new Set()
  for (let index = 0; index < ico.readUInt16LE(4); index++) {
    const offset = 6 + index * 16
    const width = ico[offset] || 256
    const height = ico[offset + 1] || 256
    assert.equal(width, height, 'ICO layers must be square')
    assert.equal(ico.readUInt16LE(offset + 6), 32, 'ICO layers must support alpha')
    sizes.add(width)
  }
  for (const size of [16, 24, 32, 48, 256]) {
    assert(sizes.has(size), `Missing Windows ${size}px icon`)
  }

  const stale = []
  for (const [generated, destination] of outputs) {
    const source = path.join(temporary, generated)
    const target = path.join(icons, destination)
    if (check) {
      if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) {
        stale.push(destination)
      }
    } else {
      copyFileSync(source, target)
    }
  }
  if (stale.length) {
    throw new Error(`Windows icons are out of date: ${stale.join(', ')}. Run npm run icons:generate.`)
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${outputs.length} Windows icon assets; macOS assets unchanged.`)
} finally {
  // This directory is created by mkdtemp above and contains only CLI output.
  rmSync(temporary, { recursive: true, force: true })
}
