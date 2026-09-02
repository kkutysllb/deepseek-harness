# Agent Note: OpenKylin rebrand and the alpha.3 upstream alignment

Status: implemented

English | [中文](2026-09-02-openkylin-rebrand-and-alpha3-alignment.zh.md)

## Problem

The engine was a token-mapped transplant of DeepSeek Harness at `dsh-v0.1.1-rc.2` carrying the QiLin brand, an unfinished P3 accounts surface that had never compiled, and five releases of upstream drift. The owner decided the product line becomes **OpenKylin** and that the engine must sit exactly on the fork's `dsh-v0.1.2-alpha.3` baseline, with the rebrand applied across the whole surface rather than left as a label.

## Decision

**The upstream delta lands through a three-way transplant, and the rebrand is a scripted pass with named residuals.** The `dsh-v0.1.1-rc.2 -> dsh-v0.1.2-alpha.3` delta (3,591 modified / 748 added / 260 deleted files) was classified per file against a normalized shadow of our tree, then applied as copies, deletions, take-theirs, and `git merge-file` three-way merges, with every ported byte passed through the token mapping (`@deepseek-ai/dsh-*` -> `@qilin/*`, bare `dsh` -> `qilin`, `DSH_` -> `QILIN_`, quoted `"dsh"` manifest keys, `Dsh*` types; vendor names, `~/.dsh`, and `window.__DSH_BOOT__` protected).

**The OpenKylin rebrand renames the operator surface and keeps the package namespace.** The CLI bin and script are `openkylin`, the product env prefix is `OPENKYLIN_`, user-visible QiLin wording is OpenKylin, the Python SDK distributes as `openkylin-sdk` with the `openkylin_runtime` module, and the terminal controlled prompt is `openkylin> `. The `@qilin/*` npm scope, the vendored `@deepseek-ai/*` kernel names, the `~/.dsh` default home, and `window.__DSH_BOOT__` stay as decided.

**Mapping blind spots are repaired at the fixture level, never by weakening gates.** The mechanical rules miss escape-adjacent (`\x07dsh`), hyphen-adjacent, and uppercase forms; every such straggler is aligned so src and its tests agree on one literal, and the session-snapshot spill scrubber accepts the renamed tmpdir prefix.

**Half-ported state finishes rather than hides.** The P3 surface that had never compiled was completed: ui-accounts joined the client aggregate with the ui-renderer augmentation trigger, its cross-plugin `AuthError` use became type-only imports plus a structural guard, account READMEs joined the doc skeleton, the `/api` RBAC fence derives its endpoint through `endpointFromPath` like every other consumer, and `OWNED_FILE_PREFIX` plus the pi-ai pin (`0.84.2`) follow the reference baseline.

## Verification

`pnpm run build`, `pnpm run typecheck`, and the full vitest suite run at parity with the pristine reference tree on this machine, including standalone greens for every spawn-timing file. `verify-client-packages`, `verify-translation-pairing` (all pairs re-recorded), `verify-archived-agent-notes` (frozen tree mirrored byte-for-byte), `doc-standard`, and the regenerated catalogs all pass. The headless CLI and web profiles replay keyless snapshots through the renamed commands.

## Alternatives considered

**Rescope the npm packages to `@openkylin/*`.** Rejected by the owner: another 18k-occurrence rewrite buys no product value while `@qilin/*` is already self-owned.

**Rewrite the engine instead of transplanting.** Rejected: the 238k-line test corpus is the asset; the transplant preserves it byte-for-byte on the new baseline.

**Leave upstream tokens inside prompts and fixture literals.** Rejected: the prompt is user-visible; escape-adjacent misses were repaired rather than exempted.

## Consequences

- Upstream tracking continues through the reference diff; the next alignment repeats the classify-then-port loop against `dsh-v0.1.2-alpha.3`.
- The renamed `OPENKYLIN_*` env names must be mirrored in the deployment's GitHub runner labels and repository secrets when CI is used (the workflows reference the new names).
- The Python distribution names change with the wheel release flow; consumers of `deepseek-harness-sdk` migrate to `openkylin-sdk`.
