import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diagram, Setup } from '../types'
import { dgmoError, fitCells, pngSize } from './layout'

const PANE = 'dgmo-pane'
const OUT_DIR = '/tmp/dgmo-pane'
/** Svg's own bound on its markup. */
const MAX_SVG = 131072
/** Image's bound on inline bytes, 2 MiB decoded, as base64 characters. */
const MAX_PNG_BASE64 = Math.floor((2 * 1024 * 1024 * 4) / 3)

const TOOL = 'show_diagram'
const TOOL_ID = 'mcp__dgmo-pane__show_diagram'
const TOOL_DESCRIPTION = [
  'Draws a diagram for the user in the dgmo pane beside the conversation.',
  'Use it whenever the user asks to diagram, draw, chart or visualize something.',
  'Pass the diagram as DGMO source, the language of the `dgmo` command: the first line names the chart type and a title,',
  'then the content, e.g. "flowchart Login\n\n(Start) -> [Check password] -> (Signed in)".',
  'Run `dgmo types` for every chart type. A parse error comes back as the result: fix the source and call again.',
].join(' ')

const diagram = atom({ plugin: 'dgmo-pane', key: 'diagram' } as const, null as Diagram | null)
const setup = atom({ plugin: 'dgmo-pane', key: 'setup' } as const, { isDgmoMissing: false } as Setup)

const PACKAGE = '@diagrammo/dgmo-cli'
const INSTALL_COMMAND = `npm install -g ${PACKAGE}`
const MISSING = `dgmo is not installed. The user can press Install dgmo in the pane, or run \`${INSTALL_COMMAND}\`.`

const isDgmoMissing = ($: EngineInterface): Promise<boolean> =>
  $.process.run(['dgmo', '--version']).then(
    ran => ran.exitCode !== 0,
    () => true,
  )

/** The pane's Install dgmo button: npm installs the CLI, then the last diagram draws again. */
const installDgmo = async ($: EngineInterface): Promise<void> => {
  await update($, setup, (old): Setup => ({ ...old, install: 'running', installError: undefined }))
  const ran = await $.process.run(['npm', 'install', '-g', PACKAGE], { timeoutMs: 600_000 }).catch(() => undefined)
  let installError: string | undefined
  if (ran === undefined) {
    installError = 'npm was not found. Install Node.js from nodejs.org, then press Install dgmo again.'
  } else if (ran.exitCode !== 0) {
    const last = ran.stderr.trim().split('\n').filter(line => line.trim() !== '').pop() ?? `exit ${ran.exitCode}`
    installError = `npm install failed: ${last}`
  } else if (await isDgmoMissing($)) {
    installError = 'dgmo is installed, but this session cannot find it. Restart Claude Code.'
  }
  await update($, setup, (): Setup => ({
    isDgmoMissing: installError !== undefined,
    install: installError === undefined ? 'done' : 'failed',
    installError,
  }))
  const last = await read($, diagram)
  if (installError === undefined && last !== null) await render($, last.path, last.label)
}

/** Renders to temp files; only the newest render of a path writes the state. */
let latest = 0

const render = async ($: EngineInterface, path: string, label?: string): Promise<string | undefined> => {
  const ticket = ++latest
  await update($, diagram, old => ({
    ...(old?.path === path ? old : { generation: 0 }),
    path,
    label,
    isRendering: true,
  }))

  const stem = `${OUT_DIR}/${path.replace(/[^A-Za-z0-9._-]/g, '_')}`
  let error: string | undefined
  let size: { width: number; height: number } | undefined
  let bytes: string | undefined
  let markup: string | undefined
  try {
    await $.process.run(['mkdir', '-p', OUT_DIR])
    const [png, svg] = await Promise.all([
      $.process.run(['dgmo', path, '-o', `${stem}.png`, '--json', '--theme', 'dark'], { timeoutMs: 60_000 }),
      $.process.run(['dgmo', path, '-o', `${stem}.svg`, '--json', '--theme', 'dark'], { timeoutMs: 60_000 }),
    ])
    error = dgmoError(png.stdout, png.stderr, png.exitCode)
    if (error === undefined) {
      const { base64 } = await $.fs.read(`${stem}.png`, { as: 'bytes' })
      if (base64.length > MAX_PNG_BASE64) throw new Error('the PNG is over the 2 MiB an Image takes')
      bytes = base64
      size = pngSize(Uint8Array.fromBase64(base64))
      if (dgmoError(svg.stdout, svg.stderr, svg.exitCode) === undefined) {
        const text = await $.fs.read(`${stem}.svg`).catch(() => undefined)
        markup = text !== undefined && text.length <= MAX_SVG ? text : undefined
      }
    }
  } catch (err) {
    error = (await isDgmoMissing($))
      ? MISSING
      : `could not show it: ${err instanceof Error ? err.message : String(err)}`
  }
  const isMissing = error === MISSING
  if ((await read($, setup)).isDgmoMissing !== isMissing) {
    await update($, setup, old => ({ ...old, isDgmoMissing: isMissing }))
  }
  if (ticket !== latest) return error

  await update($, diagram, old => {
    const base: Diagram = old?.path === path ? old : { path, label, generation: 0, isRendering: false }
    if (error !== undefined || size === undefined || bytes === undefined) {
      return { ...base, error: error ?? 'dgmo wrote no readable PNG', isRendering: false }
    }

    return {
      path,
      label,
      png: bytes,
      width: size.width,
      height: size.height,
      svg: markup,
      generation: base.generation + 1,
      isRendering: false,
    }
  })

  return error
}

/** Inline diagrams get a fresh file each, so one never overwrites a picture still drawing. */
let inline = 0

