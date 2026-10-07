export type Diagram = {
  /** The .dgmo file shown, absolute. */
  path: string
  /** What the pane calls it; the file name when absent. */
  label?: string
  /** The last PNG that rendered, base64; sent inline so it draws over ssh too. */
  png?: string
  /** Its pixel size, read from the PNG header. */
  width?: number
  height?: number
  /** The last SVG that rendered, for surfaces without Image. */
  svg?: string
  /** Counts the renders that succeeded. */
  generation: number
  /** The parser's error for the latest save; the picture is the last good one. */
  error?: string
  isRendering: boolean
}

export type Setup = {
  /** The last render could not start `dgmo`, and `dgmo --version` failed too. */
  isDgmoMissing: boolean
  /** The pane's Install dgmo button: absent until pressed. */
  install?: 'running' | 'done' | 'failed'
  /** Why the install did not leave a working `dgmo`. */
  installError?: string
}

declare module 'claude-code' {
  interface PluginState {
    'dgmo-pane': { diagram: Diagram | null; setup: Setup }
  }
}
