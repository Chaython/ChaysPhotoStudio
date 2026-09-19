#!/usr/bin/env node
// Fast, dependency-free checks for distribution metadata. Run this in CI before
// starting expensive Electron/Tauri matrices so config mistakes fail early.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
const fail = msg => { console.error(`dist:validate: ERROR — ${msg}`); process.exitCode = 1 }
const ok = msg => console.log(`dist:validate: ${msg}`)

const pkg = readJson('package.json')
const tauri = readJson('webview/src-tauri/tauri.conf.json')
const cargoText = fs.readFileSync(path.join(ROOT, 'webview/src-tauri/Cargo.toml'), 'utf8')
const cargoPkg = cargoText.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)
const cargoVersion = cargoPkg?.[1]

if (!cargoVersion) fail('could not read [package] version from webview/src-tauri/Cargo.toml')
if (pkg.version !== tauri.version) fail(`package.json version ${pkg.version} != Tauri version ${tauri.version}`)
if (cargoVersion && pkg.version !== cargoVersion) fail(`package.json version ${pkg.version} != Cargo version ${cargoVersion}`)
if (pkg.version === tauri.version && pkg.version === cargoVersion) ok(`versions agree (${pkg.version})`)

// Tauri v2 BundleType::Category accepted values.
const tauriCategories = new Set([
  'Business','DeveloperTool','Education','Entertainment','Finance','Game','ActionGame',
  'AdventureGame','ArcadeGame','BoardGame','CardGame','CasinoGame','DiceGame',
  'EducationalGame','FamilyGame','KidsGame','MusicGame','PuzzleGame','RacingGame',
  'RolePlayingGame','SimulationGame','SportsGame','StrategyGame','TriviaGame','WordGame',
  'GraphicsAndDesign','HealthcareAndFitness','Lifestyle','Medical','Music','News',
  'Photography','Productivity','Reference','SocialNetworking','Sports','Travel','Utility',
  'Video','Weather'
])
const category = tauri.bundle?.category
if (!tauriCategories.has(category)) {
  fail(`invalid Tauri bundle.category ${JSON.stringify(category)}; use an accepted Tauri category such as "GraphicsAndDesign" or "Photography"`)
} else {
  ok(`Tauri category is valid (${category})`)
}

const allowedTargets = new Set(['app','appimage','deb','dmg','msi','nsis','rpm'])
for (const target of tauri.bundle?.targets ?? []) {
  if (!allowedTargets.has(String(target).toLowerCase())) fail(`unsupported Tauri bundle target: ${target}`)
}
if ((tauri.bundle?.targets ?? []).length) ok(`Tauri targets: ${tauri.bundle.targets.join(', ')}`)

if (!/^[A-Za-z0-9.-]+$/.test(tauri.identifier ?? '') || !(tauri.identifier ?? '').includes('.')) {
  fail(`suspicious Tauri identifier: ${JSON.stringify(tauri.identifier)}`)
} else {
  ok(`Tauri identifier: ${tauri.identifier}`)
}

for (const icon of tauri.bundle?.icon ?? []) {
  const full = path.join(ROOT, 'webview/src-tauri', icon)
  if (!fs.existsSync(full)) fail(`missing Tauri icon: webview/src-tauri/${icon}`)
}
if ((tauri.bundle?.icon ?? []).length) ok(`found ${tauri.bundle.icon.length} Tauri bundle icons`)

const requiredScripts = ['build','app:prepare','ext:build','webview:config','webview:build','dist:validate']
for (const name of requiredScripts) if (!pkg.scripts?.[name]) fail(`missing package script: ${name}`)

for (const rel of [
  'electron-builder.yml',
  'scripts/build-extension.mjs',
  'scripts/export-webapp.mjs',
  'scripts/webview-config.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
]) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail(`missing distribution file: ${rel}`)
}

if (!process.exitCode) ok('distribution metadata looks consistent')
