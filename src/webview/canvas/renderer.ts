// Tile DOM creation and positioning

import { Tile, viewport, bringToFront, isSelected } from './state';

export interface TileDom {
  container: HTMLElement;
  titleBar: HTMLElement;
  titleText: HTMLElement;
  contentArea: HTMLElement;
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

  // Focus on click
  container.addEventListener('mousedown', () => {
    callbacks.onFocus(tile.id);
  });

  tilesLayer.appendChild(container);

  const dom: TileDom = { container, titleBar, titleText, contentArea, closeBtn, resizeHandles };
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
  const sx = tile.x * viewport.zoom + viewport.panX;
  const sy = tile.y * viewport.zoom + viewport.panY;

  // Tile size: never shrink below original size (zoom < 1), only grow when zoom > 1
  const sizeZoom = Math.max(1.0, viewport.zoom);

  dom.container.style.left = `${sx}px`;
  dom.container.style.top = `${sy}px`;
  dom.container.style.width = `${tile.width * sizeZoom}px`;
  dom.container.style.height = `${tile.height * sizeZoom}px`;
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
