# Change file format

<!-- This file is yours. `auto-release generate-skill` creates it once and never overwrites it
     (unless you pass --force). Describe the change-file style you want agents to follow -
     the generated SKILL.md points here. -->

Write an imperative title, then an indented paragraph explaining the change:

```
- Preserve existing indentation when bumping the version in JSON files

  The bump used to re-serialize with 2-space indentation, producing noisy diffs for projects
  using tabs. The original indentation and trailing-newline style are now kept.
```

- **Title**: imperative mood (`Add`, `Fix`, `Preserve`), no trailing period.
- **Body**: optional, but write one for anything non-obvious. Leave a blank line above it and
  indent it two spaces. Say what changed and what it replaces - not how it was implemented.
- **Do not restate the change type.** The changelog already groups entries under Features, Bug
  Fixes, and Breaking Changes, so a `Breaking:` or `feat:` prefix in the title is noise.

Mechanically, content is copied into the changelog **verbatim** - exactly as written, with no
markup added or removed. The leading `- ` and the two-space body indent above are what make it
render as a bullet with a paragraph; nothing forces that shape, so plain prose with no bullet
works too if you prefer it.
