const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const path = require('path');
const fs = require('fs');

// Register custom font THE_JACATRA
try {
  const fontPath = path.join(__dirname, '..', '..', 'assets', 'THE_JACATRA.otf');
  GlobalFonts.registerFromPath(fontPath, 'Jacatra');
} catch (e) {
  console.warn('Warning: Could not register Jacatra font:', e.message);
}

// Register custom font levelup.otf
try {
  const levelupFontPath = path.join(__dirname, '..', '..', 'assets', 'levelup.otf');
  GlobalFonts.registerFromPath(levelupFontPath, 'LevelUp');
} catch (e) {
  console.warn('Warning: Could not register LevelUp font:', e.message);
}

// Register custom font username-font.otf
try {
  const usernameFontPath = path.join(__dirname, '..', '..', 'assets', 'username-font.otf');
  GlobalFonts.registerFromPath(usernameFontPath, 'UsernameFont');
} catch (e) {
  console.warn('Warning: Could not register UsernameFont:', e.message);
}

// ============= LOAD LAYOUT CONFIG =============
const configPath = path.join(__dirname, '..', '..', 'layout.json');
let LAYOUT;
try {
  LAYOUT = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.warn('Warning: Could not load layout.json, using defaults:', e.message);
  LAYOUT = {
    card: { width: 700, height: 200, bgColor: '#f8f9ff' },
    avatar: { enabled: true, x: 65, y: 100, size: 80, showRing: true, showPulse: true },
    title: { enabled: true, text: 'LEVEL UP', x: 350, y: 65, fontSize: 36, font: 'Jacatra', color: '#1b45f4', outlineColor: '#ffffff' },
    username: { enabled: true, x: 350, y: 93, fontSize: 16, color: '#0a0a1a' },
    levelBox: { enabled: true, x: 270, y: 145, width: 160, height: 36, fontSize: 22, color: '#1b45f4' },
    typeBadge: { enabled: true, x: 436, y: 149, width: 70, height: 18, fontSize: 9 },
    decor: { showCornerAccents: true, showGrid: true, showLabels: true, showBarcode: true, showParticles: true, showDivider: true, dividerX: 125 },
    theme: { chat: { blue: '#1b45f4', lightBlue: '#4b7bff', label: 'CHAT XP' }, voice: { blue: '#e94560', lightBlue: '#ff6b8a', label: 'VOICE XP' } }
  };
}

const CARD_WIDTH = LAYOUT.card.width;
const CARD_HEIGHT = LAYOUT.card.height;
const FRAMES = 45;
const FRAME_DELAY = 60;

const COLORS = {
  bg: LAYOUT.card.bgColor,
  white: '#ffffff',
  black: '#0a0a1a',
  grid: '#d6dcff',
};

const THEME = {
  chat: { blue: LAYOUT.theme.chat.blue, lightBlue: LAYOUT.theme.chat.lightBlue, label: LAYOUT.theme.chat.label },
  voice: { blue: LAYOUT.theme.voice.blue, lightBlue: LAYOUT.theme.voice.lightBlue, label: LAYOUT.theme.voice.label },
};

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
  let rot = Math.PI / 2 * 3;
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
  while (cx < x + w) {
    const barW = Math.random() * 3 + 1;
    if (Math.random() > 0.3) ctx.fillRect(cx, y, barW, h);
    cx += barW + Math.random() * 2 + 1;
  }
  ctx.restore();
}

