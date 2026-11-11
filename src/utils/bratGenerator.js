const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const path = require('path');

// Register Arial Narrow (Brat Font) dari folder assets agar tampilan identik di Windows maupun Linux server
try {
  GlobalFonts.registerFromPath(path.join(__dirname, '..', '..', 'assets', 'brat-font.ttf'), 'BratFont');
} catch (e) {
  console.warn('Warning: Could not register BratFont:', e.message);
}

const BRAT_THEMES = {
  white: {
    bg: '#FFFFFF',
    fg: '#000000',
    label: 'Putih (Classic WA/Discord)',
  },
  green: {
    bg: '#8ACE00',
    fg: '#000000',
    label: 'Hijau Lime (Charli XCX BRAT)',
  },
  black: {
    bg: '#000000',
    fg: '#FFFFFF',
    label: 'Hitam (Dark Mode)',
  },
  pink: {
    bg: '#FD89C7',
    fg: '#000000',
    label: 'Pink (Brat Remix)',
  },
};

const CANVAS_SIZE = 500;
const PADDING = 38;
const MAX_TEXT_WIDTH = CANVAS_SIZE - PADDING * 2;
const MAX_TEXT_HEIGHT = CANVAS_SIZE - PADDING * 2;

/**
 * Parse teks & flag opsi dari input user (misal: "--green", "--gif", "--hitam")
 */
function parseBratArgs(rawText, forceGif = false) {
  let theme = 'white';
  let isGif = Boolean(forceGif);

  const tokens = String(rawText || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const cleanTokens = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (['--green', '--hijau', '--lime', '-g'].includes(lower)) {
      theme = 'green';
    } else if (['--white', '--putih', '-w'].includes(lower)) {
      theme = 'white';
    } else if (['--black', '--dark', '--hitam', '-b', '-d'].includes(lower)) {
      theme = 'black';
    } else if (['--pink', '-p'].includes(lower)) {
      theme = 'pink';
    } else if (['--gif', '--anim', '--animasi', '-a'].includes(lower)) {
      isGif = true;
    } else {
      cleanTokens.push(token);
    }
  }

  return {
    text: cleanTokens.join(' ').trim(),
    theme,
    isGif,
  };
}

/**
 * Bungkus kata-kata menjadi baris-baris sesuai lebar maksimum pada ukuran font tertentu
 */
