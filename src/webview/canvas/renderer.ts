// Tile DOM creation and positioning

import { Tile, camera, bringToFront, isSelected } from './state';

export interface TileDom {
  container: HTMLElement;
  titleBar: HTMLElement;
  titleText: HTMLElement;
  contentArea: HTMLElement;
  contentOverlay: HTMLElement;
  closeBtn: HTMLElement;
  resizeHandles: HTMLElement[];
}

const tileDoms = new Map<string, TileDom>();

export function getTileDom(id: string): TileDom | undefined {
  return tileDoms.get(id);
}

export function getAllTileDoms(): Map<string, TileDom> {
  return tileDoms;
}

export function createTileDOM(
  tile: Tile,
  tilesLayer: HTMLElement,
  callbacks: {
    onClose: (id: string) => void;
    onFocus: (id: string) => void;
    onTerminalClick?: (id: string) => void;
  }
): TileDom {
  const container = document.createElement('div');
  container.className = 'canvas-tile';
  container.dataset.tileId = tile.id;

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'tile-title-bar';

  const titleText = document.createElement('span');
  titleText.className = 'tile-title-text';
  titleText.textContent = 'Terminal';
  titleBar.appendChild(titleText);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'tile-btn-group';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tile-close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Close terminal';
  closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onClose(tile.id);
  });
  btnGroup.appendChild(closeBtn);
  titleBar.appendChild(btnGroup);

  // Content area for xterm.js
  const contentArea = document.createElement('div');
  contentArea.className = 'tile-content';

  // Content overlay — blocks mouse events to xterm until tile is focused.
  // Wheel events pass through overlay → bubble to canvas → Ctrl+wheel zoom works.
  // On focus: overlay pointerEvents=none → xterm receives input.
  const contentOverlay = document.createElement('div');
  contentOverlay.className = 'tile-content-overlay';
  contentArea.appendChild(contentOverlay);

  // Resize handles (8 directions)
  const resizeHandles: HTMLElement[] = [];
  const directions = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  for (const dir of directions) {
    const handle = document.createElement('div');
    handle.className = `tile-resize-handle tile-resize-${dir}`;
    handle.dataset.direction = dir;
    container.appendChild(handle);
    resizeHandles.push(handle);
  }

  container.appendChild(titleBar);
  container.appendChild(contentArea);

  // Click on tile → select (blue border + panel active)
  container.addEventListener('mousedown', () => {
    callbacks.onFocus(tile.id);
  });

  // Click on content area → also focus terminal for typing
  contentOverlay.addEventListener('mousedown', () => {
    contentOverlay.style.pointerEvents = 'none';
    callbacks.onTerminalClick?.(tile.id);
  });

  tilesLayer.appendChild(container);

  const dom: TileDom = { container, titleBar, titleText, contentArea, contentOverlay, closeBtn, resizeHandles };
  tileDoms.set(tile.id, dom);
  positionTile(dom, tile);
  return dom;
}

export function removeTileDOM(id: string): void {
  const dom = tileDoms.get(id);
  if (dom) {
    dom.container.remove();
    tileDoms.delete(id);
  }
}

export function positionTile(dom: TileDom, tile: Tile): void {
  const { sx, sy } = camera.worldToScreen(tile.x, tile.y);
  dom.container.style.left = `${sx}px`;
  dom.container.style.top = `${sy}px`;

  // Only update dimensions when zoom or tile size changes — NOT during pan
  const sizeKey = `${tile.width}:${tile.height}:${camera.zoom}`;
  if ((dom as any)._sizeKey !== sizeKey) {
    (dom as any)._sizeKey = sizeKey;
    dom.container.style.width = `${tile.width * camera.zoom}px`;
    dom.container.style.height = `${tile.height * camera.zoom}px`;
  }

  dom.container.style.zIndex = String(tile.zIndex);

  // Selection highlight
  if (isSelected(tile.id)) {
    dom.container.classList.add('tile-selected');
  } else {
    dom.container.classList.remove('tile-selected');
  }
}

export function positionAllTiles(tiles: Tile[]): void {
  for (const tile of tiles) {
    const dom = tileDoms.get(tile.id);
    if (dom) positionTile(dom, tile);
  }
}
