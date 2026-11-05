// Default layout matching the bot's layout.json structure
export const DEFAULT_LAYOUT = {
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

// Element metadata for the UI
export const ELEMENT_META = [
  { key: 'card', label: 'Card', icon: '🖼️', category: 'layout' },
  { key: 'avatar', label: 'Avatar', icon: '👤', category: 'content' },
  { key: 'title', label: 'Title', icon: '✏️', category: 'content' },
  { key: 'username', label: 'Username', icon: '🏷️', category: 'content' },
  { key: 'levelBox', label: 'Level Box', icon: '📊', category: 'content' },
  { key: 'typeBadge', label: 'Type Badge', icon: '🔖', category: 'content' },
  { key: 'decor', label: 'Decorations', icon: '✨', category: 'decor' },
  { key: 'theme', label: 'Theme', icon: '🎨', category: 'theme' },
];

// Property definitions for each element
export const PROPERTY_DEFS = {
  card: [
    { key: 'width', label: 'Width', type: 'number', min: 300, max: 1200 },
    { key: 'height', label: 'Height', type: 'number', min: 100, max: 600 },
    { key: 'bgColor', label: 'Background', type: 'color' },
  ],
  avatar: [
    { key: 'enabled', label: 'Visible', type: 'boolean' },
    { key: 'x', label: 'X', type: 'number', min: 0, max: 1200 },
    { key: 'y', label: 'Y', type: 'number', min: 0, max: 600 },
    { key: 'size', label: 'Size', type: 'number', min: 20, max: 200 },
    { key: 'showRing', label: 'Show Ring', type: 'boolean' },
    { key: 'showPulse', label: 'Show Pulse', type: 'boolean' },
  ],
  title: [
    { key: 'enabled', label: 'Visible', type: 'boolean' },
    { key: 'text', label: 'Text', type: 'text' },
    { key: 'x', label: 'X', type: 'number', min: 0, max: 1200 },
    { key: 'y', label: 'Y', type: 'number', min: 0, max: 600 },
    { key: 'fontSize', label: 'Font Size', type: 'number', min: 8, max: 120 },
    { key: 'color', label: 'Color', type: 'color' },
    { key: 'outlineColor', label: 'Outline', type: 'color' },
  ],
  username: [
    { key: 'enabled', label: 'Visible', type: 'boolean' },
    { key: 'x', label: 'X', type: 'number', min: 0, max: 1200 },
    { key: 'y', label: 'Y', type: 'number', min: 0, max: 600 },
    { key: 'fontSize', label: 'Font Size', type: 'number', min: 8, max: 60 },
    { key: 'color', label: 'Color', type: 'color' },
  ],
  levelBox: [
    { key: 'enabled', label: 'Visible', type: 'boolean' },
    { key: 'x', label: 'X', type: 'number', min: 0, max: 1200 },
    { key: 'y', label: 'Y', type: 'number', min: 0, max: 600 },
    { key: 'width', label: 'Width', type: 'number', min: 20, max: 400 },
    { key: 'height', label: 'Height', type: 'number', min: 10, max: 100 },
    { key: 'fontSize', label: 'Font Size', type: 'number', min: 8, max: 60 },
    { key: 'color', label: 'Color', type: 'color' },
  ],
  typeBadge: [
    { key: 'enabled', label: 'Visible', type: 'boolean' },
    { key: 'x', label: 'X', type: 'number', min: 0, max: 1200 },
    { key: 'y', label: 'Y', type: 'number', min: 0, max: 600 },
    { key: 'width', label: 'Width', type: 'number', min: 20, max: 300 },
    { key: 'height', label: 'Height', type: 'number', min: 10, max: 60 },
    { key: 'fontSize', label: 'Font Size', type: 'number', min: 6, max: 30 },
  ],
  decor: [
    { key: 'showCornerAccents', label: 'Corner Accents', type: 'boolean' },
    { key: 'showGrid', label: 'Perspective Grid', type: 'boolean' },
    { key: 'showLabels', label: 'Labels', type: 'boolean' },
    { key: 'showBarcode', label: 'Barcode', type: 'boolean' },
    { key: 'showParticles', label: 'Particles', type: 'boolean' },
    { key: 'showDivider', label: 'Divider', type: 'boolean' },
    { key: 'dividerX', label: 'Divider X', type: 'number', min: 0, max: 700 },
  ],
  theme: [],
};
