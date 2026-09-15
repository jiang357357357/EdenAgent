import { readdir } from 'node:fs/promises'
import path from 'node:path'

const TEST_FILE_PATTERN = /\.test\.(?:[cm]?[jt]s)$/u
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

async function walk(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(target, files)
      continue
    }
    if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) files.push(target)
  }
}

export async function discoverTestFiles(roots, cwd = process.cwd()) {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error('At least one test root is required')
  }

  const files = []
  for (const root of roots) {
    const absoluteRoot = path.resolve(cwd, root)
    await walk(absoluteRoot, files)
  }

  return [...new Set(files.map(file => path.resolve(file)))].sort((left, right) => left.localeCompare(right))
}

