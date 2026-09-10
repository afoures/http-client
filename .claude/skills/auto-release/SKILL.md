---
name: auto-release
description: Record an auto-release change file whenever you make a user-facing change in
  this repo (a feature, fix, or breaking change), before committing. Use this so the
  change is included in the next release and changelog.
---

# Recording changes with auto-release

When you make a user-facing change to this repository, record a change file **before you
commit** so it is included in the next release and changelog.

## Projects and change types

- `http-client` - valid types: `major` (Breaking Change), `minor` (Feature), `patch` (Bug Fix)

If the CLI rejects a project or type listed above, this file is stale - re-run
`auto-release generate-skill <skills-dir>` to refresh it.

## How to record a change (one shot, no prompts)

```bash
auto-release record-change --project http-client --type patch --slug <kebab-slug> \
  --content $'Short summary of the change.'
```

Always pass an explicit `--slug` so the filename is deterministic. Change files land in
`.changes/<project>/`.

## Change file format

Read `change-file-format.md` (next to this file) before writing the change content, and follow
the house style it describes.

## Verify

```bash
auto-release check                          # validate config + change files
auto-release generate-release-pr --dry-run  # preview the computed version + changelog
```

> Run the CLI however this repo exposes it - the installed `auto-release` binary, a package
> script, or `npx @afoures/auto-release <command>`.
