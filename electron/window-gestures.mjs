const kinds = new Set(['move', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
const clamp = (value, lower, upper) => Math.min(Math.max(value, lower), upper);

// Electron's screen coordinates and BrowserWindow bounds are both DIP values.
// Keep them in that space: multiplying by a monitor's scaleFactor causes jumps.
export function gestureBounds(kind, start, delta, minimum, area) {
  if (!kinds.has(kind)) throw new Error('窗口手势无效');
  const dx = Math.round(delta.x), dy = Math.round(delta.y);
  if (kind === 'move') {
    const visibleWidth = Math.min(96, start.width, area.width);
    const visibleHeight = Math.min(40, start.height, area.height);
    return { ...start,
      x: clamp(start.x + dx, area.x - start.width + visibleWidth, area.x + area.width - visibleWidth),
      y: clamp(start.y + dy, area.y, area.y + area.height - visibleHeight)
    };
  }
  const minWidth = Math.min(minimum.width, area.width);
  const minHeight = Math.min(minimum.height, area.height);
  const right = start.x + start.width, bottom = start.y + start.height;
  let { x, y, width, height } = start;
  if (kind.includes('e')) width = clamp(start.width + dx, minWidth, Math.max(minWidth, area.x + area.width - start.x));
  if (kind.includes('w')) { width = clamp(start.width - dx, minWidth, Math.max(minWidth, right - area.x)); x = right - width; }
  if (kind.includes('s')) height = clamp(start.height + dy, minHeight, Math.max(minHeight, area.y + area.height - start.y));
  if (kind.includes('n')) { height = clamp(start.height - dy, minHeight, Math.max(minHeight, bottom - area.y)); y = bottom - height; }
  return { x, y, width, height };
}

export function createWindowGestures({ getCursorPoint, getWorkArea, onBegin = () => {} }) {
  const active = new Map();
  const end = win => active.delete(win.id);
  const begin = (win, kind) => {
    if (!kinds.has(kind)) throw new Error('窗口手势无效');
    if (win.isDestroyed() || !win.isVisible()) return false;
    const bounds = win.getBounds(), [width, height] = win.getMinimumSize();
    active.set(win.id, { kind, bounds, cursor: getCursorPoint(), minimum: { width, height }, area: getWorkArea(bounds) });
    onBegin(win);
    return true;
  };
  const update = win => {
    const gesture = active.get(win.id);
    if (!gesture || win.isDestroyed() || !win.isVisible()) { end(win); return false; }
    const cursor = getCursorPoint();
    const area = gesture.kind === 'move' ? getWorkArea({ x: cursor.x, y: cursor.y, width: 1, height: 1 }) : gesture.area;
    const bounds = gestureBounds(gesture.kind, gesture.bounds, { x: cursor.x - gesture.cursor.x, y: cursor.y - gesture.cursor.y }, gesture.minimum, area);
    win.setBounds(bounds, false);
    return true;
  };
  return { begin, update, end };
}
