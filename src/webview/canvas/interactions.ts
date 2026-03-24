// Canvas interactions: pan, zoom, tile drag, tile resize

import {
  Tile, camera, ZOOM_MIN, ZOOM_MAX, GRID_CELL,
  getAllTiles, bringToFront, snapToGrid,
  selectTile, clearSelection, toggleSelection,
  isSelected, getSelectedTiles, MIN_TILE_WIDTH, MIN_TILE_HEIGHT,
} from './state';
import { positionTile, positionAllTiles, getAllTileDoms } from './renderer';
import { drawGrid, resizeCanvas } from './grid';

// ── Pan state (exported for terminal focus blocking) ──
let _isPanning = false;
export function getIsPanning(): boolean { return _isPanning; }

let zoomIndicatorTimer: number | undefined;
let zoomSnapTimer: number | undefined;
let zoomSnapRaf: number | undefined;
let lastZoomFocalX = 0;
let lastZoomFocalY = 0;
const RUBBER_BAND_K = 400;

function showZoomIndicator(el: HTMLElement): void {
  el.textContent = `${Math.round(camera.zoom * 100)}%`;
  el.classList.add('visible');
  clearTimeout(zoomIndicatorTimer);
  zoomIndicatorTimer = window.setTimeout(() => el.classList.remove('visible'), 1200);
}

function snapBackZoom(el: HTMLElement): void {
  const fx = lastZoomFocalX, fy = lastZoomFocalY;
  const target = camera.zoom > ZOOM_MAX ? ZOOM_MAX : ZOOM_MIN;
  function animate() {
    const nz = camera.zoom + (target - camera.zoom) * 0.15;
    camera.zoomToward(fx, fy, Math.abs(nz - target) < 0.001 ? target : nz);
    showZoomIndicator(el);
    drawGrid();
    positionAllTiles(getAllTiles());
    if (camera.zoom === target) { zoomSnapRaf = undefined; return; }
    zoomSnapRaf = requestAnimationFrame(animate);
  }
  zoomSnapRaf = requestAnimationFrame(animate);
}

function update(): void {
  drawGrid();
  positionAllTiles(getAllTiles());
}

// ── Shared: disable/enable all tile pointer events ──
function disableAllTilePointers(): void {
  getAllTileDoms().forEach(dom => { dom.contentArea.style.pointerEvents = 'none'; });
}
function enableAllTilePointers(): void {
  getAllTileDoms().forEach(dom => { dom.contentArea.style.pointerEvents = ''; });
}

