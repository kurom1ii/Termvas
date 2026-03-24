// Map VSCode CSS variables to xterm.js ITheme

import type { ITheme } from '@xterm/xterm';

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getThemeFromVSCode(): ITheme {
  return {
    background: getCSSVar('--vscode-terminal-background') || getCSSVar('--vscode-editor-background') || '#1e1e1e',
    foreground: getCSSVar('--vscode-terminal-foreground') || getCSSVar('--vscode-editor-foreground') || '#d4d4d4',
    cursor: getCSSVar('--vscode-terminalCursor-foreground') || getCSSVar('--vscode-editor-foreground') || '#d4d4d4',
    cursorAccent: getCSSVar('--vscode-terminalCursor-background') || undefined,
    selectionBackground: getCSSVar('--vscode-terminal-selectionBackground') || '#264f78',
    selectionForeground: getCSSVar('--vscode-terminal-selectionForeground') || undefined,
    selectionInactiveBackground: getCSSVar('--vscode-terminal-inactiveSelectionBackground') || undefined,
    black: getCSSVar('--vscode-terminal-ansiBlack') || '#000000',
    red: getCSSVar('--vscode-terminal-ansiRed') || '#cd3131',
    green: getCSSVar('--vscode-terminal-ansiGreen') || '#0dbc79',
    yellow: getCSSVar('--vscode-terminal-ansiYellow') || '#e5e510',
    blue: getCSSVar('--vscode-terminal-ansiBlue') || '#2472c8',
    magenta: getCSSVar('--vscode-terminal-ansiMagenta') || '#bc3fbc',
    cyan: getCSSVar('--vscode-terminal-ansiCyan') || '#11a8cd',
    white: getCSSVar('--vscode-terminal-ansiWhite') || '#e5e5e5',
    brightBlack: getCSSVar('--vscode-terminal-ansiBrightBlack') || '#666666',
    brightRed: getCSSVar('--vscode-terminal-ansiBrightRed') || '#f14c4c',
    brightGreen: getCSSVar('--vscode-terminal-ansiBrightGreen') || '#23d18b',
    brightYellow: getCSSVar('--vscode-terminal-ansiBrightYellow') || '#f5f543',
    brightBlue: getCSSVar('--vscode-terminal-ansiBrightBlue') || '#3b8eea',
    brightMagenta: getCSSVar('--vscode-terminal-ansiBrightMagenta') || '#d670d6',
    brightCyan: getCSSVar('--vscode-terminal-ansiBrightCyan') || '#29b8db',
    brightWhite: getCSSVar('--vscode-terminal-ansiBrightWhite') || '#ffffff',
  };
}
