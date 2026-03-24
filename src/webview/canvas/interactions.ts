// Canvas interactions: pan, zoom, tile drag, tile resize, selection

import {
  Tile, viewport, ZOOM_MIN, ZOOM_MAX, GRID_CELL,
  getAllTiles, bringToFront, snapToGrid,
  selectTile, deselectTile, clearSelection, toggleSelection,
  isSelected, getSelectedTiles, MIN_TILE_WIDTH, MIN_TILE_HEIGHT,
} from './state';
import { positionTile, positionAllTiles, getAllTileDoms, getTileDom } from './renderer';
import { drawGrid, resizeCanvas } from './grid';

let zoomIndicatorTimer: number | undefined;
let zoomSnapTimer: number | undefined;
let zoomSnapRaf: number | undefined;
let lastZoomFocalX = 0;
let lastZoomFocalY = 0;

const RUBBER_BAND_K = 400;

function showZoomIndicator(zoomIndicator: HTMLElement): void {
  const pct = Math.round(viewport.zoom * 100);
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
  const target = viewport.zoom > ZOOM_MAX ? ZOOM_MAX : ZOOM_MIN;

  function animate() {
    const prevScale = viewport.zoom;
    viewport.zoom += (target - viewport.zoom) * 0.15;

    if (Math.abs(viewport.zoom - target) < 0.001) {
      viewport.zoom = target;
    }

    const ratio = viewport.zoom / prevScale - 1;
    viewport.panX -= (fx - viewport.panX) * ratio;
    viewport.panY -= (fy - viewport.panY) * ratio;
    showZoomIndicator(zoomIndicator);
    drawGrid();
    positionAllTiles(getAllTiles());

    if (viewport.zoom === target) { zoomSnapRaf = undefined; return; }
    zoomSnapRaf = requestAnimationFrame(animate);
  }

  zoomSnapRaf = requestAnimationFrame(animate);
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
      // Zoom — smooth exponential (Collaborator-style)
      if (zoomSnapRaf) { cancelAnimationFrame(zoomSnapRaf); zoomSnapRaf = undefined; }
      clearTimeout(zoomSnapTimer);

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const prevScale = viewport.zoom;
      let factor = Math.exp((-e.deltaY * 0.6) / 100);

      // Rubber-band at limits
      if (viewport.zoom >= ZOOM_MAX && factor > 1) {
        const overshoot = viewport.zoom / ZOOM_MAX - 1;
        const damping = 1 / (1 + overshoot * RUBBER_BAND_K);
        factor = 1 + (factor - 1) * damping;
      } else if (viewport.zoom <= ZOOM_MIN && factor < 1) {
        const overshoot = ZOOM_MIN / viewport.zoom - 1;
        const damping = 1 / (1 + overshoot * RUBBER_BAND_K);
        factor = 1 - (1 - factor) * damping;
      }

      viewport.zoom *= factor;

      // Focal point pan correction
      const ratio = viewport.zoom / prevScale - 1;
      viewport.panX -= (mx - viewport.panX) * ratio;
      viewport.panY -= (my - viewport.panY) * ratio;
      lastZoomFocalX = mx;
      lastZoomFocalY = my;

      // Snap back if overshot
      if (viewport.zoom > ZOOM_MAX || viewport.zoom < ZOOM_MIN) {
        zoomSnapTimer = window.setTimeout(() => snapBackZoom(zoomIndicator), 150);
      }

      showZoomIndicator(zoomIndicator);
    } else {
      // Pan
      viewport.panX -= e.deltaX;
      viewport.panY -= e.deltaY;
    }

    drawGrid();
    positionAllTiles(getAllTiles());
  }, { passive: false });

  // ── Middle-click drag to pan ──
  container.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return; // middle-click only
    e.preventDefault();

    const startMX = e.clientX;
    const startMY = e.clientY;
    const startPanX = viewport.panX;
    const startPanY = viewport.panY;

    container.style.cursor = 'grabbing';

    // Disable pointer events on tile contents during pan
    const allDoms = getAllTileDoms();
    allDoms.forEach(dom => {
      dom.contentArea.style.pointerEvents = 'none';
    });

    function onMove(ev: MouseEvent) {
      viewport.panX = startPanX + (ev.clientX - startMX);
      viewport.panY = startPanY + (ev.clientY - startMY);
      drawGrid();
      positionAllTiles(getAllTiles());
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      container.style.cursor = '';
      allDoms.forEach(dom => {
        dom.contentArea.style.pointerEvents = '';
      });
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ── Double-click: new terminal ──
  let lastClickTime = 0;
  container.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    // Only on empty canvas area
    if (target !== container && target.id !== 'grid-canvas' && target.id !== 'tiles-layer') return;

    const rect = container.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom;
    const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom;
    callbacks.onCreateTile(canvasX, canvasY);
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
      const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom;
      const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom;
      callbacks.onCreateTile(canvasX, canvasY);
    }
  });

  // ── Keyboard shortcuts ──
  container.addEventListener('keydown', (e) => {
    // Only handle if canvas or tiles-layer is focused
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't delete if a terminal is focused
      const active = document.activeElement;
      if (active && active.closest('.tile-content')) return;

      const selected = getSelectedTiles();
      if (selected.length > 0) {
        // Dispatch custom event for deletion
        for (const tile of selected) {
          container.dispatchEvent(new CustomEvent('tile-delete', { detail: { id: tile.id } }));
        }
      }
    }
  });

  // ── Resize observer ──
  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    drawGrid();
    positionAllTiles(getAllTiles());
  });
  resizeObserver.observe(container);

  // ── Marquee selection ──
  initMarquee(container, tilesLayer, marqueeEl);
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
    const startTX = tile.x;
    const startTY = tile.y;

    // Group drag context
    const isInSelection = isSelected(tile.id);
    const groupTiles = isInSelection ? getSelectedTiles() : [tile];
    const startPositions = groupTiles.map(t => ({ tile: t, x: t.x, y: t.y }));

    let moved = false;

    // Disable pointer events on all tile contents during drag
    const allDoms = getAllTileDoms();
    allDoms.forEach(dom => {
      dom.contentArea.style.pointerEvents = 'none';
    });

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startMX) / viewport.zoom;
      const dy = (ev.clientY - startMY) / viewport.zoom;
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

      // Re-enable pointer events
      allDoms.forEach(dom => {
        dom.contentArea.style.pointerEvents = '';
      });

      if (moved) {
        for (const sp of startPositions) {
          snapToGrid(sp.tile);
        }
        onUpdate();
      } else {
        // Click - select/toggle
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

      // Disable pointer events
      const allDoms = getAllTileDoms();
      allDoms.forEach(dom => {
        dom.contentArea.style.pointerEvents = 'none';
      });

      function onMove(ev: MouseEvent) {
        const dx = (ev.clientX - startMX) / viewport.zoom;
        const dy = (ev.clientY - startMY) / viewport.zoom;

        if (dir.includes('e')) {
          tile.width = Math.max(MIN_TILE_WIDTH, startW + dx);
        }
        if (dir.includes('w')) {
          const newW = Math.max(MIN_TILE_WIDTH, startW - dx);
          tile.x = startX + (startW - newW);
          tile.width = newW;
        }
        if (dir.includes('s')) {
          tile.height = Math.max(MIN_TILE_HEIGHT, startH + dy);
        }
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
  marqueeEl: HTMLElement
): void {
  let active = false;
  let startX = 0;
  let startY = 0;

  container.addEventListener('mousedown', (e) => {
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

    // Select tiles that intersect marquee
    const rect = container.getBoundingClientRect();
    const marqLeft = (Math.min(e.clientX, startX) - rect.left - viewport.panX) / viewport.zoom;
    const marqTop = (Math.min(e.clientY, startY) - rect.top - viewport.panY) / viewport.zoom;
    const marqRight = marqLeft + w / viewport.zoom;
    const marqBottom = marqTop + h / viewport.zoom;

    clearSelection();
    for (const tile of getAllTiles()) {
      const tRight = tile.x + tile.width;
      const tBottom = tile.y + tile.height;
      if (tile.x < marqRight && tRight > marqLeft && tile.y < marqBottom && tBottom > marqTop) {
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
