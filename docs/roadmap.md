# Roadmap

Where `ts-invariants` is going: how it runs, and what it checks next.

## How it runs

The check is only useful where someone acts on it. In order:

1. **The agent checks itself.** Shipped: `--changed <ref>` keeps the report to
   the files an agent touched, and [`skills/ts-invariants`](../skills/ts-invariants/SKILL.md)
   tells a coding agent when to run it and how to fix what it finds. This is the
   cheapest loop: the fix happens while the agent still has the context.
2. **Pull requests can't make it worse.** Shipped: the allow file (existing debt),
   `--format github` (findings on the lines they're about) and
   `--format markdown` (a job summary). Next:
   - A GitHub Action, `uses: QAdottech/ts-invariants@v0`, once the package is on
     npm, so a repository adds one step rather than three.
   - `--strict-allow`: fail when the allow file lists findings that are gone, so
     a fixed finding is removed from it in the same pull request and can't come
     back. The allow file then only shrinks.
3. **The trend is visible.** Next: `--score --format json` on every push to
   `main`, published as a badge (like [deslop-please](https://github.com/deterministic-machines/deslop-please)'s
   `slop` badge) and as a time series, so erosion and findings per 1,000 lines
   are tracked the way coverage is.
4. **It's fast enough to run on every push.** A 6,000-file Next.js app takes
   about two minutes; a 15,000-file monorepo about seven. Next: cache the index
   by file hash, so a run re-indexes only what changed.

## What it checks next

[SlopCodeBench](https://arxiv.org/abs/2603.24755) measures how code decays as
agents iterate on it, with two numbers: **erosion** (complexity piling into a few
functions; `--score` reports it) and **verbosity** (lines flagged by 137
AST-grep rules, plus duplicated lines, per line of code). Its anti-slop prompt
also lists what agents tend to add: defensive checks, casts, single-use
variables, trivial wrappers, heavy nesting, if/else ladders, piles of helpers,
god functions and classes.

Each candidate below is deterministic, and is either an invariant (a finding to
fix) or a measure (a number in `--score`).

### From SlopCodeBench

| Candidate          | Kind      | Rule                                                                                                                                         |
| ------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `complex-function` | invariant | Cyclomatic complexity above a limit (10 by default), measured per function without the functions nested in it. Already computed for erosion. |
| erosion budget     | invariant | Fail when `--score`'s erosion is above `limits.erosion`, or rises on a pull request.                                                         |
| `deep-nesting`     | invariant | Control flow nested deeper than 4.                                                                                                           |
| `if-ladder`        | invariant | An `if` / `else if` chain longer than 4 that a lookup table or `switch` would read better as.                                                |
| `trivial-wrapper`  | invariant | An exported function whose body only passes its arguments on to another. The index already knows these (`wraps`).                            |
| `god-class`        | invariant | A class with more fields, or more methods, than a reader holds in mind several times over.                                                   |
| duplication        | measure   | Lines in duplicated token windows (clones), per line of code.                                                                                |
| verbosity          | measure   | Lines matched by verbose-code patterns, plus clone lines, per line of code: SlopCodeBench's second number, with our own published patterns.  |

### Verbose-code patterns for TypeScript

SlopCodeBench's rules are not published, so these would be ours, each with a
fixture showing a match and a near miss:

- Building an array in a loop where `map` or `filter` says it.
- A variable assigned once and used once on the next line.
- `try` / `catch` that only rethrows, or swallows the error.
- An `if` that guards against a value the types already rule out.
- `as` casts and `!` non-null assertions, per line of code.
- An empty-collection check right before a loop over the same collection.

### TypeScript-specific invariants

- **Layers.** Declare the order (`app → features → lib`) in config, and flag
  imports that point the wrong way. Turns what `module-cycle` finds after the
  fact into a rule up front.
- **No reaching past `index.ts`.** Code outside a directory with an `index.ts`
  imports only from it. Enforces the narrow interface at the import.
- **`field-leak` for plain data.** Most TypeScript code works on object types,
  not classes. Treat the module that declares a type as its owner, and flag
  code elsewhere that builds or mutates it.
- **Leaking dependencies.** An exported function whose parameters or result
  are a third-party library's types (an ORM's row types, an HTTP client's
  response), which ties every caller to that library.
