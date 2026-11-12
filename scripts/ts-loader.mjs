// TS source loader for Node 26: resolves extensionless imports to .ts files.
// Used via: node --import ./scripts/runner.mjs --experimental-strip-types script.ts
export async function resolve(specifier, context, nextResolve) {
  if (typeof specifier === 'string' && (specifier.startsWith('./') || specifier.startsWith('../')) {
    const extensions = ['.ts', '.tsx', '.mjs', '.js', '.json']
    for (const ext of extensions) {
      try {
        return await nextResolve(specifier + ext, context)
      } catch {
        // try next extension
      }
    }
  }
  return nextResolve(specifier, context)
}
