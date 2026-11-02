import React, { useRef, useEffect, useState, useCallback } from 'react';
import { renderCard, getElementBounds } from '../cardRenderer';

/**
 * Interactive canvas with live preview and draggable element overlays.
 */
export default function CanvasPreview({
  layout,
  themeType,
  selected,
  onSelect,
  onDragMove,
  zoom,
}) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const [dragging, setDragging] = useState(null); // { key, startX, startY, origX, origY }

  // ── Render card whenever layout or theme changes ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = layout.card.width;
    canvas.height = layout.card.height;
    const ctx = canvas.getContext('2d');
    renderCard(ctx, layout, themeType);
  }, [layout, themeType]);

  // ── Get element bounds for overlays ──
  const bounds = getElementBounds(layout);

  // ── Mouse handlers for dragging ──
  const handleOverlayMouseDown = useCallback(
    (key, e) => {
      e.stopPropagation();
      e.preventDefault();
      onSelect(key);

      const el = layout[key];
      setDragging({
        key,
        startX: e.clientX,
        startY: e.clientY,
        origX: el.x,
        origY: el.y,
      });
    },
    [layout, onSelect]
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      const dx = (e.clientX - dragging.startX) / zoom;
      const dy = (e.clientY - dragging.startY) / zoom;
      const newX = Math.round(dragging.origX + dx);
      const newY = Math.round(dragging.origY + dy);
      onDragMove(dragging.key, newX, newY);
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, zoom, onDragMove]);

  // Click on canvas background = deselect
  const handleCanvasClick = (e) => {
    if (e.target === wrapperRef.current || e.target === canvasRef.current) {
      onSelect(null);
    }
  };

  const draggableKeys = ['avatar', 'title', 'username', 'levelBox', 'typeBadge'];

  return (
    <div
      ref={wrapperRef}
      className="canvas-wrapper"
      style={{ transform: `scale(${zoom})` }}
      onClick={handleCanvasClick}
    >
      <canvas ref={canvasRef} />

      {/* Draggable overlays */}
      {draggableKeys.map((key) => {
        const b = bounds[key];
        if (!b) return null;

        return (
          <div
            key={key}
            className={`drag-overlay ${selected === key ? 'selected' : ''}`}
            style={{
              left: b.x,
              top: b.y,
              width: b.width,
              height: b.height,
              cursor: dragging?.key === key ? 'grabbing' : 'grab',
            }}
            onMouseDown={(e) => handleOverlayMouseDown(key, e)}
          >
            <span className="drag-overlay-label">{key}</span>
          </div>
        );
      })}
    </div>
  );
}
