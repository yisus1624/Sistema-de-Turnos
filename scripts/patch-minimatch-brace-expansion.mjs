import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const legacyImport = "var expand = require('brace-expansion')"
const compatibleImport = [
  "var braceExpansion = require('brace-expansion')",
  "var expand = typeof braceExpansion === 'function' ? braceExpansion : braceExpansion.expand",
].join('\n')

let patched = 0

async function patchPackage(packageDir) {
  const manifestPath = join(packageDir, 'package.json')
  let manifest

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    return
  }

  if (manifest.name === 'minimatch' && String(manifest.version).startsWith('3.')) {
    const sourcePath = join(packageDir, 'minimatch.js')
    const source = await readFile(sourcePath, 'utf8')

    if (source.includes(compatibleImport)) return
    if (!source.includes(legacyImport)) {
      throw new Error(`No se pudo aplicar el adaptador seguro de brace-expansion en ${sourcePath}`)
    }

    await writeFile(sourcePath, source.replace(legacyImport, compatibleImport))
    patched += 1
  }

  await visitNodeModules(join(packageDir, 'node_modules'))
}

async function visitNodeModules(nodeModulesDir) {
  let entries
  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue
    const entryPath = join(nodeModulesDir, entry.name)

    if (entry.name.startsWith('@')) {
      const scopedPackages = await readdir(entryPath, { withFileTypes: true })
      for (const scopedPackage of scopedPackages) {
        if (scopedPackage.isDirectory()) {
          await patchPackage(join(entryPath, scopedPackage.name))
        }
      }
      continue
    }

    await patchPackage(entryPath)
  }
}

await visitNodeModules(join(process.cwd(), 'node_modules'))

if (patched > 0) {
  console.log(`Adaptador seguro aplicado a ${patched} copia(s) de minimatch 3.`)
}
