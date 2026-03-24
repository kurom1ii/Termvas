// Termvas webview entry point

import { initGrid, drawGrid, resizeCanvas } from './canvas/grid';
import {
  viewport, getAllTiles, addTile, removeTile, getTile,
  generateId, bringToFront, snapToGrid, selectTile, clearSelection,
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

// Create a new terminal tile at canvas coordinates
function createTerminalTile(canvasX: number, canvasY: number): void {
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

  // Request PTY from extension host
  vscode.postMessage({ type: 'pty-create', id });

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
  }
});

// Create initial terminal tile at center
requestAnimationFrame(() => {
  const cx = container.clientWidth / 2 - DEFAULT_TILE_WIDTH / 2;
  const cy = container.clientHeight / 2 - DEFAULT_TILE_HEIGHT / 2;
  const canvasX = (cx - viewport.panX) / viewport.zoom;
  const canvasY = (cy - viewport.panY) / viewport.zoom;
  createTerminalTile(canvasX, canvasY);
});