// ── Pan logic (shared between middle-click and Ctrl+left-drag) ──
function startPan(container: HTMLElement): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  _isPanning = true;
  container.style.cursor = 'grabbing';
  disableAllTilePointers();

  let lastX = 0, lastY = 0, started = false;

  function onMove(ev: MouseEvent) {
    if (!started) { lastX = ev.clientX; lastY = ev.clientY; started = true; return; }
    camera.x -= (ev.clientX - lastX) / camera.zoom;
    camera.y -= (ev.clientY - lastY) / camera.zoom;
    lastX = ev.clientX;
    lastY = ev.clientY;
    update();
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    container.style.cursor = '';
    _isPanning = false;
    enableAllTilePointers();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

export function initInteractions(
  container: HTMLElement,
  tilesLayer: HTMLElement,
  zoomIndicator: HTMLElement,
  _marqueeEl: HTMLElement, // kept for API compat, not used
  callbacks: {
    onCreateTile: (canvasX: number, canvasY: number) => void;
    onTileResized: (id: string) => void;
  }
): void {

  // ── Ctrl+wheel zoom — capture phase so it fires BEFORE xterm catches wheel ──
  container.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); // prevent browser zoom, let xterm ignore Ctrl+wheel naturally

      if (zoomSnapRaf) { cancelAnimationFrame(zoomSnapRaf); zoomSnapRaf = undefined; }
      clearTimeout(zoomSnapTimer);

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let factor = Math.exp((-e.deltaY * 0.6) / 100);

      if (camera.zoom >= ZOOM_MAX && factor > 1) {
        factor = 1 + (factor - 1) / (1 + (camera.zoom / ZOOM_MAX - 1) * RUBBER_BAND_K);
      } else if (camera.zoom <= ZOOM_MIN && factor < 1) {
        factor = 1 - (1 - factor) / (1 + (ZOOM_MIN / camera.zoom - 1) * RUBBER_BAND_K);
      }

      camera.zoomToward(mx, my, camera.zoom * factor);
      lastZoomFocalX = mx; lastZoomFocalY = my;

      if (camera.zoom > ZOOM_MAX || camera.zoom < ZOOM_MIN) {
        zoomSnapTimer = window.setTimeout(() => snapBackZoom(zoomIndicator), 150);
      }
      showZoomIndicator(zoomIndicator);
      update();
    }
  }, { capture: true, passive: false }); // capture phase!

  // ── Normal scroll/pan — bubble phase (skip if over terminal) ──
  container.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) return; // handled by capture
    const t = e.target as HTMLElement;
    if (t.closest('.tile-content')) return; // let xterm scroll

    e.preventDefault();
    camera.panByScreen(-e.deltaX * 1.2, -e.deltaY * 1.2);
    update();
  }, { passive: false });

  // ── Middle-click pan ──
  container.addEventListener('mousedown', (e) => {
    if (e.button === 1) { e.preventDefault(); startPan(container); }
  });

  // ── Ctrl+left-drag pan (threshold 3px, Ctrl+click alone = nothing) ──
  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation(); // prevent any other mousedown handlers (deselect, etc.)

    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    disableAllTilePointers();

    const sx = e.clientX, sy = e.clientY;

    function onFirstMove(ev: MouseEvent) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3) {
        document.removeEventListener('mousemove', onFirstMove);
        document.removeEventListener('mouseup', onFirstUp);
        startPan(container);
      }
    }
    function onFirstUp() {
      document.removeEventListener('mousemove', onFirstMove);
      document.removeEventListener('mouseup', onFirstUp);
      enableAllTilePointers();
    }
    document.addEventListener('mousemove', onFirstMove);
    document.addEventListener('mouseup', onFirstUp);
  });

  // ── Double-click: new terminal ──
  container.addEventListener('dblclick', (e) => {
    const t = e.target as HTMLElement;
    if (t !== container && t.id !== 'grid-canvas' && t.id !== 'tiles-layer') return;
    const rect = container.getBoundingClientRect();
    const { wx, wy } = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    callbacks.onCreateTile(wx, wy);
  });

  // ── Click on empty canvas: deselect all + re-enable overlays (blur tiles) ──
  container.addEventListener('mousedown', (e) => {
    if (_isPanning) return;
    if (e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (t === container || t.id === 'grid-canvas' || t.id === 'tiles-layer') {
      if (!e.shiftKey) clearSelection();
      // Blur all tiles: re-enable content overlays
      getAllTileDoms().forEach(dom => {
        dom.contentOverlay.style.pointerEvents = '';
      });
      positionAllTiles(getAllTiles());
    }
  });

  // ── Context menu ──
  container.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (t === container || t.id === 'grid-canvas' || t.id === 'tiles-layer') {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const { wx, wy } = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      callbacks.onCreateTile(wx, wy);
    }
  });

  // ── Keyboard: Delete selected ──
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = document.activeElement;
      if (active && active.closest('.tile-content')) return;
      for (const tile of getSelectedTiles()) {
        container.dispatchEvent(new CustomEvent('tile-delete', { detail: { id: tile.id } }));
      }
    }
  });

  // ── Resize observer ──
  const ro = new ResizeObserver(() => { resizeCanvas(); update(); });
  ro.observe(container);
}

export function attachTileDrag(tile: Tile, titleBar: HTMLElement, onUpdate: () => void): void {
  titleBar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bringToFront(tile);

    const sx = e.clientX, sy = e.clientY;
    const group = isSelected(tile.id) ? getSelectedTiles() : [tile];
    const starts = group.map(t => ({ tile: t, x: t.x, y: t.y }));
    let moved = false;

    disableAllTilePointers();

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - sx) / camera.zoom;
      const dy = (ev.clientY - sy) / camera.zoom;
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) >= 3) moved = true;
      for (const s of starts) { s.tile.x = s.x + dx; s.tile.y = s.y + dy; }
      onUpdate();
    }

    function onUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      enableAllTilePointers();
      if (moved) {
        for (const s of starts) snapToGrid(s.tile);
        onUpdate();
      } else {
        if (ev.shiftKey) toggleSelection(tile.id);
        else { clearSelection(); selectTile(tile.id); }
        positionAllTiles(getAllTiles());
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export function attachTileResize(tile: Tile, handles: HTMLElement[], onUpdate: () => void, onResized: (id: string) => void): void {
  for (const handle of handles) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const dir = handle.dataset.direction!;
      const sx = e.clientX, sy = e.clientY;
      const ox = tile.x, oy = tile.y, ow = tile.width, oh = tile.height;

      disableAllTilePointers();

      function onMove(ev: MouseEvent) {
        const dx = (ev.clientX - sx) / camera.zoom;
        const dy = (ev.clientY - sy) / camera.zoom;
        if (dir.includes('e')) tile.width = Math.max(MIN_TILE_WIDTH, ow + dx);
        if (dir.includes('w')) { const nw = Math.max(MIN_TILE_WIDTH, ow - dx); tile.x = ox + (ow - nw); tile.width = nw; }
        if (dir.includes('s')) tile.height = Math.max(MIN_TILE_HEIGHT, oh + dy);
        if (dir.includes('n')) { const nh = Math.max(MIN_TILE_HEIGHT, oh - dy); tile.y = oy + (oh - nh); tile.height = nh; }
        onUpdate();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        enableAllTilePointers();
        snapToGrid(tile);
        onUpdate();
        onResized(tile.id);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
