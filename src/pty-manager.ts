import * as vscode from 'vscode';
import * as os from 'os';

// node-pty is loaded dynamically to handle missing native module gracefully
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

  constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
  }

  createSession(id: string, cwd?: string): void {
    if (!pty) {
      this.panel.webview.postMessage({
        type: 'pty-data',
        id,
        data: '\r\n\x1b[31mError: node-pty not available. Rebuild native modules.\x1b[0m\r\n',
      });
      return;
    }

    if (this.sessions.has(id)) return;

    const shell = this.getDefaultShell();
    const workDir = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();

    const env = { ...process.env } as Record<string, string>;
    if (!env.LANG || !env.LANG.includes('UTF-8')) {
      env.LANG = 'en_US.UTF-8';
    }
    env.TERM = 'xterm-256color';
    // Ensure COLORTERM is set for true color support
    env.COLORTERM = 'truecolor';

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
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

  private getDefaultShell(): string {
    // Respect VSCode terminal settings
    const config = vscode.workspace.getConfiguration('terminal.integrated');
    const platform = os.platform();

    if (platform === 'win32') {
      return config.get<string>('defaultProfile.windows') || process.env.COMSPEC || 'cmd.exe';
    }
    if (platform === 'darwin') {
      return config.get<string>('shell.osx') || process.env.SHELL || '/bin/zsh';
    }
    return config.get<string>('shell.linux') || process.env.SHELL || '/bin/bash';
  }
}
