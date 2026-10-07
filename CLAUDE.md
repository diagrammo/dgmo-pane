# dgmo-pane

Claude Code mod (function-hook plugin). Load the `plugin-authoring` skill before editing — it names the API types file for the running build.

- Module: `hooks/register.tsx`; pure helpers in `hooks/layout.ts` (tested directly). State contract: `types/index.d.ts` (`dgmo-pane.diagram`).
- Gates: `claude plugin validate .` and `claude plugin test .` (tests run with no fs/process — render paths are exercised through their error branch only). Type-check: `tsc -p .` once the engine has loaded the mod and written `.claude-plugin/types/` (gitignored).
- 🔴 The terminal `Image` must use inline `{ png: base64 }`, never `{ file }`: a file source is read by the terminal on the CLIENT machine, so over ssh it draws a blank box. Verified 2026-10-07, Ghostty on a Mac ssh'd into a Linux box.
- Inline PNG is capped at 2 MiB decoded (`MAX_PNG_BASE64`); SVG at 131072 chars (`MAX_SVG`).
- Renders write to `/tmp/dgmo-pane/`.
- Install path for users is the repo's own marketplace file: `/plugin install dgmo-pane --marketplace diagrammo/dgmo-pane`.
