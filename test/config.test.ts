import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ConfigError, defaultConfig, findProjects, loadConfig } from '../src/config.ts'
import { globToRegExp } from '../src/glob.ts'

const directories: string[] = []
const workspace = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-invariants-'))
  directories.push(root)
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  return root
}
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('globToRegExp', () => {
  it.each([
    ['**/*.test.*', 'src/a/b.test.ts', true],
    ['**/*.test.*', 'b.test.ts', true],
    ['**/test/**', 'packages/x/test/fixtures/a.ts', true],
    ['**/test/**', 'packages/x/testing/a.ts', false],
    ['src/*.ts', 'src/a/b.ts', false],
  ])('%s matches %s: %s', (glob, file, matches) => {
    expect(globToRegExp(glob).test(file)).toBe(matches)
  })
})

describe('findProjects', () => {
  it('finds every tsconfig.json, shallowest first, outside skipped directories', () => {
    const root = workspace({
      'tsconfig.json': '{}',
      'packages/a/tsconfig.json': '{}',
      'packages/a/src/node/tsconfig.json': '{}',
      'packages/a/test/fixtures/x/tsconfig.json': '{}',
      'packages/a/dist/tsconfig.json': '{}',
      'node_modules/dep/tsconfig.json': '{}',
      '.cache/tsconfig.json': '{}',
    })
    expect(
      findProjects({ root, config: defaultConfig }).map((file) => path.relative(root, file)),
    ).toEqual(['tsconfig.json', 'packages/a/tsconfig.json', 'packages/a/src/node/tsconfig.json'])
  })

  it('takes the projects the config names', () => {
    const root = workspace({ 'apps/web/tsconfig.json': '{}', 'apps/api/tsconfig.json': '{}' })
    const config = { ...defaultConfig, projects: ['apps/*/tsconfig.json'] }
    expect(
      findProjects({ root, config })
        .map((file) => path.relative(root, file))
        .sort(),
    ).toEqual(['apps/api/tsconfig.json', 'apps/web/tsconfig.json'])
  })
})

describe('loadConfig', () => {
  it('extends the default lists and overrides limits', () => {
    const root = workspace({
      'ts-invariants.config.json': JSON.stringify({
        exclude: ['**/legacy/**'],
        limits: { mostLines: 800 },
        invariants: { 'wide-directory': 'off' },
      }),
    })
    const config = loadConfig({ root })
    expect(config.exclude).toEqual([...defaultConfig.exclude, '**/legacy/**'])
    expect(config.limits).toEqual({ ...defaultConfig.limits, mostLines: 800 })
    expect(config.invariants).toEqual({ 'wide-directory': 'off' })
  })

  it('rejects unknown invariants', () => {
    const root = workspace({
      'ts-invariants.config.json': JSON.stringify({ invariants: { nope: 'off' } }),
    })
    expect(() => loadConfig({ root })).toThrow(ConfigError)
  })
})
