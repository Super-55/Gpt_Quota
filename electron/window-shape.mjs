// Match Windows 11's native rounded Acrylic host and the renderer's outer radius.
export const WINDOW_RADIUS = 8;
export function roundedWindowShape(width, height, radius = WINDOW_RADIUS) {
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  radius = Math.max(0, Math.min(Math.floor(radius), Math.floor(width / 2), Math.floor(height / 2)));
  if (!radius) return [{ x: 0, y: 0, width, height }];
  const rectangles = [];
  const row = (y, inset) => {
    const previous = rectangles.at(-1), span = width - inset * 2;
    if (previous && previous.x === inset && previous.width === span && previous.y + previous.height === y) previous.height++;
    else rectangles.push({ x: inset, y, width: span, height: 1 });
  };
  for (let y = 0; y < radius; y++) {
    const distance = radius - y - .5;
    row(y, Math.max(0, Math.ceil(radius - Math.sqrt(radius * radius - distance * distance) - .5)));
  }
  if (height > radius * 2) rectangles.push({ x: 0, y: radius, width, height: height - radius * 2 });
  for (let y = height - radius; y < height; y++) {
    const distance = y + .5 - (height - radius);
    row(y, Math.max(0, Math.ceil(radius - Math.sqrt(radius * radius - distance * distance) - .5)));
  }
  return rectangles;
}
