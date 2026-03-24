import * as vscode from 'vscode';
import { PtyManager } from './pty-manager';
import * as path from 'path';
import * as fs from 'fs';

let panel: vscode.WebviewPanel | undefined;
let ptyManager: PtyManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  function openCanvas(cwd?: string) {
    if (panel) {
      panel.reveal();
      // If a cwd was provided and panel already exists, create a new tile
      if (cwd) {
        panel.webview.postMessage({ type: 'create-tile', cwd });
      }
      return;
    }

    panel = vscode.window.createWebviewPanel(
      'termvas',
      'Termvas',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'dist')),
        ],
      }
    );

    ptyManager = new PtyManager(panel, context.extensionPath);

    // Pass initial cwd to webview so the first tile uses it (no duplicate)
    panel.webview.html = getWebviewContent(panel.webview, context.extensionPath, cwd);

    panel.webview.onDidReceiveMessage(
      (msg) => {
        switch (msg.type) {
          case 'pty-create':
            ptyManager!.createSession(msg.id, msg.cwd);
            break;
          case 'pty-write':
            ptyManager!.writeSession(msg.id, msg.data);
            break;
          case 'pty-resize':
            ptyManager!.resizeSession(msg.id, msg.cols, msg.rows);
            break;
          case 'pty-destroy':
            ptyManager!.destroySession(msg.id);
            break;
        }
      },
      undefined,
      context.subscriptions
    );

    // Notify webview when theme changes
    vscode.window.onDidChangeActiveColorTheme(() => {
      panel?.webview.postMessage({ type: 'theme-changed' });
    }, undefined, context.subscriptions);

    panel.onDidDispose(() => {
      ptyManager?.destroyAll();
      ptyManager = undefined;
      panel = undefined;
    }, undefined, context.subscriptions);
  }

  // Command: open canvas (command palette + context menu)
  const cmd = vscode.commands.registerCommand('termvas.open', (uri?: vscode.Uri) => {
    // Only use cwd from explicit URI arg (explorer context menu)
    // Don't auto-pick from active editor to avoid file-path-as-cwd errors
    let cwd: string | undefined;
    if (uri) {
      const stat = fs.statSync(uri.fsPath, { throwIfNoEntry: false });
      // If it's a file, use its parent directory
      cwd = stat?.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
    }
    openCanvas(cwd);
  });

  // Command: restart extension — destroy everything and reload VSCode to load latest code
  const cmdRestart = vscode.commands.registerCommand('termvas.restart', async () => {
    // Destroy current panel and all PTY sessions
    if (panel) {
      ptyManager?.destroyAll();
      panel.dispose();
    }

    // Reload the entire VSCode window — this reloads all extensions with fresh code
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  });

  context.subscriptions.push(cmd, cmdRestart);
}

function getWebviewContent(webview: vscode.Webview, extensionPath: string, initialCwd?: string): string {
  const distUri = vscode.Uri.file(path.join(extensionPath, 'dist'));
  const webviewJs = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js'));
  const xtermCss = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'xterm.css'));
  const stylesCss = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'styles.css'));

  const nonce = getNonce();
  const cwdAttr = initialCwd ? ` data-initial-cwd="${initialCwd.replace(/"/g, '&quot;')}"` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${xtermCss}">
  <link rel="stylesheet" href="${stylesCss}">
  <title>Termvas</title>
</head>
<body>
  <div id="canvas-container"${cwdAttr}>
    <canvas id="grid-canvas"></canvas>
    <div id="tiles-layer"></div>
    <div id="marquee" class="hidden"></div>
    <div id="zoom-indicator"></div>
  </div>
  <script nonce="${nonce}" src="${webviewJs}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export function deactivate() {
  ptyManager?.destroyAll();
}
