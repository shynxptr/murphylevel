/**
 * CardRenderer — Draws the level-up card on a browser Canvas,
 * replicating the bot's levelUpCard.js rendering logic.
 */

// Helpers
function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    let x = cx + Math.cos(rot) * outerRadius;
    let y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;
    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
}

function drawBarcode(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.fillStyle = color;
  let cx = x;
  // Use seeded pseudo-random for consistency
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return seed / 2147483647;
  };
  while (cx < x + w) {
    const barW = rand() * 3 + 1;
    if (rand() > 0.3) ctx.fillRect(cx, y, barW, h);
    cx += barW + rand() * 2 + 1;
  }
  ctx.restore();
}

function drawPerspectiveGrid(ctx, width, height, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const horizonY = height * 0.35;
  const centerX = width / 2;
  for (let i = -8; i <= 8; i++) {
    const x = centerX + i * 45;
    ctx.beginPath();
    ctx.moveTo(centerX + (x - centerX) * 0.15, horizonY);
    ctx.lineTo(x + i * 18, height);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const y = horizonY + Math.pow(i / 6, 2) * (height - horizonY);
    if (y > height) continue;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCornerAccents(ctx, width, height, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const size = 10, m = 8;
  ctx.beginPath(); ctx.moveTo(m, m + size); ctx.lineTo(m, m); ctx.lineTo(m + size, m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(width - m - size, m); ctx.lineTo(width - m, m); ctx.lineTo(width - m, m + size); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(m, height - m - size); ctx.lineTo(m, height - m); ctx.lineTo(m + size, height - m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(width - m - size, height - m); ctx.lineTo(width - m, height - m); ctx.lineTo(width - m, height - m - size); ctx.stroke();
  ctx.restore();
}

function drawAvatarPlaceholder(ctx, cx, cy, radius, color) {
  ctx.save();
  ctx.fillStyle = '#dde3ff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(cx, cy - radius * 0.25, radius * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + radius * 0.45, radius * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGraffitiText(ctx, text, x, y, color, outlineColor, fontSize, fontName) {
  ctx.save();
  ctx.translate(x, y);
  ctx.font = `${fontSize}px ${fontName}, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const letterSpacing = 2;
  const totalWidth = ctx.measureText(text).width + (text.length - 1) * letterSpacing;
  let currentX = -totalWidth / 2;
  const letterWidths = [];
  for (const char of text) letterWidths.push(ctx.measureText(char).width);

  // Drop shadow
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < text.length; i++) {
    const lw = letterWidths[i];
    ctx.save();
    ctx.translate(currentX + lw / 2, 4);
    for (let s = 1; s <= 4; s++) ctx.fillText(text[i], s * 0.5, s * 0.5);
    ctx.restore();
    currentX += lw + letterSpacing;
  }

  // Outline
  currentX = -totalWidth / 2;
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(5, fontSize * 0.18);
  ctx.strokeStyle = outlineColor;
  ctx.lineJoin = 'round';
  for (let i = 0; i < text.length; i++) {
    const lw = letterWidths[i];
    ctx.save();
    ctx.translate(currentX + lw / 2, 0);
    ctx.strokeText(text[i], 0, 0);
    ctx.restore();
    currentX += lw + letterSpacing;
  }

  // Fill
  currentX = -totalWidth / 2;
  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    const lw = letterWidths[i];
    ctx.save();
    ctx.translate(currentX + lw / 2, 0);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
    currentX += lw + letterSpacing;
  }

  // Highlight
  currentX = -totalWidth / 2;
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < text.length; i++) {
    const lw = letterWidths[i];
    ctx.save();
    ctx.translate(currentX + lw / 2 - 1, -1);
    ctx.strokeText(text[i], 0, 0);
    ctx.restore();
    currentX += lw + letterSpacing;
  }
  ctx.restore();
}

/**
 * Render the level-up card on a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout - The layout configuration
 * @param {string} themeType - 'chat', 'voice', or 'overall'
 * @param {object} [options] - optional overrides
 */
export function renderCard(ctx, layout, themeType = 'chat', options = {}) {
  const W = layout.card.width;
  const H = layout.card.height;

  const fallbackThemes = {
    chat: { blue: '#1b45f4', lightBlue: '#4b7bff', label: 'CHAT XP' },
    voice: { blue: '#e94560', lightBlue: '#ff6b8a', label: 'VOICE XP' },
    overall: { blue: '#9b59b6', lightBlue: '#c39bd3', label: 'OVERALL XP' },
  };
  const theme = layout.theme?.[themeType] || fallbackThemes[themeType] || layout.theme?.chat || fallbackThemes.chat;
  const defaultChatBlue = (layout.theme?.chat?.blue || '#1b45f4').toLowerCase();

  const titleColor = (themeType === 'chat' && layout.title?.color)
    || (layout.title?.color && layout.title.color.toLowerCase() !== defaultChatBlue ? layout.title.color : theme.blue);
  const levelBoxColor = (themeType === 'chat' && layout.levelBox?.color)
    || (layout.levelBox?.color && layout.levelBox.color.toLowerCase() !== defaultChatBlue ? layout.levelBox.color : theme.blue);
  const usernameColor = (layout.username?.color && layout.username.color.toLowerCase() !== '#0a0a1a')
    ? layout.username.color
    : theme.blue;

  const gridColor = '#d6dcff';

  // ── Background ──
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = layout.card.bgColor;
  ctx.fillRect(0, 0, W, H);

  // ── Grid ──
  if (layout.decor.showGrid) {
    drawPerspectiveGrid(ctx, W, H, gridColor);
  }

  // ── Corner Accents ──
  if (layout.decor.showCornerAccents) {
    drawCornerAccents(ctx, W, H, theme.blue);
  }

  // ── Labels ──
  if (layout.decor.showLabels) {
    ctx.save();
    ctx.strokeStyle = theme.blue;
    ctx.lineWidth = 1;
    ctx.strokeRect(120, 12, 80, 18);
    ctx.font = 'bold 10px Arial, sans-serif';
    ctx.fillStyle = theme.blue;
    ctx.textAlign = 'left';
    ctx.fillText('MURPHY LVL', 125, 24);
    ctx.strokeRect(W - 140, 12, 80, 18);
    ctx.fillText('ONLINE', W - 132, 24);
    ctx.restore();
  }

  // ── Barcode ──
  if (layout.decor.showBarcode) {
    drawBarcode(ctx, 120, H - 22, 70, 12, theme.blue);
  }

  // ── Bottom labels ──
  if (layout.decor.showLabels) {
    ctx.save();
    ctx.strokeStyle = theme.blue;
    ctx.lineWidth = 1;
    ctx.strokeRect(W - 100, H - 24, 60, 16);
    ctx.font = 'bold 10px Arial, sans-serif';
    ctx.fillStyle = theme.blue;
    ctx.textAlign = 'left';
    ctx.fillText('#151', W - 92, H - 12);
    ctx.restore();
  }

  // ── Divider ──
  if (layout.decor.showDivider) {
    ctx.save();
    ctx.strokeStyle = theme.blue;
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.decor.dividerX, 40);
    ctx.lineTo(layout.decor.dividerX, H - 35);
    ctx.stroke();
    ctx.restore();
  }

  // ── Avatar ──
  if (layout.avatar.enabled) {
    const a = layout.avatar;
    const half = a.size / 2;

    // Pulse ring (static in preview)
    if (a.showPulse) {
      ctx.save();
      ctx.strokeStyle = theme.blue;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(a.x, a.y, half + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Placeholder avatar
    drawAvatarPlaceholder(ctx, a.x, a.y, half, theme.blue);

    // Ring
    if (a.showRing) {
      ctx.strokeStyle = theme.blue;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(a.x, a.y, half + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── Title ──
  if (layout.title.enabled) {
    const t = layout.title;
    drawGraffitiText(ctx, t.text, t.x, t.y, titleColor, t.outlineColor, t.fontSize, t.font);
  }

  // ── Username ──
  if (layout.username.enabled) {
    const u = layout.username;
    const name = options.username || 'MurphyUser';
    ctx.font = `bold ${u.fontSize}px Arial, sans-serif`;
    ctx.fillStyle = usernameColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, u.x, u.y);
  }

  // ── Level Box ──
  if (layout.levelBox.enabled) {
    const lb = layout.levelBox;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = theme.blue;
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, lb.x, lb.y, lb.width, lb.height, 8);
    ctx.fill();
    ctx.stroke();

    const cx = lb.x + lb.width / 2;
    const cy = lb.y + lb.height / 2;
    ctx.font = `bold ${lb.fontSize + 2}px Arial, sans-serif`;
    ctx.fillStyle = levelBoxColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`LEVEL ${options.level || 5}`, cx, cy);
    ctx.restore();
  }

  // ── Type Badge ──
  if (layout.typeBadge.enabled) {
    const tb = layout.typeBadge;
    ctx.save();
    ctx.fillStyle = theme.blue;
    drawRoundedRect(ctx, tb.x, tb.y, tb.width, tb.height, 9);
    ctx.fill();

    ctx.font = `bold ${tb.fontSize}px Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(theme.label, tb.x + tb.width / 2, tb.y + tb.height / 2);
    ctx.restore();
  }

  // ── Static particles (decorative dots) ──
  if (layout.decor.showParticles) {
    ctx.save();
    let seed2 = 123;
    const rand2 = () => {
      seed2 = (seed2 * 16807 + 0) % 2147483647;
      return seed2 / 2147483647;
    };
    for (let i = 0; i < 8; i++) {
      const px = rand2() * W;
      const py = rand2() * H;
      const sz = rand2() * 2.5 + 1;
      ctx.globalAlpha = 0.3 + rand2() * 0.3;
      ctx.fillStyle = i % 2 === 0 ? theme.blue : theme.lightBlue;
      if (rand2() > 0.5) {
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
      } else {
        drawStar(ctx, px, py, 4, sz * 1.5, sz * 0.6);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/**
 * Get the bounding boxes of draggable elements for overlay positioning.
 * Returns an object keyed by element name.
 */
export function getElementBounds(layout) {
  const bounds = {};

  if (layout.avatar.enabled) {
    const a = layout.avatar;
    const half = a.size / 2;
    bounds.avatar = { x: a.x - half, y: a.y - half, width: a.size, height: a.size };
  }

  if (layout.title.enabled) {
    const t = layout.title;
    // Estimate text bounds
    const estW = t.text.length * t.fontSize * 0.65;
    bounds.title = { x: t.x - estW / 2, y: t.y - t.fontSize / 2, width: estW, height: t.fontSize * 1.2 };
  }

  if (layout.username.enabled) {
    const u = layout.username;
    const estW = 120;
    bounds.username = { x: u.x - estW / 2, y: u.y - u.fontSize / 2, width: estW, height: u.fontSize * 1.3 };
  }

  if (layout.levelBox.enabled) {
    const lb = layout.levelBox;
    bounds.levelBox = { x: lb.x, y: lb.y, width: lb.width, height: lb.height };
  }

  if (layout.typeBadge.enabled) {
    const tb = layout.typeBadge;
    bounds.typeBadge = { x: tb.x, y: tb.y, width: tb.width, height: tb.height };
  }

  return bounds;
}
