// Canvas tile data model

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
export const DEFAULT_TILE_WIDTH = 680;
export const DEFAULT_TILE_HEIGHT = 480;
export const MIN_TILE_WIDTH = 240;
export const MIN_TILE_HEIGHT = 160;

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

// Selection state
const selectedIds = new Set<string>();

export function selectTile(id: string): void {
  selectedIds.add(id);
}

export function deselectTile(id: string): void {
  selectedIds.delete(id);
}

export function toggleSelection(id: string): void {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
}

export function clearSelection(): void {
  selectedIds.clear();
}

export function isSelected(id: string): boolean {
  return selectedIds.has(id);
}

export function getSelectedTiles(): Tile[] {
  return tiles.filter((t) => selectedIds.has(t.id));
}

// Viewport state
export const viewport = {
  panX: 0,
  panY: 0,
  zoom: 1,
};

export const ZOOM_MIN = 0.33;
export const ZOOM_MAX = 1.5;
