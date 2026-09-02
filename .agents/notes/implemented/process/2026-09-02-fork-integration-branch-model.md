# Agent Note: Upstream baselines arrive through fork integration branches

Status: implemented

English | [中文](2026-09-02-fork-integration-branch-model.zh.md)

## Problem

This repository began as a squashed import of the upstream tree, so git saw no common ancestor with `deepseek-ai/deepseek-harness`. Upgrading baselines meant a manual re-alignment: diff the whole tree against the new upstream tag, re-apply the brand layer by hand, and assert completeness by eye. Nothing mechanical connected our tree to upstream history, and the brand delta — package scope, env prefix, CLI word, prose ids, product name — was re-derived from scratch each upgrade.

Upstream also iterates fast: 0.1.2-alpha.3 → 0.1.2-alpha.4 alone is 297 commits over 2371 files, and its changes cross the brand layer (imports of the renamed scope, snapshot expectations embedding the product name, invariant companions and whole tools removed).

## Decision

The repository consumes upstream through per-baseline **integration branches** named `openkylin/<baseline>`, maintained in the shared fork `kkutysllb/deepseek-harness` under its `FORK-WORKFLOW.md` conventions; this repository's `main` fast-forwards to the integration tip. KCoder's `kcoder/<baseline>` branches follow the same model for that product; the branches are product-owned and never touch each other or the fork's pristine `master`.

- **Baseline adoption is a merge commit, not a re-alignment.** `openkylin/alpha.4` points at a merge commit whose parents are the upstream tag commit `dsh-v0.1.2-alpha.4` and the previous product head. The merged tree is a 3-way merge with the previous upstream tag `dsh-v0.1.2-alpha.3` as merge base, so files we never touched take upstream's version wholesale and files upstream never touched keep ours. Because the merge commit's ancestry contains real upstream tags, the next baseline is a plain `git merge <next-tag>` — git derives the merge base and re-merges only the delta. No rewrite, no force push; the old product history stays reachable as the merge commit's second parent.
- **The brand layer is mechanical and byte-verified before it is trusted.** The rename map — `@deepseek-ai/dsh-*` → `@qilin/*`, the `dsh` CLI word → `openkylin`, `DSH_*` env → `OPENKYLIN_*`, prose `dsh-*` ids → `qilin-*`, "DeepSeek Harness" → "OpenKylin" — runs with two protections: `.agents/skills/dsh-*` directory references keep their names (only link text renames), and the `-dsh-sdk` provider suffix survives interior hyphen rewrites. A conflicted file auto-resolves only when rewriting the merge base reproduces our side byte-for-byte (`rw(base) == ours`); everything else resolves line-by-line, and a brand token is accepted only on a line that the previous product state also contains. That rule keeps deliberate attributions ("forked and rebranded from DeepSeek Harness") and archived notes intact while rebranding everything the upgrade brought in.
- **Upstream removals win over our touch.** Invariant companions upstream dropped (omit-unneeded-invariants) and the child `report` tool replaced by the adjacent-Agent steer channel stay removed even where our brand layer had edited them. Snapshot expectations upstream deduplicated into symlinks adopt the symlink form, pointing at the merged target content.

## Alternatives considered

**Keep the squashed tree and re-align per baseline** — rejected: it forfeits git's merge machinery (no common ancestor), so every brand-token collision and upstream removal is resolved by hand with no byte-level verification, and completeness cannot be asserted mechanically.

**Cherry-pick the brand layer onto each upstream tag, kcoder-style** — rejected for this repository: the kcoder fork carries a two-commit product delta, while ours spans thousands of files; a cherry-pick replay would conflict on nearly every renamed import. The merge-commit form gives the same per-baseline branch shape with the brand layer carried by the merge itself.

**Rebase the product history onto upstream tags** — rejected: rewriting published product history per baseline breaks every clone and violates the fork's no-rewrite conventions; the merge commit preserves the old product head as a parent.

## Consequences

- **Completeness is asserted, not eyeballed**: the file list of `diff(previous-product-head ↔ new integration tip)` must equal the file list of the upstream tag-to-tag diff, except entries listed in the upgrade record. A deviation is upgrade-record material, never a silent merge.
- **Baseline ritual**: fetch the upstream tag → `git merge <tag>` into the current integration branch → resolve with the byte-verified brand map → `pnpm install` → typecheck, coverage, lint, doc gates → line-level brand-token sweep → completeness assertion → merge commit → push `openkylin/<baseline>` to the fork and fast-forward `main`.
- Generated catalogs, module graphs, and bilingual pairing records are never hand-merged; placeholders take the rebranded upstream text and the owning generators (`gen-*-catalog`, `verify-translation-pairing --write`) rewrite them from the merged sources.
