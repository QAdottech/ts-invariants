#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { check } from './check.ts'
import { ConfigError, INVARIANTS, loadConfig } from './config.ts'
import { formatDiagnostic, type Diagnostic } from './diagnostic.ts'
import { isInside } from './model.ts'
import { loadNativeMembers } from './nativeMembers.ts'

const usage = `usage: ts-invariants [path] [options]

Checks a TypeScript codebase for deep modules and narrow interfaces:
${INVARIANTS.join(', ')}.

  [path]                    report only what concerns this path
  -p, --project <tsconfig>  index these projects (repeatable); default: every
                            workspace package's tsconfig.json, and the root's
  -c, --config <file>       config file (default: ts-invariants.config.json)
  --allow <file>            suppress the entries listed in <file>; new ones still fail
  --update-allow <file>     write every current finding to <file> and exit 0
  --format <format>         text (default), json, or github (workflow annotations)
  --summary                 print counts per invariant and directory instead
  -q, --quiet               no progress on stderr
  -h, --help                show this help
  -v, --version             show the version

Exit codes: 0 no findings, 1 findings, 2 bad usage or config.`

const idOf = (diagnostic: Diagnostic) => `${diagnostic.invariant} ${diagnostic.key}`

const readAllowList = (file: string) =>
  new Set(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  )

const summarize = (diagnostics: Diagnostic[]) => {
  const count = (keyOf: (diagnostic: Diagnostic) => string) => {
    const counts = new Map<string, number>()
    for (const diagnostic of diagnostics)
      counts.set(keyOf(diagnostic), (counts.get(keyOf(diagnostic)) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])
  }
  const rows = (entries: [string, number][]) =>
    entries.map(([name, n]) => `  ${String(n).padStart(5)}  ${name}`)
  return [
    'by invariant:',
    ...rows(count(({ invariant }) => invariant)),
    'by directory:',
    ...rows(count(({ concerns }) => path.dirname(concerns[0] ?? '.')).slice(0, 20)),
  ].join('\n')
}

/** `::error file=…,line=…::…`, which GitHub Actions shows on the pull request. */
const githubAnnotation = (diagnostic: Diagnostic) => {
  const [, file, line, column] = /^(.*?):(\d+):(\d+)$/.exec(diagnostic.site) ?? [
    undefined,
    diagnostic.site,
  ]
  const properties = [
    `file=${file}`,
    ...(line ? [`line=${line}`] : []),
    ...(column ? [`col=${column}`] : []),
    `title=ts-invariants(${diagnostic.invariant})`,
  ].join(',')
  const body = [diagnostic.message, ...diagnostic.notes, ...diagnostic.picture].join('\n')
  const escaped = body.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  return `::error ${properties}::${escaped}`
}

const version = () => {
  const packageJson: unknown = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  return typeof packageJson === 'object' && packageJson !== null && 'version' in packageJson
    ? String(packageJson.version)
    : 'unknown'
}

const main = async (): Promise<number> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string', short: 'p', multiple: true },
      config: { type: 'string', short: 'c' },
      allow: { type: 'string' },
      'update-allow': { type: 'string' },
      format: { type: 'string', default: 'text' },
      summary: { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  if (values.help) {
    console.log(usage)
    return 0
  }
  if (values.version) {
    console.log(version())
    return 0
  }
  const format = values.format
  if (format !== 'text' && format !== 'json' && format !== 'github') {
    console.error(`ts-invariants: unknown --format ${format}\n\n${usage}`)
    return 2
  }

  const root = process.cwd()
  const config = loadConfig({ root, file: values.config })
  const scope = positionals[0] ? path.relative(root, path.resolve(positionals[0])) : undefined
  const log = (message: string) => {
    if (!values.quiet) console.error(`  ${message}`)
  }

  const nativeMembers = await loadNativeMembers()
  if (!nativeMembers)
    log('typescript 7 not found: resolving members with TS 6, which is slower on large projects')

  const projects = values.project?.map((project) => path.resolve(project))

  const all = check({
    root,
    config,
    projects,
    nativeMembers,
    log: (message) => log(`indexed ${message}`),
  }).filter(
    (diagnostic) =>
      !scope || diagnostic.concerns.some((concern) => isInside({ outer: scope, inner: concern })),
  )

  if (values['update-allow']) {
    fs.writeFileSync(values['update-allow'], `${all.map(idOf).join('\n')}\n`)
    console.error(`ts-invariants: wrote ${all.length} entries to ${values['update-allow']}`)
    return 0
  }

  const allowed = values.allow ? readAllowList(values.allow) : new Set<string>()
  const diagnostics = all.filter((diagnostic) => !allowed.has(idOf(diagnostic)))

  if (values.summary) console.log(summarize(diagnostics))
  else if (format === 'json') console.log(JSON.stringify(diagnostics, null, 2))
  else if (format === 'github')
    for (const diagnostic of diagnostics) console.log(githubAnnotation(diagnostic))
  else for (const diagnostic of diagnostics) console.log(`${formatDiagnostic(diagnostic)}\n`)

  const current = new Set(all.map(idOf))
  const stale = [...allowed].filter((id) => !current.has(id))
  if (stale.length > 0)
    console.error(
      `ts-invariants: ${stale.length} allow entries no longer match; rerun --update-allow`,
    )
  const allowedNote = allowed.size > 0 ? ` (${all.length - diagnostics.length} allowed)` : ''
  console.error(
    `ts-invariants: ${diagnostics.length} finding${diagnostics.length === 1 ? '' : 's'}${allowedNote}`,
  )
  return diagnostics.length > 0 ? 1 : 0
}

try {
  process.exitCode = await main()
} catch (error) {
  const isUsageError =
    error instanceof ConfigError ||
    (error instanceof TypeError &&
      'code' in error &&
      String(error.code).startsWith('ERR_PARSE_ARGS'))
  if (!isUsageError) throw error
  console.error(`ts-invariants: ${error.message}`)
  process.exitCode = 2
}