function drawGraffitiText(ctx, text, x, y, color, outlineColor, scale, rotation, wobble, fontSize, fontName) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.font = `${fontSize}px ${fontName}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const letterSpacing = 2;
  const totalWidth = ctx.measureText(text).width + (text.length - 1) * letterSpacing;
  let currentX = -totalWidth / 2;
  const letterWidths = [];
  for (const char of text) letterWidths.push(ctx.measureText(char).width);

  // Drop shadow
  ctx.fillStyle = color; ctx.globalAlpha = 0.35;
  for (let i = 0; i < text.length; i++) {
    const lw = letterWidths[i];
    const wave = Math.sin(wobble * 0.2 + i) * 1.5;
    const rot = Math.cos(wobble * 0.15 + i * 0.5) * 0.04;
    ctx.save(); ctx.translate(currentX + lw / 2, wave + 5); ctx.rotate(rot);
    for (let s = 1; s <= 6; s++) ctx.fillText(text[i], s * 0.5, s * 0.5);
    ctx.restore(); currentX += lw + letterSpacing;
  }

  // Outline
  currentX = -totalWidth / 2;
  ctx.globalAlpha = 1; ctx.lineWidth = Math.max(5, fontSize * 0.18);
  ctx.strokeStyle = outlineColor; ctx.lineJoin = 'round';
  for (let i = 0; i < text.length; i++) {
    const lw = letterWidths[i];
    const wave = Math.sin(wobble * 0.2 + i) * 1.5;
    const rot = Math.cos(wobble * 0.15 + i * 0.5) * 0.04;
    ctx.save(); ctx.translate(currentX + lw / 2, wave); ctx.rotate(rot);
    ctx.strokeText(text[i], 0, 0);
    ctx.restore(); currentX += lw + letterSpacing;
  }

  // Fill
  currentX = -totalWidth / 2;
  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    const lw = letterWidths[i];
    const wave = Math.sin(wobble * 0.2 + i) * 1.5;
    const rot = Math.cos(wobble * 0.15 + i * 0.5) * 0.04;
    ctx.save(); ctx.translate(currentX + lw / 2, wave); ctx.rotate(rot);
    ctx.fillText(text[i], 0, 0);
    ctx.restore(); currentX += lw + letterSpacing;
  }

  // Highlight
  currentX = -totalWidth / 2;
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < text.length; i++) {
    const lw = letterWidths[i];
    const wave = Math.sin(wobble * 0.2 + i) * 1.5;
    const rot = Math.cos(wobble * 0.15 + i * 0.5) * 0.04;
    ctx.save(); ctx.translate(currentX + lw / 2 - 1, wave - 1); ctx.rotate(rot);
    ctx.strokeText(text[i], 0, 0);
    ctx.restore(); currentX += lw + letterSpacing;
  }
  ctx.restore();
}

function drawPerspectiveGrid(ctx, width, height, progress, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  const horizonY = height * 0.35;
  const scroll = progress * 50;
  const centerX = width / 2;
  for (let i = -8; i <= 8; i++) {
    const x = centerX + i * 45;
    ctx.beginPath();
    ctx.moveTo(centerX + (x - centerX) * 0.15, horizonY);
    ctx.lineTo(x + (i * 18), height);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const yBase = horizonY + Math.pow(i / 6, 2) * (height - horizonY);
    const y = ((yBase + scroll) % (height - horizonY)) + horizonY;
    if (y > height) continue;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.restore();
}

function drawCornerAccents(ctx, width, height, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  const size = 10, m = 8;
  ctx.beginPath(); ctx.moveTo(m, m + size); ctx.lineTo(m, m); ctx.lineTo(m + size, m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(width - m - size, m); ctx.lineTo(width - m, m); ctx.lineTo(width - m, m + size); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(m, height - m - size); ctx.lineTo(m, height - m); ctx.lineTo(m + size, height - m); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(width - m - size, height - m); ctx.lineTo(width - m, height - m); ctx.lineTo(width - m, height - m - size); ctx.stroke();
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

// ============= MAIN GENERATOR =============
async function createLevelUpGIF({ username, avatarURL, oldLevel, newLevel, type = 'chat' }) {
  const theme = THEME[type] || THEME.chat;
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  const particles = [];
  if (LAYOUT.decor.showParticles) {
    for (let i = 0; i < 12; i++) particles.push(new Particle(CARD_WIDTH, CARD_HEIGHT, theme.lightBlue));
  }

  let avatarImage = null;
  try {
    const res = await fetch(avatarURL);
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      avatarImage = await loadImage(buffer);
    }
  } catch (e) {
    console.warn('Gagal load avatar:', e.message);
  }

  const encoder = new GIFEncoder(CARD_WIDTH, CARD_HEIGHT);
  encoder.setDelay(FRAME_DELAY);
  encoder.setRepeat(0);
  encoder.setQuality(10);
  encoder.setTransparent(false);
  encoder.start();

  for (let frame = 0; frame < FRAMES; frame++) {
    const progress = frame / FRAMES;
    const phase = frame * 0.3;

    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    if (LAYOUT.decor.showGrid) drawPerspectiveGrid(ctx, CARD_WIDTH, CARD_HEIGHT, progress, COLORS.grid);
    if (LAYOUT.decor.showCornerAccents) drawCornerAccents(ctx, CARD_WIDTH, CARD_HEIGHT, theme.blue);

    // Labels
    if (LAYOUT.decor.showLabels) {
      ctx.save();
      ctx.strokeStyle = theme.blue; ctx.lineWidth = 1;
      ctx.strokeRect(120, 12, 80, 18);
      ctx.font = 'bold 10px Arial, sans-serif'; ctx.fillStyle = theme.blue; ctx.textAlign = 'left';
      ctx.fillText('MURPHY LVL', 125, 24);
      ctx.strokeRect(CARD_WIDTH - 140, 12, 80, 18);
      ctx.fillText('ONLINE', CARD_WIDTH - 132, 24);
      ctx.restore();
    }

    if (LAYOUT.decor.showBarcode) drawBarcode(ctx, 120, CARD_HEIGHT - 22, 70, 12, theme.blue);

    if (LAYOUT.decor.showLabels) {
      ctx.save();
      ctx.strokeStyle = theme.blue; ctx.lineWidth = 1;
      ctx.strokeRect(CARD_WIDTH - 100, CARD_HEIGHT - 24, 60, 16);
      ctx.font = 'bold 10px Arial, sans-serif'; ctx.fillStyle = theme.blue; ctx.textAlign = 'left';
      ctx.fillText('#151', CARD_WIDTH - 92, CARD_HEIGHT - 12);
      ctx.restore();
    }

    if (LAYOUT.decor.showDivider) {
      ctx.save();
      ctx.strokeStyle = theme.blue; ctx.globalAlpha = 0.2; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(LAYOUT.decor.dividerX, 40); ctx.lineTo(LAYOUT.decor.dividerX, CARD_HEIGHT - 35); ctx.stroke();
      ctx.restore();
    }

    // Avatar
    if (LAYOUT.avatar.enabled) {
      const a = LAYOUT.avatar;
      const half = a.size / 2;
      if (a.showPulse) {
        const pulse = Math.sin(phase) * 5;
        ctx.save(); ctx.strokeStyle = theme.blue; ctx.lineWidth = 2; ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(a.x, a.y, half + 5 + pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      if (avatarImage) {
        try {
          ctx.save();
          ctx.beginPath(); ctx.arc(a.x, a.y, half, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
          ctx.drawImage(avatarImage, a.x - half, a.y - half, a.size, a.size);
          ctx.restore();
        } catch { drawAvatarPlaceholder(ctx, a.x, a.y, half, theme.blue); }
      } else { drawAvatarPlaceholder(ctx, a.x, a.y, half, theme.blue); }
      if (a.showRing) {
        ctx.strokeStyle = theme.blue; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(a.x, a.y, half + 2, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Title
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
      drawGraffitiText(ctx, t.text, t.x, t.y + textBounce, theme.blue, t.outlineColor, textScale, Math.sin(phase * 0.5) * 0.015, phase, t.fontSize, t.font);
      ctx.restore();
    }

    // Username
    if (LAYOUT.username.enabled) {
      const u = LAYOUT.username;
      const name = username.length > 32 ? username.substring(0, 32) + '...' : username;
      ctx.font = `bold ${u.fontSize}px UsernameFont, Arial, sans-serif`;
      ctx.fillStyle = theme.blue;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, u.x, u.y);
    }

    // Level box
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
        ctx.font = `bold ${lb.fontSize}px LevelUp, Arial, sans-serif`; ctx.fillStyle = theme.blue;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`LEVEL ${oldLevel}`, cx, cy + slide);
        ctx.restore();
      } else {
        const fi = (tp - 0.5) / 0.5;
        const bounce = (1 - fi) * 10;
        const scale = 0.7 + fi * 0.3 + Math.sin(fi * Math.PI) * 0.12;
        ctx.save(); ctx.globalAlpha = fi;
        ctx.translate(cx, cy + bounce); ctx.scale(scale, scale);
        ctx.font = `bold ${lb.fontSize + 2}px LevelUp, Arial, sans-serif`; ctx.fillStyle = theme.blue;
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
        // Batang panah
        ctx.beginPath(); ctx.moveTo(ax - 9, ay); ctx.lineTo(ax + 5, ay); ctx.stroke();
        // Kepala panah (segitiga)
        ctx.beginPath();
        ctx.moveTo(ax + 10, ay);
        ctx.lineTo(ax + 3, ay - 5);
        ctx.lineTo(ax + 3, ay + 5);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // Type badge
    if (LAYOUT.typeBadge.enabled) {
      const tb = LAYOUT.typeBadge;
      ctx.save();
      ctx.fillStyle = theme.blue;
      drawRoundedRect(ctx, tb.x, tb.y, tb.width, tb.height, 9);
      ctx.fill();
      ctx.font = `bold ${tb.fontSize}px Arial, sans-serif`;
      ctx.fillStyle = COLORS.white;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(theme.label, tb.x + tb.width / 2, tb.y + tb.height / 2);
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

function drawAvatarPlaceholder(ctx, cx, cy, radius, color = COLORS.bg) {
  ctx.save();
  ctx.fillStyle = '#dde3ff';
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color; ctx.globalAlpha = 0.3;
  ctx.beginPath(); ctx.arc(cx, cy - radius * 0.25, radius * 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy + radius * 0.45, radius * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

module.exports = { createLevelUpGIF };
