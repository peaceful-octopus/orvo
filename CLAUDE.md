# Working in this repo

## Finding code

- Search source first and leave tests out: `rg <term> -g '!*.test.*' -g '!e2e/**' -g '!packages/testkit/**'`. Search the tests in a second pass, only when the change alters behavior they check.
- Tests live next to their source as `*.test.ts(x)`; browser tests are in `e2e/`.

## Writing tests

- Setup that several tests share belongs in a helper, not pasted into each file: `e2e/helpers.ts` for browser tests (`joinRoom`, `seedSettings`), `packages/testkit` for unit tests. A repeated fixture literal makes every refactor of that value touch every copy.
- Helpers that exist: `e2e/helpers.ts` has `joinRoom`, `joinPair`, `clickJoin`, `expectInCall`, `leaveCall`, `openSettings`, `seedSettings`, `expectAllConnected`; `packages/testkit` has `testKeys`, `signingKey`, `FakeClock`, `makeConfig`. Check them before writing the same selector or setup again, and add to them when a third copy appears.
- A test that does not care about a value should not state it. A test that does care imports the constant (`DEFAULT_NOISE_STRENGTH`) instead of copying the number.
- Prefer assertions on what a person sees or what crosses a package boundary over assertions on internal state shapes.

## Layout

- `apps/app`: React UI. `apps/client`: Tauri shell for the desktop (Windows, macOS) and Android apps. `apps/beacon`, `apps/signaling`, `apps/server`: the server side. See `OVERVIEW.md`.
- After client code changes, rebuild the installer: `pnpm --filter @orvo/client build`.
