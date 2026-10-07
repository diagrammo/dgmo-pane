import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diagram } from '../types'
import { dgmoError, fitCells, pngSize } from './layout'

const PANE = 'dgmo-pane'
const OUT_DIR = '/tmp/dgmo-pane'
/** Svg's own bound on its markup. */
const MAX_SVG = 131072
/** Image's bound on inline bytes, 2 MiB decoded, as base64 characters. */
const MAX_PNG_BASE64 = Math.floor((2 * 1024 * 1024 * 4) / 3)

const diagram = atom({ plugin: 'dgmo-pane', key: 'diagram' } as const, null as Diagram | null)

/** Renders to temp files; only the newest render of a path writes the state. */
let latest = 0

const render = async ($: EngineInterface, path: string): Promise<string | undefined> => {
  const ticket = ++latest
  await update($, diagram, old => ({
    ...(old?.path === path ? old : { generation: 0 }),
    path,
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
    error = `could not show it: ${err instanceof Error ? err.message : String(err)}`
  }
  if (ticket !== latest) return error

  await update($, diagram, old => {
    const base: Diagram = old?.path === path ? old : { path, generation: 0, isRendering: false }
    if (error !== undefined || size === undefined || bytes === undefined) {
      return { ...base, error: error ?? 'dgmo wrote no readable PNG', isRendering: false }
    }

    return {
      path,
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dgmo-pane',
      description: 'Show a .dgmo diagram in a live pane: /dgmo-pane [file]',
    })

    return next(e)
  })

  on('command.run', { command: 'dgmo-pane' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'dgmo' })
    const arg = e.args.trim()
    if (arg === '') return { text: 'dgmo pane opened.' }
    const stat = await $.fs.stat(arg, { resolve: true }).catch(() => undefined)
    if (stat?.realPath === undefined) return { text: `dgmo-pane: no file at ${arg}` }
    const error = await render($, stat.realPath)

    return { text: error === undefined ? `Rendered ${arg}.` : `dgmo: ${error}` }
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
    const name = shown?.path.split('/').pop() ?? ''
    const status = shown === null ? '' : shown.isRendering ? ' · rendering…' : ''
    const header = `${name}${status}`

    if (e.surface === 'terminal') {
      const { Box, Text, Image } = $.ui.resolve(e)
      if (shown === null) {
        return <Text dimColor>No .dgmo file yet. Claude's next .dgmo edit shows here, or run /dgmo-pane &lt;file&gt;.</Text>
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
    if (shown === null) return <Text>No .dgmo file yet.</Text>

    return (
      <Box flexDirection="column">
        <Text bold>{header}</Text>
        {shown.error !== undefined && <Text color="red">✖ {shown.error}</Text>}
        {shown.svg !== undefined ? <Svg source={shown.svg} alt={`diagram from ${name}`} /> : <Text>No picture yet.</Text>}
      </Box>
    )
  })
}
