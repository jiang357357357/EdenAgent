const ANSI_START = "\x1b["
const ANSI_END = "m"
const RESET = "\x1b[0m"

export const color = {
  reset: RESET,
  black: (t: string) => fmt(t, "30"),
  gray: (t: string) => fmt(t, "90"),
  dimGray: (t: string) => fmt(t, "90"),
  slate: (t: string) => fmt(t, "37"),
  green: (t: string) => fmt(t, "32"),
  yellow: (t: string) => fmt(t, "33"),
  red: (t: string) => fmt(t, "31"),
  cyan: (t: string) => fmt(t, "36"),
  blue: (t: string) => fmt(t, "34"),
  magenta: (t: string) => fmt(t, "35"),
  brightBlue: (t: string) => fmt(t, "94"),
  brightCyan: (t: string) => fmt(t, "96"),
  brightMagenta: (t: string) => fmt(t, "95"),
  white: (t: string) => fmt(t, "37"),
  bold: (t: string) => fmt(t, "1"),
  bgRed: (t: string) => fmt(t, "41"),
  dim: (t: string) => fmt(t, "2"),
}

function fmt(text: string, code: string): string {
  return `${ANSI_START}${code}${ANSI_END}${text}${RESET}`
}

export function levelName(level: string): string {
  const pad = ` ${level.padEnd(5)}`
  switch (level) {
    case "DEBUG": return color.brightCyan(pad)
    case "INFO": return color.green(pad)
    case "WARN": return color.bold(color.yellow(pad))
    case "ERROR": return color.bold(color.red(pad))
    case "FATAL": return color.bold(color.bgRed(color.white(pad)))
    default: return pad
  }
}

export function dimPath(text: string): string {
  return color.slate(text)
}