/**
 * Declares the command and the tool. `session.start` is too late for a mod
 * installed mid-session (the session has already started), so the first
 * event after a load also tries; both calls replace what they declared.
 */
let isDeclared = false
const declare = async ($: EngineInterface): Promise<void> => {
  if (isDeclared) return
  isDeclared = true
  try {
    await $.command.register({
      name: 'dgmo-pane',
      description: 'Show a diagram in the dgmo pane: a .dgmo file, or describe what to draw',
      argumentHint: '[file.dgmo | what to draw]',
    })
    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'The whole diagram in DGMO.' },
          title: { type: 'string', description: 'A short name for the pane header.' },
        },
        required: ['source'],
      },
    })
  } catch {
    isDeclared = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await declare($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await declare($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    void declare($)

    return next(e)
  })

  on('command.run', { command: 'dgmo-pane' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'dgmo' }).catch(() => undefined)
    const arg = e.args.trim()
    if (arg === '') return { text: 'dgmo pane opened.' }

    const stat = await $.fs.stat(arg, { resolve: true }).catch(() => undefined)
    if (stat?.realPath !== undefined && stat.kind === 'file') {
      const error = await render($, stat.realPath)

      return { text: error === undefined ? `Rendered ${arg}.` : `dgmo: ${error}` }
    }

    // A command.run hook cannot submit: the prompt would wait on the dispatch
    // this hook holds. A timer runs after it, once the session is idle.
    $.clock.after(0, () => {
      void $.prompt.submit({ text: `Draw this with the ${TOOL} tool: ${arg}`, asUser: true }).catch(() => undefined)
    })

    return { text: 'Asked Claude to draw it.' }
  })

  on('tool.call', { tool: TOOL_ID }, async ($, e) => {
    const input = (e as unknown as { source?: unknown; title?: unknown })
    if (typeof input.source !== 'string' || input.source.trim() === '') {
      return { result: 'show_diagram needs `source`, the diagram in DGMO.', isError: true }
    }
    const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : undefined
    const path = `${OUT_DIR}/inline-${++inline}.dgmo`
    const isWritten = await $.fs
      .write(path, input.source.endsWith('\n') ? input.source : `${input.source}\n`)
      .then(() => true, () => false)
    if (!isWritten) return { result: `show_diagram could not write ${path}.`, isError: true }
    void $.ui.open({ id: PANE, title: 'dgmo' }).catch(() => undefined)
    const error = await render($, path, title)

    return error === undefined
      ? { result: 'The diagram is showing in the dgmo pane.' }
      : { result: `dgmo could not render it: ${error}`, isError: true }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isEdit = e.tool === 'Write' || e.tool === 'Edit'
    if (!isEdit || ran.deny !== undefined || ran.isError === true) return ran
    const path = e.file_path
    if (!path.endsWith('.dgmo')) return ran

    void $.ui.open({ id: PANE, title: 'dgmo' }).catch(() => undefined)
    const error = await render($, path)
    if (error === undefined) return ran

    return { ...ran, context: [...(ran.context ?? []), `dgmo could not render ${path}: ${error}`] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const shown = await read($, diagram)
    const name = shown?.label ?? shown?.path.split('/').pop() ?? ''
    const status = shown === null ? '' : shown.isRendering ? ' · rendering…' : ''
    const header = `${name}${status}`

    const ready = await read($, setup)
    if (ready.isDgmoMissing) {
      const { Box, Text, Button } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          <Text bold>dgmo is not installed</Text>
          <Text>The pane needs the dgmo command to draw diagrams.</Text>
          {ready.install === 'running' ? (
            <Text>Installing {PACKAGE}…</Text>
          ) : (
            <Button key="install" label="Install dgmo" hotkey="i" onPress={() => installDgmo($)} />
          )}
          {ready.installError !== undefined && <Text color="red">✖ {ready.installError}</Text>}
          <Text>Or run it yourself: {INSTALL_COMMAND}</Text>
        </Box>
      )
    }

    if (e.surface === 'terminal') {
      const { Box, Text, Image } = $.ui.resolve(e)
      if (shown === null) {
        return <Text dimColor>Nothing drawn yet. Ask Claude to diagram something, or run /dgmo-pane &lt;file or description&gt;.</Text>
      }
      const errorRows = shown.error === undefined ? 0 : 3
      const room = {
        columns: Math.max(1, (e.viewport?.columns ?? 80) - 2),
        rows: Math.max(1, (e.viewport?.rows ?? 24) - 6 - errorRows),
      }
      const cells = shown.width && shown.height ? fitCells({ width: shown.width, height: shown.height }, room) : undefined

      return (
        <Box flexDirection="column">
          <Text bold>{header}</Text>
          {shown.error !== undefined && <Text color="red">✖ {shown.error}</Text>}
          {shown.png !== undefined && cells !== undefined ? (
            <Image
              key="diagram"
              source={{ png: shown.png }}
              columns={cells.columns}
              rows={cells.rows}
              alt={`diagram from ${name}`}
            />
          ) : (
            <Text dimColor>No picture yet.</Text>
          )}
        </Box>
      )
    }

    const { Box, Text, Svg } = $.ui.resolve(e)
    if (shown === null) return <Text>Nothing drawn yet. Ask Claude to diagram something.</Text>

    return (
      <Box flexDirection="column">
        <Text bold>{header}</Text>
        {shown.error !== undefined && <Text color="red">✖ {shown.error}</Text>}
        {shown.svg !== undefined ? <Svg source={shown.svg} alt={`diagram from ${name}`} /> : <Text>No picture yet.</Text>}
      </Box>
    )
  })
}
