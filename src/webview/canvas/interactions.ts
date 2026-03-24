// Canvas interactions: pan, zoom, tile drag, tile resize, selection

import {
  Tile, camera, viewport, ZOOM_MIN, ZOOM_MAX, GRID_CELL,
  getAllTiles, bringToFront, snapToGrid,
  selectTile, deselectTile, clearSelection, toggleSelection,
  isSelected, getSelectedTiles, MIN_TILE_WIDTH, MIN_TILE_HEIGHT,
} from './state';
import { positionTile, positionAllTiles, getAllTileDoms, getTileDom } from './renderer';
import { drawGrid, resizeCanvas } from './grid';

// Exported so terminal-tile can check if panning
let _isPanning = false;
export function getIsPanning(): boolean { return _isPanning; }

let zoomIndicatorTimer: number | undefined;
let zoomSnapTimer: number | undefined;
let zoomSnapRaf: number | undefined;
let lastZoomFocalX = 0;
let lastZoomFocalY = 0;

const RUBBER_BAND_K = 400;

function showZoomIndicator(zoomIndicator: HTMLElement): void {
  const pct = Math.round(camera.zoom * 100);
  zoomIndicator.textContent = `${pct}%`;
  zoomIndicator.classList.add('visible');
  clearTimeout(zoomIndicatorTimer);
  zoomIndicatorTimer = window.setTimeout(() => {
    zoomIndicator.classList.remove('visible');
  }, 1200);
}

function snapBackZoom(zoomIndicator: HTMLElement): void {
  const fx = lastZoomFocalX;
  const fy = lastZoomFocalY;
  const target = camera.zoom > ZOOM_MAX ? ZOOM_MAX : ZOOM_MIN;

  function animate() {
    const prevZoom = camera.zoom;
    const newZoom = prevZoom + (target - prevZoom) * 0.15;

    if (Math.abs(newZoom - target) < 0.001) {
      camera.zoomToward(fx, fy, target);
    } else {
      camera.zoomToward(fx, fy, newZoom);
    }

    showZoomIndicator(zoomIndicator);
    drawGrid();
    positionAllTiles(getAllTiles());

    if (camera.zoom === target) { zoomSnapRaf = undefined; return; }
    zoomSnapRaf = requestAnimationFrame(animate);
  }

  zoomSnapRaf = requestAnimationFrame(animate);
}

function updateCanvas(): void {
  drawGrid();
  positionAllTiles(getAllTiles());
}

