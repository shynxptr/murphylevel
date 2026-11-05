const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

// Register custom fonts
try {
  GlobalFonts.registerFromPath(path.join(__dirname, '..', '..', 'assets', 'THE_JACATRA.otf'), 'Jacatra');
} catch (e) {
  console.warn('Warning: Could not register Jacatra font:', e.message);
}

try {
  GlobalFonts.registerFromPath(path.join(__dirname, '..', '..', 'assets', 'levelup.otf'), 'LevelUp');
} catch (e) {
  console.warn('Warning: Could not register LevelUp font:', e.message);
}

try {
  GlobalFonts.registerFromPath(path.join(__dirname, '..', '..', 'assets', 'username-font.otf'), 'UsernameFont');
} catch (e) {
  console.warn('Warning: Could not register UsernameFont:', e.message);
}

// ============= LOAD LAYOUT CONFIG (AUTO-RELOAD ON CHANGE) =============
const configPath = path.join(__dirname, '..', '..', 'layout.json');
const DEFAULT_LAYOUT = {
  card: { width: 700, height: 200, bgColor: '#f8f9ff' },
  avatar: { enabled: true, x: 65, y: 100, size: 80, showRing: true, showPulse: true },
  title: { enabled: true, text: 'LEVEL UP', x: 363, y: 59, fontSize: 50, font: 'Jacatra', color: '#1b45f4', outlineColor: '#ffffff' },
  username: { enabled: true, x: 352, y: 122, fontSize: 16, color: '#0a0a1a' },
  levelBox: { enabled: true, x: 270, y: 145, width: 160, height: 36, fontSize: 22, color: '#1b45f4' },
  typeBadge: { enabled: true, x: 436, y: 149, width: 70, height: 18, fontSize: 9 },
  decor: { showCornerAccents: true, showGrid: true, showLabels: true, showBarcode: true, showParticles: true, showDivider: true, dividerX: 125 },
  theme: {
    chat: { blue: '#1b45f4', lightBlue: '#4b7bff', label: 'CHAT XP' },
    voice: { blue: '#e94560', lightBlue: '#ff6b8a', label: 'VOICE XP' },
    overall: { blue: '#9b59b6', lightBlue: '#c39bd3', label: 'OVERALL XP' },
  },
};

let cachedLayout = null;
let cachedLayoutMtime = 0;

function getLayout() {
  try {
    const stat = fs.statSync(configPath);
    if (!cachedLayout || stat.mtimeMs !== cachedLayoutMtime) {
      cachedLayout = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      cachedLayoutMtime = stat.mtimeMs;
    }
    return cachedLayout;
  } catch (e) {
    if (!cachedLayout) {
      console.warn('Warning: Could not load layout.json, using defaults:', e.message);
      cachedLayout = DEFAULT_LAYOUT;
    }
    return cachedLayout;
  }
}

const FRAMES = 45;
const FRAME_DELAY = 60;

// ============= HELPERS =============
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
  let x = cx, y = cy, step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius; y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y); rot += step;
    x = cx + Math.cos(rot) * innerRadius; y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y); rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
}

function drawBarcode(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.fillStyle = color;
  let cx = x;
  // Seeded pseudo-random agar barcode konsisten dan tidak berkedip tiap frame
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  while (cx < x + w) {
    const barW = rand() * 3 + 1;
    if (rand() > 0.3) ctx.fillRect(cx, y, barW, h);
    cx += barW + rand() * 2 + 1;
  }
  ctx.restore();
}

function measureGraffitiLetters(ctx, text, fontSize, fontName) {
  ctx.save();
  ctx.font = `${fontSize}px ${fontName}, Arial, sans-serif`;
  const letterSpacing = 2;
  const letterWidths = [];
  let sumWidths = 0;
  for (const char of text) {
    const w = ctx.measureText(char).width;
    letterWidths.push(w);
    sumWidths += w;
  }
  const totalWidth = sumWidths + Math.max(0, text.length - 1) * letterSpacing;
  ctx.restore();
  return { letterWidths, totalWidth, letterSpacing };
}