function wrapWords(ctx, words, fontSize) {
  ctx.font = `500 ${fontSize}px "BratFont", "Arial Narrow", Arial, sans-serif`;
  const spaceWidth = ctx.measureText(' ').width * 0.9;
  const lines = [];
  let currentLine = [];
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = ctx.measureText(word).width;
    // Jika satu kata sendiri melebihi lebar kotak, paksa ukuran font lebih kecil dengan menandai overflow
    if (wordWidth > MAX_TEXT_WIDTH) {
      return { lines: [], overflow: true };
    }

    if (currentLine.length === 0) {
      currentLine.push({ word, width: wordWidth });
      currentWidth = wordWidth;
    } else if (currentWidth + spaceWidth + wordWidth <= MAX_TEXT_WIDTH) {
      currentLine.push({ word, width: wordWidth });
      currentWidth += spaceWidth + wordWidth;
    } else {
      lines.push(currentLine);
      currentLine = [{ word, width: wordWidth }];
      currentWidth = wordWidth;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  const lineHeight = fontSize * 1.12;
  const totalHeight = lines.length * lineHeight;
  const overflow = totalHeight > MAX_TEXT_HEIGHT;

  return { lines, lineHeight, totalHeight, overflow };
}

/**
 * Cari ukuran font terbaik agar teks memenuhi kotak dengan proporsional ala stiker Brat
 */
function computeBestLayout(ctx, text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { fontSize: 64, lines: [], lineHeight: 72, totalHeight: 0, words: [] };
  }

  // Batas maksimum font tergantung jumlah kata agar tidak terlalu raksasa untuk 1 kata pendek
  const maxFont = words.length === 1 ? 135 : words.length <= 3 ? 115 : 100;
  const minFont = 22;

  let bestFont = minFont;
  let bestWrapped = null;

  for (let size = maxFont; size >= minFont; size -= 2) {
    const wrapped = wrapWords(ctx, words, size);
    if (!wrapped.overflow) {
      bestFont = size;
      bestWrapped = wrapped;
      break;
    }
  }

  // Jika teks sangat panjang hingga ukuran minimum masih overflow, tetap bungkus paksa di minFont
  if (!bestWrapped) {
    ctx.font = `500 ${minFont}px "BratFont", "Arial Narrow", Arial, sans-serif`;
    const spaceWidth = ctx.measureText(' ').width * 0.85;
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    for (const word of words) {
      const wordWidth = Math.min(MAX_TEXT_WIDTH, ctx.measureText(word).width);
      if (currentLine.length === 0) {
        currentLine.push({ word, width: wordWidth });
        currentWidth = wordWidth;
      } else if (currentWidth + spaceWidth + wordWidth <= MAX_TEXT_WIDTH) {
        currentLine.push({ word, width: wordWidth });
        currentWidth += spaceWidth + wordWidth;
      } else {
        lines.push(currentLine);
        currentLine = [{ word, width: wordWidth }];
        currentWidth = wordWidth;
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);
    const lineHeight = minFont * 1.1;
    bestWrapped = {
      lines,
      lineHeight,
      totalHeight: lines.length * lineHeight,
      overflow: false,
    };
  }

  return {
    fontSize: bestFont,
    lines: bestWrapped.lines,
    lineHeight: bestWrapped.lineHeight,
    totalHeight: bestWrapped.totalHeight,
    words,
  };
}

/**
 * Gambar 1 frame Brat ke canvas 500x500 lengkap dengan efek low-res blur khas BRAT
 */
function renderBratFrameToCanvas(text, themeKey = 'white') {
  const theme = BRAT_THEMES[themeKey] || BRAT_THEMES.white;

  // 1. Canvas utama untuk menggambar teks tajam terlebih dahulu
  const sharpCanvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const sctx = sharpCanvas.getContext('2d');

  // Background
  sctx.fillStyle = theme.bg;
  sctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const layout = computeBestLayout(sctx, text);
  const { fontSize, lines, lineHeight, totalHeight, words } = layout;

  sctx.fillStyle = theme.fg;
  sctx.font = `500 ${fontSize}px "BratFont", "Arial Narrow", Arial, sans-serif`;
  sctx.textBaseline = 'top';

  // Posisi Y: jika cuma 1-2 kata kita taruh agak tengah, jika kalimat panjang mulai dari atas/tengah proporsional
  const startY =
    words.length <= 2
      ? Math.max(PADDING, (CANVAS_SIZE - totalHeight) / 2 - fontSize * 0.08)
      : Math.max(PADDING, Math.min(PADDING + 14, (CANVAS_SIZE - totalHeight) / 2));

  lines.forEach((lineItems, lineIdx) => {
    const y = startY + lineIdx * lineHeight;

    // Jika total keseluruhan hanya 1 kata, taruh di tengah horizontal
    if (words.length === 1 && lineItems.length === 1) {
      const item = lineItems[0];
      const x = Math.max(PADDING, (CANVAS_SIZE - item.width) / 2);
      sctx.fillText(item.word, x, y);
      return;
    }

    // Jika baris hanya punya 1 kata (misal baris terakhir), rata kiri
    if (lineItems.length === 1) {
      sctx.fillText(lineItems[0].word, PADDING, y);
      return;
    }

    // Jika baris punya >= 2 kata, buat rata kiri-kanan (justify penuh ala Brat Generator)
    const totalWordsWidth = lineItems.reduce((acc, it) => acc + it.width, 0);
    const totalGap = MAX_TEXT_WIDTH - totalWordsWidth;
    const gapBetween = totalGap / (lineItems.length - 1);

    let cursorX = PADDING;
    lineItems.forEach((item) => {
      sctx.fillText(item.word, cursorX, y);
      cursorX += item.width + gapBetween;
    });
  });

  // 2. Efek khas BRAT: Downscale ke resolusi rendah lalu upscale kembali dengan blur lembut
  const lowResSize = 215;
  const lowCanvas = createCanvas(lowResSize, lowResSize);
  const lctx = lowCanvas.getContext('2d');
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = 'medium';
  lctx.drawImage(sharpCanvas, 0, 0, lowResSize, lowResSize);

  const finalCanvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const fctx = finalCanvas.getContext('2d');
  fctx.fillStyle = theme.bg;
  fctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = 'high';
  try {
    fctx.filter = 'blur(0.8px)';
  } catch {
    // Abaikan jika environment tidak mendukung filter CSS
  }
  fctx.drawImage(lowCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

  return finalCanvas;
}

/**
 * Generate gambar Brat statis (PNG Buffer)
 */
function generateBratPng(text, themeKey = 'white') {
  const canvas = renderBratFrameToCanvas(text, themeKey);
  return canvas.toBuffer('image/png');
}

/**
 * Generate animasi Brat GIF (kata muncul satu per satu ala stiker WA/Discord)
 */
function generateBratGif(text, themeKey = 'white') {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Batasi maksimal 25 langkah frame agar proses render GIF tetap cepat & ukuran file ringan
  const maxFrames = 25;
  const step = Math.max(1, Math.ceil(words.length / maxFrames));

  const encoder = new GIFEncoder(CANVAS_SIZE, CANVAS_SIZE, 'neuquant', true);
  encoder.start();
  encoder.setRepeat(0); // Loop selamanya
  encoder.setDelay(380); // 380ms per kata
  encoder.setQuality(10);

  for (let i = step; i < words.length; i += step) {
    const partialText = words.slice(0, i).join(' ');
    const frameCanvas = renderBratFrameToCanvas(partialText, themeKey);
    const ctx = frameCanvas.getContext('2d');
    encoder.addFrame(ctx);
  }

  // Frame terakhir (teks penuh) ditahan lebih lama (2 frame ekstra) supaya enak dibaca
  const finalCanvas = renderBratFrameToCanvas(words.join(' '), themeKey);
  const finalCtx = finalCanvas.getContext('2d');
  encoder.addFrame(finalCtx);
  encoder.addFrame(finalCtx);

  encoder.finish();
  return encoder.out.getData();
}

module.exports = {
  BRAT_THEMES,
  parseBratArgs,
  generateBratPng,
  generateBratGif,
};
