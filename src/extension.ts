import * as vscode from 'vscode';
import { PtyManager } from './pty-manager';
import * as path from 'path';
import * as fs from 'fs';

let panel: vscode.WebviewPanel | undefined;
let ptyManager: PtyManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand('termvas.open', () => {
    if (panel) {
      panel.reveal();
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

    ptyManager = new PtyManager(panel);

    panel.webview.html = getWebviewContent(panel.webview, context.extensionPath);

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
  });

  context.subscriptions.push(cmd);
}

function getWebviewContent(webview: vscode.Webview, extensionPath: string): string {
  const distUri = vscode.Uri.file(path.join(extensionPath, 'dist'));
  const webviewJs = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js'));
  const xtermCss = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'xterm.css'));
  const stylesCss = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'styles.css'));

  const nonce = getNonce();

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
  <div id="canvas-container">
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
