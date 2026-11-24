# ts-invariants

A CLI that checks TypeScript codebases for deep modules and narrow interfaces.

- `pnpm test`: fixture tests; each fixture runs with the TypeScript 7 member resolver and the TypeScript 6 fallback, which must agree.
- `pnpm typecheck`, `pnpm format:check`, `pnpm build`.
- `pnpm check`: run the tool on this repo. It must stay at 0 findings.

Layout: `src/buildModel.ts` indexes code into items and references (`src/model.ts`); each file in `src/invariants/` is one invariant, a query over that model; `src/check.ts` runs them; `src/cli.ts` is the command line.

To add an invariant: add its name to `INVARIANTS` in `src/config.ts`, write it in `src/invariants/`, call it from `src/check.ts`, add a fixture case to `test/`, and document it in the README.
