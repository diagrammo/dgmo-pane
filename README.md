# dgmo-pane

A Claude Code mod that draws your diagrams while Claude writes them.

Whenever Claude writes or edits a `.dgmo` file, a side pane re-renders it with
[dgmo](https://www.npmjs.com/package/@diagrammo/dgmo-cli). If the file does not
parse, the pane keeps the last good picture, shows the error in red, and the
error is handed back to Claude so it can fix the file.

Or just ask: "diagram the login flow", "draw this directory structure". Claude
draws it with the mod's `show_diagram` tool and the picture appears in the pane.

- **Terminal** (Ghostty, kitty): the diagram is drawn as an image. Works over ssh.
- **Desktop app, VS Code, mobile**: drawn as SVG.
- `/dgmo-pane <file>` shows a `.dgmo` file; `/dgmo-pane <what to draw>` asks Claude
  to draw it; `/dgmo-pane` alone opens the pane.

The pane opens by itself on the first `.dgmo` edit once the terminal is at
least 144 columns wide; `/dgmo-pane` opens it at any width.

## Requirements

- The `dgmo` command on your `PATH`: `npm install -g @diagrammo/dgmo-cli`
- A Claude Code build with function-hook plugins (mods). The mod API is early
  access and may change.

## Install

In a Claude Code terminal session:

```
/plugin install dgmo-pane --marketplace diagrammo/dgmo-pane
```

Answer `y` to add the marketplace, then pick a scope.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .      # run a session with this checkout loaded
```
