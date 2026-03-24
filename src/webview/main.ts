// Termvas webview entry point

import { initGrid, drawGrid, resizeCanvas } from './canvas/grid';
import {
  camera, viewport, getAllTiles, addTile, removeTile, getTile,
  generateId, bringToFront, snapToGrid, selectTile, clearSelection, isSelected,
  DEFAULT_TILE_WIDTH, DEFAULT_TILE_HEIGHT, GRID_CELL,
} from './canvas/state';
import { createTileDOM, removeTileDOM, positionAllTiles, positionTile, getTileDom } from './canvas/renderer';
import { initInteractions, attachTileDrag, attachTileResize } from './canvas/interactions';
import { createTerminal, getTerminalInstance, handlePtyData, handlePtyExit, updateAllThemes, refitAll, setVSCodeApi } from './terminal/terminal-tile';

// Acquire VSCode API
const vscode = acquireVsCodeApi();
setVSCodeApi(vscode);

// DOM elements
const container = document.getElementById('canvas-container')!;
const gridCanvas = document.getElementById('grid-canvas') as HTMLCanvasElement;
const tilesLayer = document.getElementById('tiles-layer')!;
const marqueeEl = document.getElementById('marquee')!;
const zoomIndicator = document.getElementById('zoom-indicator')!;

// Initialize canvas grid
initGrid(container, gridCanvas);
drawGrid();

// Update function
function updateCanvas(): void {
  drawGrid();
  positionAllTiles(getAllTiles());
}

// Create a new terminal tile at canvas coordinates, optionally with a custom cwd
function createTerminalTile(canvasX: number, canvasY: number, cwd?: string): void {
  const id = generateId();
  const tile = addTile({
    id,
    x: Math.round(canvasX / GRID_CELL) * GRID_CELL,
    y: Math.round(canvasY / GRID_CELL) * GRID_CELL,
    width: DEFAULT_TILE_WIDTH,
    height: DEFAULT_TILE_HEIGHT,
    zIndex: 0,
    ptySessionId: id,
  });

  const dom = createTileDOM(tile, tilesLayer, {
    onClose: (tileId) => destroyTile(tileId),
    onFocus: (tileId) => {
      const t = getTile(tileId);
      if (t) {
        bringToFront(t);
        const d = getTileDom(tileId);
        if (d) positionTile(d, t);
      }
    },
  });

  // Attach drag and resize
  attachTileDrag(tile, dom.titleBar, updateCanvas);
  attachTileResize(tile, dom.resizeHandles, updateCanvas, (tileId) => {
    const inst = getTerminalInstance(tileId);
    if (inst) {
      requestAnimationFrame(() => inst.fit.fit());
    }
  });

  // Create xterm.js terminal in the content area
  createTerminal(id, dom.contentArea);

  // Request PTY from extension host (with optional cwd)
  vscode.postMessage({ type: 'pty-create', id, cwd });

  // Select the new tile
  clearSelection();
  selectTile(tile.id);
  updateCanvas();
}

// Destroy a tile and its terminal
function destroyTile(id: string): void {
  const inst = getTerminalInstance(id);
  if (inst) {
    inst.dispose();
    vscode.postMessage({ type: 'pty-destroy', id });
  }
  removeTile(id);
  removeTileDOM(id);
  updateCanvas();
}

// Initialize interactions
initInteractions(container, tilesLayer, zoomIndicator, marqueeEl, {
  onCreateTile: createTerminalTile,
  onTileResized: (id: string) => {
    const inst = getTerminalInstance(id);
    if (inst) {
      requestAnimationFrame(() => inst.fit.fit());
    }
  },
});

// Handle tile-delete custom event
container.addEventListener('tile-delete', ((e: CustomEvent) => {
  destroyTile(e.detail.id);
}) as EventListener);

// Ctrl+D to duplicate selected terminal tile
// Works when title bar was clicked (tile selected) — not when terminal has keyboard focus
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    const selected = getAllTiles().filter(t => isSelected(t.id));
    if (selected.length === 0) return;

    // Check if any terminal has actual keyboard focus (user is typing)
    const active = document.activeElement;
    const inTerminal = active && (
      active.closest('.tile-content') ||
      active.closest('.xterm') ||
      active.tagName === 'TEXTAREA'
    );
    if (inTerminal) return; // let Ctrl+D go to terminal (EOF)

    e.preventDefault();
    for (const tile of selected) {
      createTerminalTile(tile.x + 40, tile.y + 40);
    }
  }
});

// Listen for messages from extension host
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'pty-data':
      handlePtyData(msg.id, msg.data);
      break;
    case 'pty-exit':
      handlePtyExit(msg.id);
      break;
    case 'theme-changed':
      // Re-read CSS variables and update everything
      requestAnimationFrame(() => {
        drawGrid();
        updateAllThemes();
      });
      break;
    case 'create-tile': {
      const tiles = getAllTiles();
      const offsetX = tiles.length * 40;
      const offsetY = tiles.length * 40;
      const screenCX = container.clientWidth / 2 - DEFAULT_TILE_WIDTH / 2 + offsetX;
      const screenCY = container.clientHeight / 2 - DEFAULT_TILE_HEIGHT / 2 + offsetY;
      const { wx, wy } = camera.screenToWorld(screenCX, screenCY);
      createTerminalTile(wx, wy, msg.cwd);
      break;
    }
  }
});

// Create initial terminal tile at center, using initial cwd if provided
requestAnimationFrame(() => {
  const screenCX = container.clientWidth / 2 - DEFAULT_TILE_WIDTH / 2;
  const screenCY = container.clientHeight / 2 - DEFAULT_TILE_HEIGHT / 2;
  const { wx, wy } = camera.screenToWorld(screenCX, screenCY);
  const initialCwd = container.dataset.initialCwd || undefined;
  createTerminalTile(wx, wy, initialCwd);
});
