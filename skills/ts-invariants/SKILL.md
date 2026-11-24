---
name: ts-invariants
description: Check that a TypeScript change keeps modules deep and interfaces narrow, with ts-invariants. Use after a change that adds or moves files, functions, classes or imports, before calling the work done, and when asked to check, review or clean up a codebase's structure.
---

# ts-invariants

`ts-invariants` finds structure that makes a TypeScript codebase hard to change:
modules that import each other in a circle, things that know each other in a
circle, class fields other code works on directly, directories that export more
than they hide, and very wide directories or long files.

## Check your change

Run from the repository root, against the branch you started from:

```bash
npx ts-invariants --changed origin/main --allow .ts-invariants-allow
```

- `--changed` reports only findings that touch files you changed, committed or not.
- `--allow` skips findings that were there before you; leave it out if the repo has no allow file.
- Exit code `0`: nothing new. `1`: findings to fix. `2`: bad usage or config.

On a large monorepo, give Node room: `NODE_OPTIONS=--max-old-space-size=6144`.

## Fix from first principles

Don't move code around just to make a finding go away, and don't add findings
to the allow file to get to `0`. For each finding:

- `module-cycle`, `tangle`: decide which module sits at the lower layer of
  abstraction, and make the dependency point only that way. Usually a shared
  type or constant moves down, or a coordinating function moves up.
- `field-leak`: ask why outsiders need the field at all. Give the class a method
  that does what they do with it, and use that instead. Fix every leak of a
  class together, not one at a time.
- `shallow-module`: find out what callers actually need from the directory, and
  expose a few functions that do that. Keep the rest unexported.
- `wide-directory`, `long-file`: split by what the code is about, not by kind
  (`utils/`, `hooks/`, `types/`).

When the fix changes structure, show the before and after as a small diagram in
your summary, so a reviewer can see what moved.

## Other commands

```bash
npx ts-invariants --score                 # erosion and findings per 1,000 lines
npx ts-invariants packages/api            # only what concerns one path
npx ts-invariants --update-allow .ts-invariants-allow   # record today's findings as known debt
```

Only update the allow file when the user asks you to.
