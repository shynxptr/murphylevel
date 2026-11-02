const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

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
  console.warn('Warning: Could not register UsernameFont font:', e.message);
}

// Theme colors
const THEMES = {
  chat: {
    primary: '#00b4d8',
    secondary: '#48cae4',
    glow: 'rgba(0, 180, 216, 0.4)',
    label: 'CHAT',
    icon: '\u{1F4AC}',
  },
  voice: {
    primary: '#e94560',
    secondary: '#f72585',
    glow: 'rgba(233, 69, 96, 0.4)',
    label: 'VOICE',
    icon: '\u{1F3A4}',
  },
};

const CARD_WIDTH = 934;
const CARD_HEIGHT = 282;

/**
 * Fetch image dari URL dan return Buffer
 */
async function fetchImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ============= HELPERS =============

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawGlow(ctx, x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawCornerAccent(ctx, x, y, size, color, corner = 'tl') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (corner === 'tl') {
    ctx.moveTo(x, y + size);
    ctx.lineTo(x, y);
    ctx.lineTo(x + size, y);
  } else if (corner === 'tr') {
    ctx.moveTo(x - size, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + size);
  } else if (corner === 'bl') {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y);
    ctx.lineTo(x + size, y);
  } else if (corner === 'br') {
    ctx.moveTo(x - size, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - size);
  }
  ctx.stroke();
  ctx.restore();
}

