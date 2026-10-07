import { expect, mock, test } from 'claude-code/testing'

import { dgmoError, fitCells, pngSize } from '../hooks/layout'

const PANE = { component: 'Pane', requestId: 'dgmo-pane', props: { title: 'dgmo', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const VIEWPORT = { columns: 80, rows: 40 }

test('reads the size from a PNG header', async () => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 960)
  view.setUint32(20, 780)
  expect(pngSize(bytes)).toEqual({ width: 960, height: 780 })
  expect(pngSize(new Uint8Array(24))).toBeUndefined()
})

test('fits a picture to the pane and keeps its aspect', async () => {
  expect(fitCells({ width: 1000, height: 500 }, { columns: 80, rows: 100 })).toEqual({ columns: 80, rows: 20 })
  expect(fitCells({ width: 500, height: 1000 }, { columns: 80, rows: 20 })).toEqual({ columns: 20, rows: 20 })
})

test("takes dgmo's JSON error, else its stderr", async () => {
  expect(dgmoError('{"success":true,"output":"x.png"}', '', 0)).toBeUndefined()
  expect(dgmoError('{"success":false,"error":"Line 1: No nodes found."}', '', 0)).toBe('Line 1: No nodes found.')
  expect(dgmoError('', 'dgmo: not found', 127)).toBe('dgmo: not found')
})

test('an empty pane says how to fill it', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'dgmo-pane', surface, ...PANE, viewport: VIEWPORT })
    expect(await ui.find({ type: 'Text', text: /Nothing drawn yet/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a .dgmo edit opens the pane and tells Claude why it did not render', async ($, on) => {
  on('tool.call', () => ({ result: { type: 'create', filePath: '/work/flow.dgmo' } }))
  const ran = await $.tool.call({ tool: 'Write', file_path: '/work/flow.dgmo', content: 'flowchart\n' })
  expect(ran.deny).toBeUndefined()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'dgmo-pane', surface, ...PANE, viewport: VIEWPORT })
    expect(await ui.find({ type: 'Text', text: /flow\.dgmo/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /could not show it/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a non-.dgmo edit leaves the pane empty', async ($, on) => {
  on('tool.call', () => ({ result: { type: 'create', filePath: '/work/notes.md' } }))
  await $.tool.call({ tool: 'Write', file_path: '/work/notes.md', content: '# hi\n' })
  const ui = await $.ui.mount({ plugin: 'dgmo-pane', surface: 'terminal', ...PANE, viewport: VIEWPORT })
  expect(await ui.find({ type: 'Text', text: /Nothing drawn yet/ })).toBeDefined()
  await ui.unmount()
})

test('show_diagram needs source', async $ => {
  const ran = await $.tool.call({ tool: 'mcp__dgmo-pane__show_diagram', source: '  ' } as never)
  expect(ran.isError).toBe(true)
})

test('show_diagram draws under its title and hands back the error', async ($, on) => {
  on('fs.write', () => ({ value: undefined as never }))
  const ran = await $.tool.call({
    tool: 'mcp__dgmo-pane__show_diagram',
    source: 'flowchart Demo\n\n(A) -> (B)',
    title: 'Login flow',
  } as never)
  expect(String(ran.result)).toMatch(/could not render it/)

  const ui = await $.ui.mount({ plugin: 'dgmo-pane', surface: 'terminal', ...PANE, viewport: VIEWPORT })
  expect(await ui.find({ type: 'Text', text: /Login flow/ })).toBeDefined()
  await ui.unmount()
})

test('/dgmo-pane with words asks Claude to draw them', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', ($, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  on('ui.open', () => ({ value: {} as never }))
  const clock = mock.clock(on)
  const out = await $.command.run({ command: 'dgmo-pane', args: 'the login flow' } as never)
  expect(out.text).toBe('Asked Claude to draw it.')
  await clock.advance(1)
  expect(sent[0]).toMatch(/show_diagram tool: the login flow/)
})