export function initInteractions(
  container: HTMLElement,
  tilesLayer: HTMLElement,
  zoomIndicator: HTMLElement,
  marqueeEl: HTMLElement,
  callbacks: {
    onCreateTile: (canvasX: number, canvasY: number) => void;
    onTileResized: (id: string) => void;
  }
): void {
  // ── Pan/Zoom: scroll wheel ──
  container.addEventListener('wheel', (e) => {
    const target = e.target as HTMLElement;
    const overTerminal = target.closest('.tile-content');

    // Normal scroll over terminal → let xterm handle it, skip canvas pan
    if (overTerminal && !(e.ctrlKey || e.metaKey)) return;

    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Zoom — smooth exponential with rubber-band
      if (zoomSnapRaf) { cancelAnimationFrame(zoomSnapRaf); zoomSnapRaf = undefined; }
      clearTimeout(zoomSnapTimer);

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let factor = Math.exp((-e.deltaY * 0.6) / 100);

      // Rubber-band at limits
      if (camera.zoom >= ZOOM_MAX && factor > 1) {
        const overshoot = camera.zoom / ZOOM_MAX - 1;
        const damping = 1 / (1 + overshoot * RUBBER_BAND_K);
        factor = 1 + (factor - 1) * damping;
      } else if (camera.zoom <= ZOOM_MIN && factor < 1) {
        const overshoot = ZOOM_MIN / camera.zoom - 1;
        const damping = 1 / (1 + overshoot * RUBBER_BAND_K);
        factor = 1 - (1 - factor) * damping;
      }

      camera.zoomToward(mx, my, camera.zoom * factor);
      lastZoomFocalX = mx;
      lastZoomFocalY = my;

      if (camera.zoom > ZOOM_MAX || camera.zoom < ZOOM_MIN) {
        zoomSnapTimer = window.setTimeout(() => snapBackZoom(zoomIndicator), 150);
      }

      showZoomIndicator(zoomIndicator);
    } else {
      // Pan
      camera.panByScreen(-e.deltaX, -e.deltaY);
    }

    updateCanvas();
  }, { passive: false });

  // ── Pan: middle-click drag OR Ctrl+left-drag ──

  function startPan(e: MouseEvent) {
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    _isPanning = true;
    let lastX = e.clientX;
    let lastY = e.clientY;

    container.style.cursor = 'grabbing';

    // Block ALL pointer events on tile contents during pan
    const allDoms = getAllTileDoms();
    allDoms.forEach(dom => {
      dom.contentArea.style.pointerEvents = 'none';
    });

    function onMove(ev: MouseEvent) {
      camera.x -= (ev.clientX - lastX) / camera.zoom;
      camera.y -= (ev.clientY - lastY) / camera.zoom;
      lastX = ev.clientX;
      lastY = ev.clientY;
      updateCanvas();
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      container.style.cursor = '';
      _isPanning = false;
      allDoms.forEach(dom => {
        dom.contentArea.style.pointerEvents = '';
      });
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Middle-click pan
  container.addEventListener('mousedown', (e) => {
    if (e.button === 1) startPan(e);
  });

  // Ctrl+left-drag pan (only starts on drag, not click)
  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    function onFirstMove(ev: MouseEvent) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 3) {
        // Threshold reached — enter pan mode
        document.removeEventListener('mousemove', onFirstMove);
        document.removeEventListener('mouseup', onFirstUp);
        dragging = true;
        startPan(ev);
      }
    }

    function onFirstUp() {
      // Released without dragging — do nothing (Ctrl+click = no action)
      document.removeEventListener('mousemove', onFirstMove);
      document.removeEventListener('mouseup', onFirstUp);
    }

    document.addEventListener('mousemove', onFirstMove);
    document.addEventListener('mouseup', onFirstUp);
  });

  // ── Double-click: new terminal ──
  container.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    if (target !== container && target.id !== 'grid-canvas' && target.id !== 'tiles-layer') return;

    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { wx, wy } = camera.screenToWorld(sx, sy);
    callbacks.onCreateTile(wx, wy);
  });

  // ── Click on empty canvas: deselect all ──
  container.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;
    if (target === container || target.id === 'grid-canvas' || target.id === 'tiles-layer') {
      if (!e.shiftKey) clearSelection();
      positionAllTiles(getAllTiles());
    }
  });

  // ── Context menu ──
  container.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    if (target === container || target.id === 'grid-canvas' || target.id === 'tiles-layer') {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const { wx, wy } = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      callbacks.onCreateTile(wx, wy);
    }
  });

  // ── Keyboard shortcuts ──
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = document.activeElement;
      if (active && active.closest('.tile-content')) return;

      const selected = getSelectedTiles();
      if (selected.length > 0) {
        for (const tile of selected) {
          container.dispatchEvent(new CustomEvent('tile-delete', { detail: { id: tile.id } }));
        }
      }
    }
  });

  // ── Resize observer ──
  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    updateCanvas();
  });
  resizeObserver.observe(container);

  // ── Marquee selection ──
  initMarquee(container, tilesLayer, marqueeEl, () => _isPanning);
}

