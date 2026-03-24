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
const panelList = document.getElementById('panel-list')!;

// Track last known mouse position for smart duplicate
let lastMouseX = 0;
let lastMouseY = 0;
document.addEventListener('mousemove', (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

// Initialize canvas grid
initGrid(container, gridCanvas);
drawGrid();

// Update function
function updateCanvas(): void {
  drawGrid();
  positionAllTiles(getAllTiles());
}

// ── Side Panel ──

function updatePanel(): void {
  const tiles = getAllTiles();
  panelList.innerHTML = '';

  tiles.forEach((tile, index) => {
    const item = document.createElement('div');
    item.className = 'panel-item' + (isSelected(tile.id) ? ' active' : '');

    const icon = document.createElement('span');
    icon.className = 'panel-item-icon';
    icon.textContent = '>';

    const label = document.createElement('span');
    label.className = 'panel-item-label';
    label.textContent = `Terminal ${index + 1}`;

    item.appendChild(icon);
    item.appendChild(label);

    // Click → focus camera on this tile
    item.addEventListener('click', () => {
      clearSelection();
      selectTile(tile.id);
      bringToFront(tile);

      // Animate camera to center on this tile
      const targetCamX = tile.x + tile.width / 2 - container.clientWidth / 2 / camera.zoom;
      const targetCamY = tile.y + tile.height / 2 - container.clientHeight / 2 / camera.zoom;

      // Smooth pan animation
      const startX = camera.x;
      const startY = camera.y;
      const duration = 300;
      const startTime = performance.now();

      function animatePan(now: number) {
        const t = Math.min(1, (now - startTime) / duration);
        const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
        camera.x = startX + (targetCamX - startX) * ease;
        camera.y = startY + (targetCamY - startY) * ease;
        updateCanvas();
        updatePanel();
        if (t < 1) requestAnimationFrame(animatePan);
      }
      requestAnimationFrame(animatePan);
    });

    panelList.appendChild(item);
  });
}

// ── Tile Creation ──

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
      updatePanel();
    },
  });

  attachTileDrag(tile, dom.titleBar, () => { updateCanvas(); updatePanel(); });
  attachTileResize(tile, dom.resizeHandles, updateCanvas, (tileId) => {
    const inst = getTerminalInstance(tileId);
    if (inst) requestAnimationFrame(() => inst.fit.fit());
  });

  createTerminal(id, dom.contentArea);
  vscode.postMessage({ type: 'pty-create', id, cwd });

  clearSelection();
  selectTile(tile.id);
  updateCanvas();
  updatePanel();
}

function destroyTile(id: string): void {
  const inst = getTerminalInstance(id);
  if (inst) {
    inst.dispose();
    vscode.postMessage({ type: 'pty-destroy', id });
  }
  removeTile(id);
  removeTileDOM(id);
  updateCanvas();
  updatePanel();
}

// ── Smart Duplicate ──
// Cursor in horizontal zone of tile → place to the right (same row)
// Cursor below tile → place below (next row)

function smartDuplicate(sourceTile: typeof getAllTiles extends () => (infer T)[] ? T : never): void {
  const GAP = 40;
  const rect = container.getBoundingClientRect();
  const mouseScreenY = lastMouseY - rect.top;

  // Convert tile bottom edge to screen Y
  const tileBottomScreen = camera.worldToScreen(sourceTile.x, sourceTile.y + sourceTile.height).sy;

  let newX: number;
  let newY: number;

  if (mouseScreenY > tileBottomScreen) {
    // Mouse below tile → place below (next row)
    newX = sourceTile.x;
    newY = sourceTile.y + sourceTile.height + GAP;
  } else {
    // Mouse horizontal with tile → place to the right (same row)
    newX = sourceTile.x + sourceTile.width + GAP;
    newY = sourceTile.y;
  }

  createTerminalTile(newX, newY);
}

// ── Interactions ──

initInteractions(container, tilesLayer, zoomIndicator, marqueeEl, {
  onCreateTile: createTerminalTile,
  onTileResized: (id: string) => {
    const inst = getTerminalInstance(id);
    if (inst) requestAnimationFrame(() => inst.fit.fit());
  },
});

container.addEventListener('tile-delete', ((e: CustomEvent) => {
  destroyTile(e.detail.id);
}) as EventListener);

// Ctrl+D smart duplicate
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    const selected = getAllTiles().filter(t => isSelected(t.id));
    if (selected.length === 0) return;

    const active = document.activeElement;
    const inTerminal = active && (
      active.closest('.tile-content') ||
      active.closest('.xterm') ||
      active.tagName === 'TEXTAREA'
    );
    if (inTerminal) return;

    e.preventDefault();
    for (const tile of selected) {
      smartDuplicate(tile);
    }
  }
});

// ── Messages from extension host ──

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

// Create initial terminal tile at center
requestAnimationFrame(() => {
  const screenCX = container.clientWidth / 2 - DEFAULT_TILE_WIDTH / 2;
  const screenCY = container.clientHeight / 2 - DEFAULT_TILE_HEIGHT / 2;
  const { wx, wy } = camera.screenToWorld(screenCX, screenCY);
  const initialCwd = container.dataset.initialCwd || undefined;
  createTerminalTile(wx, wy, initialCwd);
});
