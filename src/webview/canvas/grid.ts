// Dot grid background rendered with Canvas 2D API

import { viewport, GRID_CELL } from './state';

const MAJOR = 80;

let canvasEl: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let containerEl: HTMLElement;

export function initGrid(container: HTMLElement, canvas: HTMLCanvasElement): void {
  containerEl = container;
  canvasEl = canvas;
  ctx = canvas.getContext('2d')!;
  resizeCanvas();
}

export function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  canvasEl.width = w * dpr;
  canvasEl.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function drawGrid(): void {
  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  if (w === 0 || h === 0) return;

  ctx.clearRect(0, 0, w, h);

  // Determine dot colors from current theme
  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue('--vscode-editor-background').trim();
  const isDark = isColorDark(bg);

  const step = GRID_CELL * viewport.zoom;
  const majorStep = MAJOR * viewport.zoom;

  // Minor dots
  const dotOffX = ((viewport.panX % step) + step) % step;
  const dotOffY = ((viewport.panY % step) + step) % step;
  const dotSize = Math.max(1.5, 2 * viewport.zoom);
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)';

  for (let x = dotOffX; x <= w; x += step) {
    for (let y = dotOffY; y <= h; y += step) {
      ctx.fillRect(Math.round(x), Math.round(y), dotSize, dotSize);
    }
  }

  // Major dots (brighter)
  const majorOffX = ((viewport.panX % majorStep) + majorStep) % majorStep;
  const majorOffY = ((viewport.panY % majorStep) + majorStep) % majorStep;
  const majorDotSize = Math.max(2, 2.5 * viewport.zoom);
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.40)';

  for (let x = majorOffX; x <= w; x += majorStep) {
    for (let y = majorOffY; y <= h; y += majorStep) {
      ctx.fillRect(Math.round(x), Math.round(y), majorDotSize, majorDotSize);
    }
  }
}

function isColorDark(color: string): boolean {
  // Parse rgb/rgba or hex
  let r = 0, g = 0, b = 0;

  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    r = parseInt(rgbMatch[1]);
    g = parseInt(rgbMatch[2]);
    b = parseInt(rgbMatch[3]);
  } else if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  }

  // Luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}
