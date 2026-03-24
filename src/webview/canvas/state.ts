// Canvas tile data model + Camera system

export interface Tile {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  ptySessionId: string;
}

export const GRID_CELL = 20;
export const DEFAULT_TILE_WIDTH = 800;
export const DEFAULT_TILE_HEIGHT = 700;
export const MIN_TILE_WIDTH = 240;
export const MIN_TILE_HEIGHT = 160;

export const ZOOM_MIN = 0.33;
export const ZOOM_MAX = 1.5;

// ── Camera ──
// Manages the viewport into the infinite canvas world.
// Zoom changes how the world is projected to screen, NOT tile sizes.
export const camera = {
  // World coordinates of the viewport origin (top-left visible point)
  x: 0,
  y: 0,
  // Zoom level
  zoom: 1,

  /** Convert world coords → screen pixels */
  worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    return {
      sx: (wx - this.x) * this.zoom,
      sy: (wy - this.y) * this.zoom,
    };
  },

  /** Convert screen pixels → world coords */
  screenToWorld(sx: number, sy: number): { wx: number; wy: number } {
    return {
      wx: sx / this.zoom + this.x,
      wy: sy / this.zoom + this.y,
    };
  },

  /** Zoom toward a focal point (screen coords) */
  zoomToward(focalSX: number, focalSY: number, newZoom: number): void {
    // World point under the focal screen pixel before zoom
    const worldBefore = this.screenToWorld(focalSX, focalSY);
    this.zoom = newZoom;
    // After zoom change, adjust camera so the same world point stays under the focal pixel
    this.x = worldBefore.wx - focalSX / this.zoom;
    this.y = worldBefore.wy - focalSY / this.zoom;
  },

  /** Pan by screen-space delta */
  panByScreen(dsx: number, dsy: number): void {
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
  },
};

// ── Backward compat: viewport getter mapped to camera ──
// Some code still reads viewport.panX/panY/zoom
export const viewport = {
  get panX() { return -camera.x * camera.zoom; },
  set panX(v: number) { camera.x = -v / camera.zoom; },
  get panY() { return -camera.y * camera.zoom; },
  set panY(v: number) { camera.y = -v / camera.zoom; },
  get zoom() { return camera.zoom; },
  set zoom(v: number) { camera.zoom = v; },
};

// ── Tiles ──
const tiles: Tile[] = [];
let nextZIndex = 1;
let idCounter = 0;

export function getAllTiles(): Tile[] {
  return tiles;
}

export function generateId(): string {
  idCounter++;
  return `tile-${Date.now()}-${idCounter}`;
}

export function addTile(tile: Tile): Tile {
  if (!tile.zIndex) {
    nextZIndex++;
    tile.zIndex = nextZIndex;
  }
  tiles.push(tile);
  return tile;
}

export function removeTile(id: string): void {
  const idx = tiles.findIndex((t) => t.id === id);
  if (idx !== -1) tiles.splice(idx, 1);
}

export function getTile(id: string): Tile | null {
  return tiles.find((t) => t.id === id) || null;
}

export function bringToFront(tile: Tile): void {
  nextZIndex++;
  tile.zIndex = nextZIndex;
}

export function snapToGrid(tile: Tile): void {
  tile.x = Math.round(tile.x / GRID_CELL) * GRID_CELL;
  tile.y = Math.round(tile.y / GRID_CELL) * GRID_CELL;
  tile.width = Math.round(tile.width / GRID_CELL) * GRID_CELL;
  tile.height = Math.round(tile.height / GRID_CELL) * GRID_CELL;
}

// ── Selection ──
const selectedIds = new Set<string>();

export function selectTile(id: string): void { selectedIds.add(id); }
export function deselectTile(id: string): void { selectedIds.delete(id); }
export function toggleSelection(id: string): void {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
}
export function clearSelection(): void { selectedIds.clear(); }
export function isSelected(id: string): boolean { return selectedIds.has(id); }
export function getSelectedTiles(): Tile[] {
  return tiles.filter((t) => selectedIds.has(t.id));
}
