# ts-invariants

[![ci](https://github.com/QAdottech/ts-invariants/actions/workflows/ci.yml/badge.svg)](https://github.com/QAdottech/ts-invariants/actions/workflows/ci.yml)

Architectural invariants for TypeScript: **deep** modules, **narrow** interfaces.

Linters check lines. Type checkers check values. Nothing checks the _shape_ of a
codebase: which modules know which, which classes hand their insides around,
which folders are a grab bag of exports. Those are the things that make a
codebase hard to change, for people and for coding agents alike.
`ts-invariants` checks them.

```bash
npx ts-invariants
```

```
error[field-leak]: `RunQueue.items` is known outside `RunQueue`: 2 places in 1 module
  --> src/sched/policy.ts:4:28
  = note: src/sched/policy.ts:4:28: `admit`
  = note: src/sched/policy.ts:7:48: `next`
    RunQueue  (src/queue/RunQueue.ts:3:1)
      items ◀━┳━ 2  src/sched/policy.ts
      also known outside: head
      kept: limit

error[module-cycle]: 2 modules in `src/net` use each other in a circle
  --> src/net/kinds.ts:5:61
  = note: src/net/kinds.ts:5:61: `kinds.ts` uses `socket.ts` by 1 item: BACKLOG_MOST
  = note: src/net/socket.ts:5:30: `socket.ts` uses `kinds.ts` by 2 items: Kind, backlogFor
    kinds.ts ━▶ socket.ts ━▶ kinds.ts

ts-invariants: 5 findings
```

### It's not my fault

Sure. Record what's there today, and only fail on what's new:

```bash
npx ts-invariants --update-allow .ts-invariants-allow
npx ts-invariants --allow .ts-invariants-allow
```

### Add to your `AGENTS.md`

```markdown
- Run `npx ts-invariants` to check the codebase's structure.
- Fix what it flags from first principles; don't move code around just to hide a finding.
  - `module-cycle` and `tangle`: what layer of abstraction is each module at? Which one should depend on which?
  - `field-leak` and `shallow-module`: why do these fields and functions exist, and how are they used? Hide them behind a narrow interface, and fix the whole pattern rather than one leak at a time.
  - Draw the structure before and after, so a reviewer can see what changed.
```

## The invariants

They are one idea, from John Ousterhout's _A Philosophy of Software Design_: a
module is worth having when a lot of behaviour hides behind a small interface.
Deep modules let you, and your agents, hold less in mind.

Seven is used throughout as what a reader holds in mind at once (Miller, 1956).
Every limit can be changed in the config.

### `module-cycle`

Sibling modules that use each other in a circle, so there is no order to read
them in. A module is a file or a directory; `dir/index.ts` _is_ the module
`dir`, so a barrel file and its children never make a circle. Packages are left
to your package manager.

```
before   kinds.ts ━▶ socket.ts ━▶ kinds.ts     BACKLOG_MOST lives in socket.ts
after    socket.ts ━▶ kinds.ts                  BACKLOG_MOST moves to kinds.ts
```

### `tangle`

Things (top-level declarations; a class with its members) that know each other
in a circle, across more than one module, or more than seven of them. A tangle
can't be learned one piece at a time. Unlike `module-cycle`, it sees a parent
and child module that know each other.

```
before   Tasks (kernel/index.ts) ⇄ Timers (kernel/timers.ts)
after    tick() in kernel calls both; Timers no longer knows Tasks
```

### `field-leak`

Code outside a class that works on one of its fields: writes it, or reaches into
what it holds (calls a method on it, indexes it, or writes into it), directly or
through a getter that hands the field out. Reading values out of a field, however
deep (`env.config.root`), is fine: whoever reads a value depends on what it is,
not on how the class keeps it.

A class is checked when one of its own methods uses its fields and it keeps at
least one of them to itself. Its subclasses, and the things in its tangle, count
as insiders.

```ts
// before: the scheduler knows how the queue stores its tasks
queue.items.push(task)
const next = queue.items[queue.head++]

// after: it only knows what the queue does
queue.push(task)
const next = queue.pop()
```

### `shallow-module`

A directory that shows more than seven functions to code outside it, at least
as many as it hides, and has a list that long: more than seven things, or more
than seven functions of one thing. A thing's functions are its methods and the
free functions that use its types. A wrapper doesn't count, but the function it
forwards to is shown when the wrapper is.

```
before   app ━▶ store: read1, read2, … read9      shows 9, hides 1
after    app ━▶ store: load, summary              the rest are hidden behind them
```

### `wide-directory` and `long-file`

More than 15 files and directories in one directory: past that, a listing is
searched rather than read. More than 2,000 lines in one file.

## Configuration

Optional, in `ts-invariants.config.json` at the root:

```json
{
  "projects": ["apps/*/tsconfig.json", "packages/*/tsconfig.json"],
  "exclude": ["**/legacy/**"],
  "testFiles": ["**/fixtures/**"],
  "limits": { "mostInMind": 7, "mostInDirectory": 15, "mostLines": 2000 },
  "invariants": { "wide-directory": "off" }
}
```

| Key          | Default                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`   | Every `tsconfig.json` in the repository, outside `node_modules`, hidden directories, and excluded or test paths. Project references are followed.                                                       |
| `exclude`    | `node_modules`, `dist`, `build`, `.next`, `coverage`, `generated` directories, `*.generated.*`, `*.gen.*` and `.d.ts` files. Yours are added.                                                           |
| `testFiles`  | `*.test.*`, `*.spec.*`, `*.stories.*`, and `test`, `tests`, `__tests__`, `__mocks__` and `e2e` directories. Test files count for layout, but are neither checked nor counted as users. Yours are added. |
| `limits`     | As above.                                                                                                                                                                                               |
| `invariants` | All on. Set one to `"off"` to skip it.                                                                                                                                                                  |

## Command line

```
ts-invariants [path] [options]

  [path]                    report only what concerns this path
  --changed <ref>           report only what concerns files changed since <ref>
                            (e.g. origin/main), including uncommitted ones
  -p, --project <tsconfig>  index these projects (repeatable)
  -c, --config <file>       config file (default: ts-invariants.config.json)
  --allow <file>            suppress the entries listed in <file>; new ones still fail
  --update-allow <file>     write every current finding to <file> and exit 0
  --format <format>         text (default), json, markdown, or github (annotations)
  --summary                 print counts per invariant and directory instead
  --score                   print the codebase's score instead
  -q, --quiet               no progress on stderr
```

Exit codes: `0` no findings, `1` findings, `2` bad usage or config.

## Use it from a coding agent

An agent should check its own change before it calls the work done. `--changed`
keeps the report to the files the agent touched, and the allow file keeps
existing debt out of the way:

```bash
npx ts-invariants --changed origin/main --allow .ts-invariants-allow
```

[`skills/ts-invariants/SKILL.md`](skills/ts-invariants/SKILL.md) is a ready-made
[Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills): copy it
to `.claude/skills/ts-invariants/` in your repository. It tells the agent when to
run the check and how to fix each finding, without gaming the allow file.

## In CI

Two steps keep a codebase from getting worse, without asking anyone to fix
everything first:

1. Record today's findings once, and commit the file:

   ```bash
   npx ts-invariants --update-allow .ts-invariants-allow
   ```

2. Fail pull requests on new findings, with each one shown at its line, and a
   summary on the run:

   ```yaml
   - uses: actions/checkout@v4
     with:
       fetch-depth: 0
   - run: npx ts-invariants --allow .ts-invariants-allow --format github
   - if: always()
     run: npx ts-invariants --allow .ts-invariants-allow --format markdown >> "$GITHUB_STEP_SUMMARY"
   ```

When a pull request fixes a finding, `ts-invariants` says the allow file has
stale entries; rerun `--update-allow` so the fixed finding can't come back.

## Score

`--score` sums a codebase up in numbers you can compare across repositories, or
track over time:

```
files 412, lines 48210, functions 3120
erosion 0.31  (share of complexity in the 96 functions above 10)
findings 1.84 per 1,000 lines
```

**Erosion** is [SlopCodeBench](https://arxiv.org/abs/2603.24755)'s measure of
structural decay: each function's mass is its cyclomatic complexity × √(lines of
code), and erosion is the share of all mass that sits in functions with
complexity above 10. It goes up as logic piles into a few large functions. The
paper measured 0.34 on human-written repositories, and 0.68 on code written by
agents iterating on their own work.

## How it works

`ts-invariants` indexes every file once into **items** (top-level declarations
and class members) and **references** (which item's code names which item, and
whether it reads a field, writes it, or reaches into it). Each invariant is a
graph query over that index.

Plain names resolve with the TypeScript 6 compiler API. `x.member` needs the
type of `x`, which is most of a type checker's work: on a 6,000-file Next.js app
that takes TypeScript 6 about ten minutes. When TypeScript 7 is installed,
`ts-invariants` sends those names in batches to its native checker instead
(`typescript/unstable/sync`), which brings it to about two minutes. Without
TypeScript 7 it falls back to TypeScript 6, with the same results.

## Limitations

- `field-leak` looks at classes. Code that works on plain object types has no
  methods guarding its fields, so it isn't checked yet.
- Large monorepos need memory: give Node room with
  `NODE_OPTIONS=--max-old-space-size=6144`.
- The TypeScript 7 API is marked unstable, and may change between releases.

## Prior art

- [deslop-please](https://github.com/deterministic-machines/deslop-please) does
  this for Rust, and is where the invariants come from.
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser),
  [madge](https://github.com/pahen/madge) and
  [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries)
  check imports against rules you write. `ts-invariants` needs no rules, and
  looks below imports, at which declarations and fields are used.
- [knip](https://knip.dev) finds unused files and exports, which pairs well with
  `shallow-module`.

## License

MIT
