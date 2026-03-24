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
  // ── Pan: scroll wheel (skip if cursor is over a terminal tile-content) ──
  container.addEventListener('wheel', (e) => {
    // Focus guard: if scrolling over a terminal content area, let xterm handle it
    const target = e.target as HTMLElement;
    if (target.closest('.tile-content')) return;

    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Zoom — faster factors (12% per tick)
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const zoomFactor = e.deltaY > 0 ? 0.88 : 1.12;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, viewport.zoom * zoomFactor));

      // Focal point zoom
      const canvasXBefore = (mx - viewport.panX) / viewport.zoom;
      const canvasYBefore = (my - viewport.panY) / viewport.zoom;
      viewport.zoom = newZoom;
      viewport.panX = mx - canvasXBefore * viewport.zoom;
      viewport.panY = my - canvasYBefore * viewport.zoom;

      // Show zoom indicator
      const pct = Math.round(viewport.zoom * 100);
      zoomIndicator.textContent = `${pct}%`;
      zoomIndicator.classList.add('visible');
      clearTimeout(zoomIndicatorTimer);
      zoomIndicatorTimer = window.setTimeout(() => {
        zoomIndicator.classList.remove('visible');
      }, 1200);
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
