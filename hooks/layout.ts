/** Width and height of a PNG from its IHDR chunk, or undefined if not a PNG. */
export const pngSize = (bytes: Uint8Array): { width: number; height: number } | undefined => {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47]
  if (bytes.length < 24 || SIGNATURE.some((b, i) => bytes[i] !== b)) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** A terminal cell is about twice as tall as it is wide. */
const CELL_ASPECT = 2
const MAX_CELLS = 255

/** Fits a picture into the pane, keeping its aspect ratio. */
export const fitCells = (
  size: { width: number; height: number },
  room: { columns: number; rows: number },
): { columns: number; rows: number } => {
  const ratio = size.height / size.width / CELL_ASPECT
  let columns = Math.min(MAX_CELLS, Math.max(1, room.columns))
  let rows = Math.round(columns * ratio)
  const maxRows = Math.min(MAX_CELLS, Math.max(1, room.rows))
  if (rows > maxRows) {
    rows = maxRows
    columns = Math.max(1, Math.round(rows / ratio))
  }

  return { columns, rows: Math.max(1, rows) }
}

/** The error `dgmo --json` reports, or undefined on success. */
export const dgmoError = (stdout: string, stderr: string, exitCode: number): string | undefined => {
  try {
    const report = JSON.parse(stdout) as { success?: boolean; error?: string }
    if (report.success === true) return undefined
    if (typeof report.error === 'string') return report.error
  } catch {
    // not JSON: fall through to the raw streams
  }
  const text = (stderr || stdout).trim()

  return exitCode === 0 && text === '' ? undefined : text || `dgmo exited ${exitCode}`
}
