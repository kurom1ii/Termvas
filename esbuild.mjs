import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isWatch = process.argv.includes('--watch');

// Bundle 1: Extension host (Node.js)
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'node-pty'],
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  sourcemap: true,
};

// Bundle 2: Webview (Browser)
const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  define: {
    'global': 'globalThis',
  },
};

async function build() {
  // Ensure dist exists
  fs.mkdirSync('dist', { recursive: true });

  // Copy xterm.css
  const xtermCss = path.join('node_modules', '@xterm', 'xterm', 'css', 'xterm.css');
  if (fs.existsSync(xtermCss)) {
    fs.copyFileSync(xtermCss, path.join('dist', 'xterm.css'));
  }

  // Copy styles.css
  const stylesCss = path.join('src', 'webview', 'styles.css');
  if (fs.existsSync(stylesCss)) {
    fs.copyFileSync(stylesCss, path.join('dist', 'styles.css'));
  }

  if (isWatch) {
    const ctx1 = await esbuild.context(extensionConfig);
    const ctx2 = await esbuild.context(webviewConfig);
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
