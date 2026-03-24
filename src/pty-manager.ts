import * as vscode from 'vscode';
import * as os from 'os';
import { execSync } from 'child_process';

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
  tmuxSession: string; // tmux session name for cleanup
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

    const workDir = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();

    const env = { ...process.env } as Record<string, string>;
    if (!env.LANG || !env.LANG.includes('UTF-8')) {
      env.LANG = 'en_US.UTF-8';
    }
    env.TERM = 'xterm-kitty';
    env.COLORTERM = 'truecolor';

    // Sanitize session name for tmux (alphanumeric + dash only)
    const tmuxSession = 'tv-' + id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 32);

    // Spawn tmux new-session running fish shell
    // -d = detached initially (we attach immediately via the pty itself)
    // Using tmux ensures session persistence and multiplexing
    const proc = pty.spawn('tmux', [
      'new-session', '-s', tmuxSession, '-x', '80', '-y', '24', 'fish',
    ], {
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
        this.cleanupTmuxSession(tmuxSession);
        this.sessions.delete(id);
      })
    );

    this.sessions.set(id, { process: proc, disposables, tmuxSession });
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

    // Kill tmux session first
    this.cleanupTmuxSession(session.tmuxSession);

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

  private cleanupTmuxSession(name: string): void {
    try {
      execSync(`tmux kill-session -t ${name} 2>/dev/null`);
    } catch {
      // Session may already be dead
    }
  }
}
