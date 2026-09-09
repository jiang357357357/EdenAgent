import path from 'node:path'

function moduleName(file) {
  return file.match(/^Server\/src\/modules\/([^/]+)\//)?.[1]
}

export function dependencyViolations(file, specifier, target) {
  const errors = []
  if (specifier.startsWith('@earendil-works/pi-') && !file.startsWith('packages/runtime-pi/')) {
    errors.push('pi may only be imported by packages/runtime-pi')
  }
  if (!target) return errors
  if (file.startsWith('packages/') && target.startsWith('Server/')) errors.push('packages cannot depend on Server')
  if (moduleName(file) && /^Server\/src\/(transport|bootstrap)\//.test(target)) errors.push('business modules cannot depend on transport/bootstrap')
  if (moduleName(file) && moduleName(target) && moduleName(file) !== moduleName(target)) {
    if (target !== `Server/src/modules/${moduleName(target)}/index.ts`) errors.push('cross-module access must use the public index.ts')
  }
  if (/^(Archive|文档\/参考)\//.test(target)) errors.push('runtime cannot depend on archived or reference code')
  const fromPackage = file.match(/^packages\/([^/]+)\//)?.[1]
  const toPackage = target.match(/^packages\/([^/]+)\//)?.[1]
  if (toPackage && fromPackage !== toPackage && specifier.startsWith('.')) errors.push('cross-package imports must use the package export')
  return errors
}

export function findCycles(graph) {
  const complete = new Set()
  const active = new Set()
  const stack = []
  const cycles = []
  function visit(file) {
    if (active.has(file)) {
      cycles.push([...stack.slice(stack.indexOf(file)), file].map(value => path.normalize(value)).join(' -> '))
      return
    }
    if (complete.has(file)) return
    active.add(file)
    stack.push(file)
    for (const target of graph.get(file) ?? []) visit(target)
    stack.pop()
    active.delete(file)
    complete.add(file)
  }
  for (const file of graph.keys()) visit(file)
  return cycles
}
