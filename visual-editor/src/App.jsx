import { useState, useCallback, useRef } from 'react';
import './App.css';
import { DEFAULT_LAYOUT } from './layoutConfig';
import ElementTree from './components/ElementTree';
import CanvasPreview from './components/CanvasPreview';
import PropertyPanel from './components/PropertyPanel';

function App() {
  // ── State ──
  const [layout, setLayout] = useState(() => {
    // Try to load from localStorage
    try {
      const saved = localStorage.getItem('murphy-layout');
      if (saved) return JSON.parse(saved);
    } catch {}
    return structuredClone(DEFAULT_LAYOUT);
  });

  const [selected, setSelected] = useState(null);
  const [themeType, setThemeType] = useState('chat');
  const [zoom, setZoom] = useState(1.2);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);
  const toastTimer = useRef(null);

  // ── Toast helper ──
  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // ── Layout update handlers ──
  const handleUpdateElement = useCallback((key, value) => {
    setLayout((prev) => {
      const updated = { ...prev, [key]: value };
      localStorage.setItem('murphy-layout', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleToggleElement = useCallback((key, enabled) => {
    setLayout((prev) => {
      const updated = {
        ...prev,
        [key]: { ...prev[key], enabled },
      };
      localStorage.setItem('murphy-layout', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleDragMove = useCallback((key, newX, newY) => {
    setLayout((prev) => {
      const updated = {
        ...prev,
        [key]: { ...prev[key], x: newX, y: newY },
      };
      localStorage.setItem('murphy-layout', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── File operations ──
  const handleSave = useCallback(() => {
    const json = JSON.stringify(layout, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'layout.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('✓ Layout exported as layout.json');
  }, [layout, showToast]);

  const handleLoad = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          // Basic validation
          if (parsed.card && parsed.avatar && parsed.title) {
            setLayout(parsed);
            localStorage.setItem('murphy-layout', JSON.stringify(parsed));
            showToast('✓ Layout loaded successfully');
          } else {
            showToast('⚠ Invalid layout file');
          }
        } catch {
          showToast('⚠ Failed to parse JSON file');
        }
      };
      reader.readAsText(file);
      e.target.value = ''; // reset
    },
    [showToast]
  );

  const handleReset = useCallback(() => {
    setLayout(structuredClone(DEFAULT_LAYOUT));
    localStorage.removeItem('murphy-layout');
    setSelected(null);
    showToast('↺ Layout reset to default');
  }, [showToast]);

  // ── Zoom controls ──
  const zoomIn = () => setZoom((z) => Math.min(z + 0.1, 2.5));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.5));
  const zoomReset = () => setZoom(1.2);

  return (
    <>
      {/* ── Top Bar ── */}
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-logo">M</div>
          <span className="topbar-title">Murphy Level</span>
          <span className="topbar-subtitle">Visual Editor</span>
        </div>
        <div className="topbar-actions">
          <button
            className="topbar-btn secondary"
            onClick={handleLoad}
            title="Import layout.json"
          >
            📂 Import
          </button>
          <button
            className="topbar-btn primary"
            onClick={handleSave}
            title="Export layout.json"
          >
            💾 Export
          </button>
          <div className="topbar-divider" />
          <button
            className="topbar-btn danger"
            onClick={handleReset}
            title="Reset to defaults"
          >
            ↺ Reset
          </button>
        </div>
      </header>

      {/* ── Editor Layout ── */}
      <div className="editor-layout">
        {/* Left: Element Tree */}
        <ElementTree
          layout={layout}
          selected={selected}
          onSelect={setSelected}
          onToggle={handleToggleElement}
        />

        {/* Center: Canvas */}
        <div className="canvas-area">
          {/* Theme switcher */}
          <div className="theme-switcher">
            <button
              className={`theme-btn ${themeType === 'chat' ? 'active chat' : ''}`}
              onClick={() => setThemeType('chat')}
            >
              Chat
            </button>
            <button
              className={`theme-btn ${themeType === 'voice' ? 'active voice' : ''}`}
              onClick={() => setThemeType('voice')}
            >
              Voice
            </button>
          </div>

          {/* Canvas */}
          <CanvasPreview
            layout={layout}
            themeType={themeType}
            selected={selected}
            onSelect={setSelected}
            onDragMove={handleDragMove}
            zoom={zoom}
          />

          {/* Bottom toolbar */}
          <div className="canvas-toolbar">
            <button
              className="canvas-toolbar-btn"
              onClick={zoomOut}
              title="Zoom out"
            >
              −
            </button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button
              className="canvas-toolbar-btn"
              onClick={zoomIn}
              title="Zoom in"
            >
              +
            </button>
            <div className="canvas-toolbar-divider" />
            <button
              className="canvas-toolbar-btn"
              onClick={zoomReset}
              title="Reset zoom"
            >
              ⊡
            </button>
          </div>
        </div>

        {/* Right: Property Panel */}
        <PropertyPanel
          selected={selected}
          layout={layout}
          onUpdate={handleUpdateElement}
        />
      </div>

      {/* ── Status Bar ── */}
      <footer className="statusbar">
        <div className="statusbar-left">
          <div className="statusbar-item">
            <span className="statusbar-dot" />
            <span>Ready</span>
          </div>
          <span className="statusbar-item">
            Card: {layout.card.width} × {layout.card.height}
          </span>
        </div>
        <div className="statusbar-right">
          <span className="statusbar-item">
            Theme: {themeType === 'chat' ? 'Chat' : 'Voice'}
          </span>
          {selected && (
            <span className="statusbar-item">
              Selected: {selected}
            </span>
          )}
        </div>
      </footer>

      {/* ── Toast ── */}
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  );
}

export default App;
