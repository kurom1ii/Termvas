// Terminal tile: xterm.js instance per canvas tile

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { getThemeFromVSCode } from './theme';
import { getIsPanning } from '../canvas/interactions';

// VS Code-style data buffering interval (5ms)
const DATA_BUFFER_FLUSH_MS = 5;

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Get VSCode API reference from main.ts
let vscodeApi: ReturnType<typeof acquireVsCodeApi>;

export function setVSCodeApi(api: ReturnType<typeof acquireVsCodeApi>): void {
  vscodeApi = api;
}

export interface TerminalInstance {
  terminal: Terminal;
  fit: FitAddon;
  sessionId: string;
  dispose: () => void;
}

const instances = new Map<string, TerminalInstance>();

export function getTerminalInstance(id: string): TerminalInstance | undefined {
  return instances.get(id);
}

export function createTerminal(sessionId: string, contentArea: HTMLElement): TerminalInstance {
  const term = new Terminal({
    theme: getThemeFromVSCode(),
    fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace',
    fontSize: 16,
    fontWeight: '400',
    fontWeightBold: '700',
    cursorBlink: true,
    scrollback: 200000,
    allowProposedApi: true,
    drawBoldTextInBrightColors: true,
    letterSpacing: 0,
    lineHeight: 1.1,
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(contentArea);

  // Unicode support
  const unicode11 = new Unicode11Addon();
  term.loadAddon(unicode11);
  term.unicode.activeVersion = '11';

  // WebGL renderer with DOM fallback
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // DOM renderer fallback
  }

  // Initial fit after layout settles
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fit.fit();
      // Send initial size to PTY
      vscodeApi.postMessage({
        type: 'pty-resize',
        id: sessionId,
        cols: term.cols,
        rows: term.rows,
      });
    });
  });

  // ── Focus lock: scroll/input isolation ──

  // Wheel events: Ctrl+wheel → let bubble to canvas for zoom
  // Normal scroll → stop propagation, xterm handles scrollback
  contentArea.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      // Zoom: blur terminal and let event bubble to canvas
      term.blur();
      return;
    }
    // Normal scroll: keep in terminal, don't pan canvas
    e.stopPropagation();
  }, { passive: true });

  // Click inside content → focus terminal (skip during pan/Ctrl)
  contentArea.addEventListener('mousedown', (e) => {
    if (e.button === 1) return;
    if (e.ctrlKey || e.metaKey) return; // Ctrl+click = pan, not focus
    if (getIsPanning()) return;
    term.focus();
  });

  // Hover into terminal → focus (skip during pan)
  contentArea.addEventListener('mouseenter', () => {
    if (getIsPanning()) return;
    term.focus();
  });

  // Leave terminal content → blur IMMEDIATELY
  // Moving to title bar = contentArea mouseleave = instant blur
  // So Ctrl+D on title bar works without delay
  contentArea.addEventListener('mouseleave', () => {
    term.blur();
  });

  // User input → PTY
  const onDataDisposable = term.onData((data: string) => {
    vscodeApi.postMessage({ type: 'pty-write', id: sessionId, data });
  });

  // Resize → PTY
  const onResizeDisposable = term.onResize(({ cols, rows }) => {
    vscodeApi.postMessage({ type: 'pty-resize', id: sessionId, cols, rows });
  });

  // ResizeObserver for auto-fit
  let resizeTimer: number | undefined;
  const resizeObserver = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    if (width > 0 && height > 0) {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => fit.fit(), 100);
    }
  });
  resizeObserver.observe(contentArea);

  // Data buffering (like VS Code)
  let dataBuffer: string[] = [];
  let flushTimer: number | undefined;

  function flushData(): void {
    const chunk = dataBuffer.join('');
    dataBuffer.length = 0;
    flushTimer = undefined;
    if (chunk) term.write(chunk);
  }

  function handlePtyData(data: string): void {
    dataBuffer.push(data);
    if (flushTimer === undefined) {
      flushTimer = window.setTimeout(flushData, DATA_BUFFER_FLUSH_MS);
    }
  }

  function dispose(): void {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushData();
    }
    clearTimeout(resizeTimer);
    resizeObserver.disconnect();
    onDataDisposable.dispose();
    onResizeDisposable.dispose();
    term.dispose();
    instances.delete(sessionId);
  }

  const instance: TerminalInstance = { terminal: term, fit, sessionId, dispose };
  instances.set(sessionId, instance);

  // Expose handlePtyData on the instance
  (instance as any).handlePtyData = handlePtyData;

  return instance;
}

export function handlePtyData(sessionId: string, data: string): void {
  const inst = instances.get(sessionId);
  if (inst) {
    (inst as any).handlePtyData(data);
  }
}

export function handlePtyExit(sessionId: string): void {
  const inst = instances.get(sessionId);
  if (inst) {
    inst.terminal.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
  }
}

export function updateAllThemes(): void {
  const theme = getThemeFromVSCode();
  for (const inst of instances.values()) {
    inst.terminal.options.theme = theme;
  }
}

export function refitAll(): void {
  for (const inst of instances.values()) {
    requestAnimationFrame(() => inst.fit.fit());
  }
}