function drawDecorativeDots(ctx, x, y, count, spacing, color) {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.arc(x + i * spacing, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = (Math.PI / 2) * 3;
  let x = cx, y = cy;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
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

// ============= MAIN GENERATOR =============

/**
 * Generate rank card sebagai Buffer
 * @param {GuildMember} member
 * @param {Object} data - { xp, level, messages?, minutes?, streak?, streakMultiplier?, rank?, totalUsers? }
 * @param {string} type - 'chat' atau 'voice'
 * @param {number} xpNeeded
 * @returns {Buffer}
 */
async function createRankCard(member, data, type, xpNeeded) {
  const theme = THEMES[type] || THEMES.chat;
  const isChat = type === 'chat';

  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  // === Background gradient ===
  const bgGradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  bgGradient.addColorStop(0, '#0a0a1a');
  bgGradient.addColorStop(0.5, '#0f0f23');
  bgGradient.addColorStop(1, '#0a0a1a');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // === Background glow circles (ambient lighting) ===
  drawGlow(ctx, CARD_WIDTH * 0.2, CARD_HEIGHT * 0.5, 250, theme.glow);
  drawGlow(ctx, CARD_WIDTH * 0.85, CARD_HEIGHT * 0.3, 200, theme.glow);

  // === Background pattern: subtle grid ===
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < CARD_WIDTH; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CARD_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < CARD_HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CARD_WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();

  // === Card glassmorphism panel ===
  const cardX = 20, cardY = 20, cardW = CARD_WIDTH - 40, cardH = CARD_HEIGHT - 40;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 20);
  const cardGradient = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
  cardGradient.addColorStop(0, 'rgba(22, 33, 62, 0.85)');
  cardGradient.addColorStop(1, 'rgba(15, 25, 50, 0.75)');
  ctx.fillStyle = cardGradient;
  ctx.fill();

  // Card border (glow)
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 20);
  ctx.strokeStyle = `rgba(${isChat ? '0, 180, 216' : '233, 69, 96'}, 0.3)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // === Accent strip di kiri ===
  ctx.save();
  drawRoundedRect(ctx, cardX, cardY, 8, cardH, 4);
  const stripGradient = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
  stripGradient.addColorStop(0, theme.primary);
  stripGradient.addColorStop(0.5, theme.secondary);
  stripGradient.addColorStop(1, theme.primary);
  ctx.fillStyle = stripGradient;
  ctx.fill();
  ctx.restore();

  // === Corner accents (decorative) ===
  drawCornerAccent(ctx, cardX + 12, cardY + 12, 8, theme.primary, 'tl');
  drawCornerAccent(ctx, cardX + cardW - 12, cardY + 12, 8, theme.primary, 'tr');
  drawCornerAccent(ctx, cardX + 12, cardY + cardH - 12, 8, theme.primary, 'bl');
  drawCornerAccent(ctx, cardX + cardW - 12, cardY + cardH - 12, 8, theme.primary, 'br');

  // === Avatar section ===
  const avatarSize = 150;
  const avatarX = 65;
  const avatarY = (CARD_HEIGHT - avatarSize) / 2;
  const avatarCenterX = avatarX + avatarSize / 2;
  const avatarCenterY = avatarY + avatarSize / 2;

  // Avatar glow
  drawGlow(ctx, avatarCenterX, avatarCenterY, avatarSize * 0.8, theme.glow);

  // Avatar background circle
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2 + 8, 0, Math.PI * 2);
  ctx.fill();

  // Avatar ring (animated-style gradient)
  const ringGradient = ctx.createLinearGradient(avatarX, avatarY, avatarX + avatarSize, avatarY + avatarSize);
  ringGradient.addColorStop(0, theme.primary);
  ringGradient.addColorStop(0.5, theme.secondary);
  ringGradient.addColorStop(1, theme.primary);
  ctx.strokeStyle = ringGradient;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2 + 5, 0, Math.PI * 2);
  ctx.stroke();

  // Avatar image
  try {
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatarBuf = await fetchImageBuffer(avatarURL);
    const avatar = await canvas.loadImage(avatarBuf);

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } catch (err) {
    ctx.fillStyle = '#333355';
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Avatar decorative ring dots
  ctx.save();
  ctx.fillStyle = theme.primary;
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const dotX = avatarCenterX + Math.cos(angle) * (avatarSize / 2 + 12);
    const dotY = avatarCenterY + Math.sin(angle) * (avatarSize / 2 + 12);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // === Text section ===
  const textX = avatarX + avatarSize + 35;

  // Type label badge
  ctx.save();
  drawRoundedRect(ctx, textX, 40, 100, 24, 12);
  ctx.fillStyle = `rgba(${isChat ? '0, 180, 216' : '233, 69, 96'}, 0.15)`;
  ctx.fill();
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = 'bold 11px "Jacatra", Arial, sans-serif';
  ctx.fillStyle = theme.primary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(theme.label, textX + 50, 52);
  ctx.restore();

  // Rank position badge (if available)
  if (data.rank) {
    const rankText = `#${data.rank}`;
    const rankTotal = data.totalUsers ? `/${data.totalUsers}` : '';
    ctx.save();
    drawRoundedRect(ctx, textX + 115, 40, 80, 24, 12);
    ctx.fillStyle = 'rgba(255, 215, 0, 0.15)';
    ctx.fill();
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`RANK ${rankText}${rankTotal}`, textX + 155, 52);
    ctx.restore();
  }

  // Username
  const displayName = member.displayName.length > 18
    ? member.displayName.substring(0, 18) + '...'
    : member.displayName;
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(displayName, textX, 90);

  // Decorative dots after username
  const nameWidth = ctx.measureText(displayName).width;
  drawDecorativeDots(ctx, textX + nameWidth + 12, 82, 3, 6, theme.primary);

  // Stats text (no emoji — font default tidak support emoji, pakai text label aja)
  const statsText = isChat
    ? `${(data.messages || 0).toLocaleString()} messages`
    : `${(data.minutes || 0).toLocaleString()} min in voice`;
  ctx.font = '16px Arial, sans-serif';
  ctx.fillStyle = '#a0a0b0';
  ctx.fillText(statsText, textX, 115);

  // Streak info
  const streakText = data.streak
    ? `${data.streak} day streak · ${data.streakMultiplier}x bonus`
    : 'Start your streak today!';
  ctx.font = '14px Arial, sans-serif';
  ctx.fillStyle = data.streak ? theme.secondary : '#666680';
  ctx.fillText(streakText, textX, 138);

  // === Level badge (right side) ===
  const levelText = `${data.level}`;
  ctx.save();

  // "LEVEL" label di atas angka (right-aligned)
  ctx.font = 'bold 11px Arial, sans-serif';
  ctx.fillStyle = '#666680';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('LEVEL', CARD_WIDTH - 55, 56);

  // Angka level
  ctx.font = 'bold 48px "LevelUp", Arial, sans-serif';
  ctx.shadowColor = theme.primary;
  ctx.shadowBlur = 20;
  ctx.fillStyle = theme.primary;
  ctx.fillText(levelText, CARD_WIDTH - 55, 96);
  ctx.shadowBlur = 0;
  ctx.restore();

  // XP text
  const xpText = `${data.xp.toLocaleString()} / ${xpNeeded.toLocaleString()} XP`;
  ctx.font = 'bold 16px Arial, sans-serif';
  ctx.fillStyle = '#a0a0b0';
  ctx.textAlign = 'right';
  ctx.fillText(xpText, CARD_WIDTH - 55, 115);

  // === Progress bar ===
  const barX = textX;
  const barY = 160;
  const barWidth = CARD_WIDTH - barX - 55;
  const barHeight = 22;
  const progress = Math.min(data.xp / xpNeeded, 1);

  // Bar background
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, barHeight / 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();

  // Bar track border
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, barHeight / 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Filled bar
  if (progress > 0) {
    const filledWidth = Math.max(barWidth * progress, barHeight);

    // Glow under bar
    ctx.save();
    ctx.shadowColor = theme.primary;
    ctx.shadowBlur = 15;
    drawRoundedRect(ctx, barX, barY, filledWidth, barHeight, barHeight / 2);
    const barGradient = ctx.createLinearGradient(barX, 0, barX + filledWidth, 0);
    barGradient.addColorStop(0, theme.primary);
    barGradient.addColorStop(0.5, theme.secondary);
    barGradient.addColorStop(1, isChat ? '#90e0ef' : '#ff8fa3');
    ctx.fillStyle = barGradient;
    ctx.fill();
    ctx.restore();

    // Shine effect (top half highlight)
    ctx.save();
    drawRoundedRect(ctx, barX, barY, filledWidth, barHeight / 2, barHeight / 4);
    const shineGradient = ctx.createLinearGradient(0, barY, 0, barY + barHeight / 2);
    shineGradient.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
    shineGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = shineGradient;
    ctx.fill();
    ctx.restore();
  }

  // Progress percentage
  const percentText = `${Math.floor(progress * 100)}%`;
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(percentText, barX + barWidth / 2, barY + barHeight + 18);

  // XP remaining text
  const xpRemaining = Math.max(0, xpNeeded - data.xp);
  const remainingText = `${xpRemaining.toLocaleString()} XP to next level`;
  ctx.font = '11px Arial, sans-serif';
  ctx.fillStyle = '#666680';
  ctx.textAlign = 'right';
  ctx.fillText(remainingText, CARD_WIDTH - 55, barY + barHeight + 18);

  // === Footer decorative elements ===
  // Brand label
  ctx.save();
  ctx.font = 'bold 10px Arial, sans-serif';
  ctx.fillStyle = `rgba(${isChat ? '0, 180, 216' : '233, 69, 96'}, 0.45)`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MURPHY LVL', cardX + 18, cardY + cardH - 12);
  ctx.restore();

  // Decorative stars
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = theme.primary;
  drawStar(ctx, CARD_WIDTH - 105, cardY + cardH - 12, 5, 5, 2);
  ctx.fill();
  drawStar(ctx, CARD_WIDTH - 90, cardY + cardH - 12, 5, 3, 1);
  ctx.fill();
  drawStar(ctx, CARD_WIDTH - 75, cardY + cardH - 12, 5, 5, 2);
  ctx.fill();
  ctx.restore();

  // User ID tag
  ctx.font = 'bold 9px Arial, sans-serif';
  ctx.fillStyle = '#444455';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`ID: ${member.id.slice(-6)}`, CARD_WIDTH - 40, cardY + cardH - 12);

  return canvas.toBuffer('image/png');
}

module.exports = { createRankCard };