export function attachTileDrag(
  tile: Tile,
  titleBar: HTMLElement,
  onUpdate: () => void
): void {
  const CLICK_THRESHOLD = 3;

  titleBar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();

    bringToFront(tile);

    const startMX = e.clientX;
    const startMY = e.clientY;

    const isInSelection = isSelected(tile.id);
    const groupTiles = isInSelection ? getSelectedTiles() : [tile];
    const startPositions = groupTiles.map(t => ({ tile: t, x: t.x, y: t.y }));

    let moved = false;

    const allDoms = getAllTileDoms();
    allDoms.forEach(dom => {
      dom.contentArea.style.pointerEvents = 'none';
    });

    function onMove(ev: MouseEvent) {
      // Convert screen delta to world delta
      const dx = (ev.clientX - startMX) / camera.zoom;
      const dy = (ev.clientY - startMY) / camera.zoom;
      if (Math.hypot(ev.clientX - startMX, ev.clientY - startMY) >= CLICK_THRESHOLD) moved = true;

      for (const sp of startPositions) {
        sp.tile.x = sp.x + dx;
        sp.tile.y = sp.y + dy;
      }
      onUpdate();
    }

    function onUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      allDoms.forEach(dom => {
        dom.contentArea.style.pointerEvents = '';
      });

      if (moved) {
        for (const sp of startPositions) {
          snapToGrid(sp.tile);
        }
        onUpdate();
      } else {
        if (ev.shiftKey) {
          toggleSelection(tile.id);
        } else {
          clearSelection();
          selectTile(tile.id);
        }
        positionAllTiles(getAllTiles());
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export function attachTileResize(
  tile: Tile,
  handles: HTMLElement[],
  onUpdate: () => void,
  onResized: (id: string) => void
): void {
  for (const handle of handles) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const dir = handle.dataset.direction!;
      const startMX = e.clientX;
      const startMY = e.clientY;
      const startX = tile.x;
      const startY = tile.y;
      const startW = tile.width;
      const startH = tile.height;

      const allDoms = getAllTileDoms();
      allDoms.forEach(dom => {
        dom.contentArea.style.pointerEvents = 'none';
      });

      function onMove(ev: MouseEvent) {
        // Screen delta → world delta (tile size is in world coords)
        const dx = (ev.clientX - startMX) / camera.zoom;
        const dy = (ev.clientY - startMY) / camera.zoom;

        if (dir.includes('e')) tile.width = Math.max(MIN_TILE_WIDTH, startW + dx);
        if (dir.includes('w')) {
          const newW = Math.max(MIN_TILE_WIDTH, startW - dx);
          tile.x = startX + (startW - newW);
          tile.width = newW;
        }
        if (dir.includes('s')) tile.height = Math.max(MIN_TILE_HEIGHT, startH + dy);
        if (dir.includes('n')) {
          const newH = Math.max(MIN_TILE_HEIGHT, startH - dy);
          tile.y = startY + (startH - newH);
          tile.height = newH;
        }

        onUpdate();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);

        allDoms.forEach(dom => {
          dom.contentArea.style.pointerEvents = '';
        });

        snapToGrid(tile);
        onUpdate();
        onResized(tile.id);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

function initMarquee(
  container: HTMLElement,
  tilesLayer: HTMLElement,
  marqueeEl: HTMLElement,
  isPanningFn: () => boolean
): void {
  let active = false;
  let startX = 0;
  let startY = 0;

  container.addEventListener('mousedown', (e) => {
    if (isPanningFn()) return; // skip marquee during pan
    const target = e.target as HTMLElement;
    if (target !== container && target.id !== 'grid-canvas' && target.id !== 'tiles-layer') return;
    if (e.button !== 0) return;

    active = true;
    startX = e.clientX;
    startY = e.clientY;
    marqueeEl.classList.remove('hidden');
    marqueeEl.style.left = `${startX}px`;
    marqueeEl.style.top = `${startY}px`;
    marqueeEl.style.width = '0px';
    marqueeEl.style.height = '0px';
  });

  document.addEventListener('mousemove', (e) => {
    if (!active) return;

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    marqueeEl.style.left = `${x}px`;
    marqueeEl.style.top = `${y}px`;
    marqueeEl.style.width = `${w}px`;
    marqueeEl.style.height = `${h}px`;

    // Convert marquee screen rect to world coords
    const rect = container.getBoundingClientRect();
    const topLeft = camera.screenToWorld(x - rect.left, y - rect.top);
    const botRight = camera.screenToWorld(x - rect.left + w, y - rect.top + h);

    clearSelection();
    for (const tile of getAllTiles()) {
      const tRight = tile.x + tile.width;
      const tBottom = tile.y + tile.height;
      if (tile.x < botRight.wx && tRight > topLeft.wx && tile.y < botRight.wy && tBottom > topLeft.wy) {
        selectTile(tile.id);
      }
    }
    positionAllTiles(getAllTiles());
  });

  document.addEventListener('mouseup', () => {
    if (!active) return;
    active = false;
    marqueeEl.classList.add('hidden');
  });
}
