// TypeScript loader for running validator scripts headlessly on Node 26.
// Uses node:module.register() to register a TS source loader that resolves
// extensionless imports to .ts files.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

await register('./scripts/ts-loader.mjs', pathToFileURL('./'))