function drawGraffitiText(ctx, text, x, y, color, outlineColor, scale, rotation, wobble, fontSize, fontName, metrics) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.font = `${fontSize}px ${fontName}, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const { letterWidths, totalWidth, letterSpacing } = metrics;

  // Precompute posisi tiap huruf di frame ini
  const len = text.length;
  const charX = new Array(len);
  const charY = new Array(len);
  const charRot = new Array(len);
  let currentX = -totalWidth / 2;

  for (let i = 0; i < len; i++) {
    const lw = letterWidths[i];
    charX[i] = currentX + lw / 2;
    charY[i] = Math.sin(wobble * 0.2 + i) * 1.5;
    charRot[i] = Math.cos(wobble * 0.15 + i * 0.5) * 0.04;
    currentX += lw + letterSpacing;
  }

  // Drop shadow (2-pass 3D extrusion — jauh lebih ringan daripada 6-pass)
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < len; i++) {
    ctx.save();
    ctx.translate(charX[i], charY[i] + 5);
    ctx.rotate(charRot[i]);
    ctx.fillText(text[i], 1.5, 1.5);
    ctx.fillText(text[i], 3, 3);
    ctx.restore();
  }

  // Outline
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(5, fontSize * 0.18);
  ctx.strokeStyle = outlineColor;
  ctx.lineJoin = 'round';
  for (let i = 0; i < len; i++) {
    ctx.save();
    ctx.translate(charX[i], charY[i]);
    ctx.rotate(charRot[i]);
    ctx.strokeText(text[i], 0, 0);
    ctx.restore();
  }

  // Fill
  ctx.fillStyle = color;
  for (let i = 0; i < len; i++) {
    ctx.save();
    ctx.translate(charX[i], charY[i]);
    ctx.rotate(charRot[i]);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }

  // Highlight
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < len; i++) {
    ctx.save();
    ctx.translate(charX[i] - 1, charY[i] - 1);
    ctx.rotate(charRot[i]);
    ctx.strokeText(text[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawPerspectiveGrid(ctx, width, height, progress, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const horizonY = height * 0.35;
  const scroll = progress * 50;
  const centerX = width / 2;
  ctx.beginPath();
  for (let i = -8; i <= 8; i++) {
    const x = centerX + i * 45;
    ctx.moveTo(centerX + (x - centerX) * 0.15, horizonY);
    ctx.lineTo(x + i * 18, height);
  }
  for (let i = 0; i < 6; i++) {
    const yBase = horizonY + Math.pow(i / 6, 2) * (height - horizonY);
    const y = ((yBase + scroll) % (height - horizonY)) + horizonY;
    if (y > height) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawCornerAccents(ctx, width, height, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const size = 10, m = 8;
  ctx.beginPath();
  ctx.moveTo(m, m + size); ctx.lineTo(m, m); ctx.lineTo(m + size, m);
  ctx.moveTo(width - m - size, m); ctx.lineTo(width - m, m); ctx.lineTo(width - m, m + size);
  ctx.moveTo(m, height - m - size); ctx.lineTo(m, height - m); ctx.lineTo(m + size, height - m);
  ctx.moveTo(width - m - size, height - m); ctx.lineTo(width - m, height - m); ctx.lineTo(width - m, height - m - size);
  ctx.stroke();
  ctx.restore();
}

function drawAvatarPlaceholder(ctx, cx, cy, radius, color) {
  ctx.save();
  ctx.fillStyle = '#dde3ff';
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color; ctx.globalAlpha = 0.3;
  ctx.beginPath(); ctx.arc(cx, cy - radius * 0.25, radius * 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy + radius * 0.45, radius * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ============= PARTICLE =============
class Particle {
  constructor(width, height, color) {
    this.width = width; this.height = height; this.color = color; this.reset();
  }
  reset() {
    this.x = Math.random() * this.width;
    this.y = this.height + Math.random() * 30;
    this.size = Math.random() * 2.5 + 1;
    this.speedY = -(Math.random() * 1 + 0.3);
    this.speedX = (Math.random() - 0.5) * 0.8;
    this.rotation = Math.random() * Math.PI;
    this.life = 1;
    this.decay = Math.random() * 0.012 + 0.004;
    this.shape = Math.random() > 0.5 ? 'circle' : 'star';
  }
  update() {
    this.x += this.speedX; this.y += this.speedY; this.rotation += 0.03; this.life -= this.decay;
    if (this.life <= 0 || this.y < -15) this.reset();
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life) * 0.6;
    ctx.fillStyle = this.color;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    if (this.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI * 2); ctx.fill(); }
    else { drawStar(ctx, 0, 0, 4, this.size * 1.5, this.size * 0.6); ctx.fill(); }
    ctx.restore();
  }
}

// ============= CORE RENDERER =============
async function renderLevelUpGIF({ username, avatarURL, oldLevel, newLevel, type = 'chat' }) {
  const LAYOUT = getLayout();
  const CARD_WIDTH = LAYOUT.card.width || 700;
  const CARD_HEIGHT = LAYOUT.card.height || 200;

  const COLORS = {
    bg: LAYOUT.card.bgColor || '#f8f9ff',
    white: '#ffffff',
    black: '#0a0a1a',
    grid: '#d6dcff',
  };

  const THEME = {
    chat: {
      blue: LAYOUT.theme?.chat?.blue || '#1b45f4',
      lightBlue: LAYOUT.theme?.chat?.lightBlue || '#4b7bff',
      label: LAYOUT.theme?.chat?.label || 'CHAT XP',
    },
    voice: {
      blue: LAYOUT.theme?.voice?.blue || '#e94560',
      lightBlue: LAYOUT.theme?.voice?.lightBlue || '#ff6b8a',
      label: LAYOUT.theme?.voice?.label || 'VOICE XP',
    },
    overall: {
      blue: LAYOUT.theme?.overall?.blue || '#9b59b6',
      lightBlue: LAYOUT.theme?.overall?.lightBlue || '#c39bd3',
      label: LAYOUT.theme?.overall?.label || 'OVERALL XP',
    },
  };

  const theme = THEME[type] || THEME.chat;
  const defaultChatBlue = THEME.chat.blue.toLowerCase();

  // Gunakan custom color dari layout.json jika diubah user, atau ikuti warna tema aktif (chat/voice/overall)
  const titleColor = (type === 'chat' && LAYOUT.title?.color)
    || (LAYOUT.title?.color && LAYOUT.title.color.toLowerCase() !== defaultChatBlue ? LAYOUT.title.color : theme.blue);
  const levelBoxColor = (type === 'chat' && LAYOUT.levelBox?.color)
    || (LAYOUT.levelBox?.color && LAYOUT.levelBox.color.toLowerCase() !== defaultChatBlue ? LAYOUT.levelBox.color : theme.blue);
  const usernameColor = (LAYOUT.username?.color && LAYOUT.username.color.toLowerCase() !== '#0a0a1a')
    ? LAYOUT.username.color
    : theme.blue;

  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  let avatarImage = null;
  if (avatarURL) {
    try {
      const res = await fetch(avatarURL);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        avatarImage = await loadImage(buffer);
      }
    } catch (e) {
      console.warn('Gagal load avatar:', e.message);
    }
  }

  // Pre-render elemen statis sekali di luar loop 45 frame (optimasi besar untuk CPU)
  const staticOverlay = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const sctx = staticOverlay.getContext('2d');

  if (LAYOUT.decor.showCornerAccents) drawCornerAccents(sctx, CARD_WIDTH, CARD_HEIGHT, theme.blue);

  if (LAYOUT.decor.showLabels) {
    sctx.save();
    sctx.strokeStyle = theme.blue; sctx.lineWidth = 1;
    sctx.strokeRect(120, 12, 80, 18);
    sctx.font = 'bold 10px Arial, sans-serif'; sctx.fillStyle = theme.blue; sctx.textAlign = 'left';
    sctx.fillText('MURPHY LVL', 125, 24);
    sctx.strokeRect(CARD_WIDTH - 140, 12, 80, 18);
    sctx.fillText('ONLINE', CARD_WIDTH - 132, 24);
    sctx.strokeRect(CARD_WIDTH - 100, CARD_HEIGHT - 24, 60, 16);
    sctx.fillText('#151', CARD_WIDTH - 92, CARD_HEIGHT - 12);
    sctx.restore();
  }

  if (LAYOUT.decor.showBarcode) drawBarcode(sctx, 120, CARD_HEIGHT - 22, 70, 12, theme.blue);

  if (LAYOUT.decor.showDivider) {
    sctx.save();
    sctx.strokeStyle = theme.blue; sctx.globalAlpha = 0.2; sctx.lineWidth = 1;
    sctx.beginPath(); sctx.moveTo(LAYOUT.decor.dividerX, 40); sctx.lineTo(LAYOUT.decor.dividerX, CARD_HEIGHT - 35); sctx.stroke();
    sctx.restore();
  }

  if (LAYOUT.avatar.enabled) {
    const a = LAYOUT.avatar;
    const half = a.size / 2;
    if (avatarImage) {
      try {
        sctx.save();
        sctx.beginPath(); sctx.arc(a.x, a.y, half, 0, Math.PI * 2); sctx.closePath(); sctx.clip();
        sctx.drawImage(avatarImage, a.x - half, a.y - half, a.size, a.size);
        sctx.restore();
      } catch {
        drawAvatarPlaceholder(sctx, a.x, a.y, half, theme.blue);
      }
    } else {
      drawAvatarPlaceholder(sctx, a.x, a.y, half, theme.blue);
    }
    if (a.showRing) {
      sctx.save();
      sctx.strokeStyle = theme.blue; sctx.lineWidth = 3;
      sctx.beginPath(); sctx.arc(a.x, a.y, half + 2, 0, Math.PI * 2); sctx.stroke();
      sctx.restore();
    }
  }

  if (LAYOUT.username.enabled) {
    const u = LAYOUT.username;
    const name = username.length > 32 ? username.substring(0, 32) + '...' : username;
    sctx.save();
    sctx.font = `bold ${u.fontSize}px UsernameFont, Arial, sans-serif`;
    sctx.fillStyle = usernameColor;
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText(name, u.x, u.y);
    sctx.restore();
  }

  if (LAYOUT.typeBadge.enabled) {
    const tb = LAYOUT.typeBadge;
    sctx.save();
    sctx.fillStyle = theme.blue;
    drawRoundedRect(sctx, tb.x, tb.y, tb.width, tb.height, 9);
    sctx.fill();
    sctx.font = `bold ${tb.fontSize}px Arial, sans-serif`;
    sctx.fillStyle = COLORS.white;
    sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
    sctx.fillText(theme.label, tb.x + tb.width / 2, tb.y + tb.height / 2);
    sctx.restore();
  }

  const titleMetrics = LAYOUT.title.enabled
    ? measureGraffitiLetters(ctx, LAYOUT.title.text, LAYOUT.title.fontSize, LAYOUT.title.font)
    : null;

  const particles = [];
  if (LAYOUT.decor.showParticles) {
    for (let i = 0; i < 12; i++) particles.push(new Particle(CARD_WIDTH, CARD_HEIGHT, theme.lightBlue));
  }

  const encoder = new GIFEncoder(CARD_WIDTH, CARD_HEIGHT);
  encoder.setDelay(FRAME_DELAY);
  encoder.setRepeat(0);
  encoder.setQuality(12);
  encoder.setTransparent(false);
  encoder.start();

  for (let frame = 0; frame < FRAMES; frame++) {
    const progress = frame / FRAMES;
    const phase = frame * 0.3;

    // Background + Grid
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    if (LAYOUT.decor.showGrid) drawPerspectiveGrid(ctx, CARD_WIDTH, CARD_HEIGHT, progress, COLORS.grid);

    // Avatar pulse ring (di bawah static avatar)
    if (LAYOUT.avatar.enabled && LAYOUT.avatar.showPulse) {
      const a = LAYOUT.avatar;
      const half = a.size / 2;
      const pulse = Math.sin(phase) * 5;
      ctx.save(); ctx.strokeStyle = theme.blue; ctx.lineWidth = 2; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(a.x, a.y, half + 5 + pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Tempelkan semua elemen statis sekaligus
    ctx.drawImage(staticOverlay, 0, 0);

    // Title (animasi)
    if (LAYOUT.title.enabled) {
      const t = LAYOUT.title;
      let textScale = 1, textOpacity = 1, textBounce = 0;
      if (progress < 0.15) {
        const tt = progress / 0.15;
        textScale = 0.75 + tt * 0.25;
        textOpacity = Math.min(tt * 1.5, 1);
      } else {
        const tt = progress - 0.15;
        textScale = 1 + Math.sin(tt * Math.PI * 6) * 0.02;
        textBounce = Math.sin(tt * Math.PI * 4) * 1.5;
      }
      ctx.save();
      ctx.globalAlpha = textOpacity;
      drawGraffitiText(
        ctx,
        t.text,
        t.x,
        t.y + textBounce,
        titleColor,
        t.outlineColor,
        textScale,
        Math.sin(phase * 0.5) * 0.015,
        phase,
        t.fontSize,
        t.font,
        titleMetrics
      );
      ctx.restore();
    }

    // Level box (animasi transisi level)
    if (LAYOUT.levelBox.enabled) {
      const lb = LAYOUT.levelBox;
      const tp = Math.min(progress / 0.5, 1);
      ctx.save();
      ctx.fillStyle = COLORS.white; ctx.strokeStyle = theme.blue; ctx.lineWidth = 2;
      drawRoundedRect(ctx, lb.x, lb.y, lb.width, lb.height, 8);
      ctx.fill(); ctx.stroke();
      const cx = lb.x + lb.width / 2;
      const cy = lb.y + lb.height / 2;
      if (tp < 0.5) {
        const fo = 1 - (tp / 0.5);
        const slide = -(tp / 0.5) * 12;
        ctx.save(); ctx.globalAlpha = fo * 0.5;
        ctx.font = `bold ${lb.fontSize}px LevelUp, Arial, sans-serif`; ctx.fillStyle = levelBoxColor;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`LEVEL ${oldLevel}`, cx, cy + slide);
        ctx.restore();
      } else {
        const fi = (tp - 0.5) / 0.5;
        const bounce = (1 - fi) * 10;
        const scale = 0.7 + fi * 0.3 + Math.sin(fi * Math.PI) * 0.12;
        ctx.save(); ctx.globalAlpha = fi;
        ctx.translate(cx, cy + bounce); ctx.scale(scale, scale);
        ctx.font = `bold ${lb.fontSize + 2}px LevelUp, Arial, sans-serif`; ctx.fillStyle = levelBoxColor;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`LEVEL ${newLevel}`, 0, 0);
        ctx.restore();
      }
      if (tp > 0.3 && tp < 0.7) {
        const aa = Math.sin(((tp - 0.3) / 0.4) * Math.PI);
        const ax = cx, ay = lb.y - 10;
        ctx.save(); ctx.globalAlpha = aa;
        ctx.strokeStyle = theme.lightBlue; ctx.fillStyle = theme.lightBlue;
        ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(ax - 9, ay); ctx.lineTo(ax + 5, ay); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax + 10, ay);
        ctx.lineTo(ax + 3, ay - 5);
        ctx.lineTo(ax + 3, ay + 5);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // Particles
    for (const p of particles) { p.update(); p.draw(ctx); }

    // Burst
    if (LAYOUT.decor.showParticles && progress < 0.35) {
      const ba = 1 - (progress / 0.35);
      const tx = LAYOUT.title.enabled ? LAYOUT.title.x : CARD_WIDTH / 2;
      const ty = LAYOUT.title.enabled ? LAYOUT.title.y : 65;
      ctx.save(); ctx.globalAlpha = ba * 0.7;
      ctx.translate(tx, ty);
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2 + progress * 4;
        const dist = 50 + progress * 40;
        ctx.fillStyle = i % 2 === 0 ? theme.blue : theme.lightBlue;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * dist, Math.sin(angle) * dist * 0.35, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    encoder.addFrame(ctx);
  }

  encoder.finish();
  return encoder.out.getData();
}

// Worker thread entrypoint: jalankan encoding di background thread agar main thread tidak freeze
if (!isMainThread) {
  renderLevelUpGIF(workerData)
    .then((buf) => parentPort.postMessage({ ok: true, data: buf }))
    .catch((err) => parentPort.postMessage({ ok: false, error: err.message }));
}

/**
 * Generate Level Up GIF di worker thread (non-blocking) dengan fallback ke main thread
 */
function createLevelUpGIF(params) {
  if (!isMainThread) {
    return renderLevelUpGIF(params);
  }

  return new Promise((resolve) => {
    try {
      const worker = new Worker(__filename, { workerData: params });
      let settled = false;

      worker.once('message', (msg) => {
        settled = true;
        if (msg && msg.ok && msg.data) {
          resolve(Buffer.from(msg.data));
        } else {
          renderLevelUpGIF(params).then(resolve).catch(() => resolve(null));
        }
      });

      worker.once('error', () => {
        if (!settled) {
          settled = true;
          renderLevelUpGIF(params).then(resolve).catch(() => resolve(null));
        }
      });

      worker.once('exit', (code) => {
        if (!settled && code !== 0) {
          settled = true;
          renderLevelUpGIF(params).then(resolve).catch(() => resolve(null));
        }
      });
    } catch {
      renderLevelUpGIF(params).then(resolve);
    }
  });
}

module.exports = { createLevelUpGIF };
