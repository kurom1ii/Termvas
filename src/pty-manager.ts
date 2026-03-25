import * as vscode from 'vscode';
import * as os from 'os';

let pty: typeof import('node-pty');
try {
  pty = require('node-pty');
} catch {
  // Will be handled at createSession time
}

interface Session {
  process: import('node-pty').IPty;
  disposables: import('node-pty').IDisposable[];
}

export class PtyManager {
  private sessions = new Map<string, Session>();
  private panel: vscode.WebviewPanel;

  constructor(panel: vscode.WebviewPanel, _extensionPath: string) {
    this.panel = panel;
  }

  createSession(id: string, cwd?: string): void {
    if (!pty) {
      this.panel.webview.postMessage({
        type: 'pty-data',
        id,
        data: '\r\n\x1b[31mError: node-pty not available.\x1b[0m\r\n',
      });
      return;
    }

    if (this.sessions.has(id)) return;

    const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash');
    const workDir = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();

    const env = { ...process.env } as Record<string, string>;
    if (!env.LANG || !env.LANG.includes('UTF-8')) {
      env.LANG = 'en_US.UTF-8';
    }

    const proc = pty.spawn(shell, [], {
      name: 'xterm-kitty',
      cols: 80,
      rows: 24,
      cwd: workDir,
      env,
    });

    const disposables: import('node-pty').IDisposable[] = [];

    disposables.push(
      proc.onData((data: string) => {
        this.panel.webview.postMessage({ type: 'pty-data', id, data });
      })
    );

    disposables.push(
      proc.onExit(({ exitCode }) => {
        this.panel.webview.postMessage({ type: 'pty-exit', id, exitCode });
        this.sessions.delete(id);
      })
    );

    this.sessions.set(id, { process: proc, disposables });
  }

  writeSession(id: string, data: string): void {
    this.sessions.get(id)?.process.write(data);
  }

  resizeSession(id: string, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.process.resize(cols, rows);
    } catch {
      // Ignore resize errors for dead processes
    }
  }

  destroySession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    for (const d of session.disposables) d.dispose();
    try {
      session.process.kill();
    } catch {
      // Already dead
    }
    this.sessions.delete(id);
  }

  destroyAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.destroySession(id);
    }
  }
}
