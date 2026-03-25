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
const panelActions = document.getElementById('panel-actions')!;

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

// ── Top Panel (tab bar) ──

const terminalSvg = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 7 9 4 12"/><line x1="9" y1="12" x2="13" y2="12"/></svg>';

// Close all button
const closeAllBtn = document.createElement('button');
closeAllBtn.className = 'panel-action-btn';
closeAllBtn.innerHTML = '&times;';
closeAllBtn.title = 'Close all';
closeAllBtn.addEventListener('click', () => {
  const ids = getAllTiles().map(t => t.id);
  for (const id of ids) destroyTile(id);
});
panelActions.appendChild(closeAllBtn);

function focusCameraOnTile(tile: ReturnType<typeof getTile>): void {
  if (!tile) return;
  const targetCamX = tile.x + tile.width / 2 - container.clientWidth / 2 / camera.zoom;
  const targetCamY = tile.y + tile.height / 2 - container.clientHeight / 2 / camera.zoom;

  const startX = camera.x;
  const startY = camera.y;
  const duration = 50;
  const startTime = performance.now();

  function animatePan(now: number) {
    const t = Math.min(1, (now - startTime) / duration);
    const ease = 1 - Math.pow(1 - t, 3);
    camera.x = startX + (targetCamX - startX) * ease;
    camera.y = startY + (targetCamY - startY) * ease;
    updateCanvas();
    if (t < 1) requestAnimationFrame(animatePan);
    else updatePanel();
  }
  requestAnimationFrame(animatePan);
}

function updatePanel(): void {
  const tiles = getAllTiles();
  panelList.innerHTML = '';

  tiles.forEach((tile, index) => {
    const tab = document.createElement('div');
    tab.className = 'panel-tab' + (isSelected(tile.id) ? ' active' : '');

    const icon = document.createElement('span');
    icon.className = 'panel-tab-icon';
    icon.innerHTML = terminalSvg;

    const label = document.createElement('span');
    label.textContent = `${index + 1}`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      destroyTile(tile.id);
    });

    tab.appendChild(icon);
    tab.appendChild(label);
    tab.appendChild(closeBtn);

    tab.addEventListener('click', () => {
      clearSelection();
      selectTile(tile.id);
      bringToFront(tile);
      focusCameraOnTile(tile);
    });

    panelList.appendChild(tab);
  });
}

// Scroll on panel list → cycle through terminals (fast, no threshold)
panelList.addEventListener('wheel', (e) => {
  e.preventDefault();
  e.stopPropagation();

  const direction = e.deltaY > 0 ? 1 : -1;
  const tiles = getAllTiles();
  if (tiles.length === 0) return;

  let currentIdx = tiles.findIndex(t => isSelected(t.id));
  if (currentIdx === -1) currentIdx = 0;

  const nextIdx = Math.max(0, Math.min(tiles.length - 1, currentIdx + direction));
  if (nextIdx === currentIdx) return;

  const tile = tiles[nextIdx];
  clearSelection();
  selectTile(tile.id);
  bringToFront(tile);
  focusCameraOnTile(tile);
}, { passive: false });

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
// Row-aware: if placing right → stay on source row (align to row's first tile Y)
// If placing below → start new row (align X to row's first tile)

function smartDuplicate(sourceTile: ReturnType<typeof getTile>): void {
  if (!sourceTile) return;
  const GAP = 40;
  const rect = container.getBoundingClientRect();
  const mouseScreenY = lastMouseY - rect.top;
  const tileBottomScreen = camera.worldToScreen(sourceTile.x, sourceTile.y + sourceTile.height).sy;

  // Find all tiles on the same row (same Y coordinate within tolerance)
  const ROW_TOLERANCE = 20;
  const allTiles = getAllTiles();
  const rowTiles = allTiles.filter(t =>
    Math.abs(t.y - sourceTile.y) < ROW_TOLERANCE
  ).sort((a, b) => a.x - b.x);

  // Find the rightmost tile in this row
  const rightmostInRow = rowTiles[rowTiles.length - 1];
  // Find the first tile in this row (for column alignment)
  const firstInRow = rowTiles[0];

  let newX: number;
  let newY: number;

  if (mouseScreenY > tileBottomScreen) {
    // Mouse below tile → place on next row, aligned to first tile's X
    // Find existing rows below this one
    const rowY = sourceTile.y;
    const belowRows = allTiles
      .map(t => t.y)
      .filter(y => y > rowY + ROW_TOLERANCE)
      .sort((a, b) => a - b);

    if (belowRows.length > 0) {
      // There are rows below — find rightmost tile in the LAST row
      const lastRowY = belowRows[belowRows.length - 1];
      const lastRowTiles = allTiles.filter(t =>
        Math.abs(t.y - lastRowY) < ROW_TOLERANCE
      ).sort((a, b) => a.x - b.x);
      const lastInLastRow = lastRowTiles[lastRowTiles.length - 1];

      // Place to the right of the last tile in the bottom-most row
      newX = lastInLastRow.x + lastInLastRow.width + GAP;
      newY = lastRowY;
    } else {
      // No rows below — create new row
      newX = firstInRow ? firstInRow.x : sourceTile.x;
      newY = sourceTile.y + sourceTile.height + GAP;
    }
  } else {
    // Mouse horizontal → place to the right of rightmost in row
    newX = rightmostInRow.x + rightmostInRow.width + GAP;
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
