// Dot grid background — crosshair style at major, dots at minor

import { camera, GRID_CELL } from './state';

const MAJOR = 80;
const CROSS_R = 3; // cross arm radius in px

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

  const style = getComputedStyle(document.documentElement);
  const bg = style.getPropertyValue('--vscode-editor-background').trim();
  const isDark = isColorDark(bg);

  const step = GRID_CELL * camera.zoom;
  const majorStep = MAJOR * camera.zoom;

  const camOffX = -camera.x * camera.zoom;
  const camOffY = -camera.y * camera.zoom;

  // Minor dots — small subtle dots
  const dotOffX = ((camOffX % step) + step) % step;
  const dotOffY = ((camOffY % step) + step) % step;
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';

  for (let x = dotOffX; x <= w; x += step) {
    for (let y = dotOffY; y <= h; y += step) {
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }

  // Major intersections — small crosshairs (+)
  const majorOffX = ((camOffX % majorStep) + majorStep) % majorStep;
  const majorOffY = ((camOffY % majorStep) + majorStep) % majorStep;
  const cr = Math.max(2, CROSS_R * camera.zoom);
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  for (let x = majorOffX; x <= w; x += majorStep) {
    for (let y = majorOffY; y <= h; y += majorStep) {
      const px = Math.round(x) + 0.5;
      const py = Math.round(y) + 0.5;
      // Horizontal arm
      ctx.moveTo(px - cr, py);
      ctx.lineTo(px + cr, py);
      // Vertical arm
      ctx.moveTo(px, py - cr);
      ctx.lineTo(px, py + cr);
    }
  }
  ctx.stroke();
}

function isColorDark(color: string): boolean {
  let r = 0, g = 0, b = 0;
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    r = parseInt(rgbMatch[1]);
    g = parseInt(rgbMatch[2]);
    b = parseInt(rgbMatch[3]);
  } else if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}
