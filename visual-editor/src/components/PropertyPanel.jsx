import React, { useState } from 'react';
import { PROPERTY_DEFS, ELEMENT_META } from '../layoutConfig';

/**
 * Number input with increment/decrement buttons.
 */
function NumberControl({ value, onChange, min = 0, max = 9999, step = 1 }) {
  const handleChange = (newVal) => {
    const clamped = Math.max(min, Math.min(max, Number(newVal) || 0));
    onChange(clamped);
  };

  return (
    <div className="prop-number-control">
      <button
        className="prop-number-btn"
        onClick={() => handleChange(value - step)}
        type="button"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        min={min}
        max={max}
      />
      <button
        className="prop-number-btn"
        onClick={() => handleChange(value + step)}
        type="button"
      >
        +
      </button>
    </div>
  );
}

/**
 * Color picker with swatch preview.
 */
function ColorControl({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <div className="prop-color-swatch" style={{ background: value }}>
        <input
          type="color"
          className="prop-color-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <input
        className="prop-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
      />
    </div>
  );
}

/**
 * Theme color editor sub-panel.
 */
function ThemeEditor({ theme, onChange }) {
  const handleThemeChange = (type, key, value) => {
    const updated = {
      ...theme,
      [type]: { ...theme[type], [key]: value },
    };
    onChange(updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {['chat', 'voice'].map((type) => (
        <div key={type}>
          <div
            className="prop-group-header"
            style={{ cursor: 'default', marginBottom: 4 }}
          >
            <span className="prop-group-title">
              {type === 'chat' ? '🔵 Chat Theme' : '🔴 Voice Theme'}
            </span>
          </div>
          <div className="prop-group-body">
            <div className="prop-row">
              <span className="prop-label">Primary</span>
              <ColorControl
                value={theme[type].blue}
                onChange={(v) => handleThemeChange(type, 'blue', v)}
              />
            </div>
            <div className="prop-row">
              <span className="prop-label">Light</span>
              <ColorControl
                value={theme[type].lightBlue}
                onChange={(v) => handleThemeChange(type, 'lightBlue', v)}
              />
            </div>
            <div className="prop-row">
              <span className="prop-label">Label</span>
              <input
                className="prop-input"
                type="text"
                value={theme[type].label}
                onChange={(e) => handleThemeChange(type, 'label', e.target.value)}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Right panel showing properties of the selected element.
 */
export default function PropertyPanel({ selected, layout, onUpdate }) {
  const [openGroups, setOpenGroups] = useState({ position: true, appearance: true, options: true });

  if (!selected) {
    return (
      <div className="panel-right">
        <div className="panel-header">
          <span className="panel-header-title">Properties</span>
        </div>
        <div className="no-selection">
          <div className="no-selection-icon">🎯</div>
          <div className="no-selection-title">No element selected</div>
          <div className="no-selection-hint">
            Click an element in the left panel or on the canvas to edit its properties
          </div>
        </div>
      </div>
    );
  }

  const meta = ELEMENT_META.find((e) => e.key === selected);
  const props = PROPERTY_DEFS[selected] || [];
  const data = layout[selected];

  // Special case: theme
  if (selected === 'theme') {
    return (
      <div className="panel-right">
        <div className="panel-header">
          <span className="panel-header-title">
            {meta?.icon} {meta?.label || selected}
          </span>
        </div>
        <div className="panel-body">
          <ThemeEditor
            theme={layout.theme}
            onChange={(newTheme) => onUpdate('theme', newTheme)}
          />
        </div>
      </div>
    );
  }

  // Group properties
  const positionProps = props.filter((p) => ['x', 'y', 'width', 'height', 'size', 'dividerX'].includes(p.key));
  const appearanceProps = props.filter((p) => ['color', 'bgColor', 'outlineColor', 'fontSize', 'text', 'font'].includes(p.key));
  const booleanProps = props.filter((p) => p.type === 'boolean');

  const handleChange = (key, value) => {
    onUpdate(selected, { ...data, [key]: value });
  };

  const renderProp = (prop) => {
    const val = data[prop.key];

    if (prop.type === 'boolean') {
      return (
        <div key={prop.key} className="prop-checkbox" onClick={() => handleChange(prop.key, !val)}>
          <div className={`prop-checkbox-box ${val ? 'checked' : ''}`}>
            {val ? '✓' : ''}
          </div>
          <span className="prop-checkbox-label">{prop.label}</span>
        </div>
      );
    }

    if (prop.type === 'number') {
      return (
        <div key={prop.key} className="prop-row">
          <span className="prop-label">{prop.label}</span>
          <NumberControl
            value={val}
            onChange={(v) => handleChange(prop.key, v)}
            min={prop.min}
            max={prop.max}
          />
        </div>
      );
    }

    if (prop.type === 'color') {
      return (
        <div key={prop.key} className="prop-row">
          <span className="prop-label">{prop.label}</span>
          <ColorControl value={val} onChange={(v) => handleChange(prop.key, v)} />
        </div>
      );
    }

    if (prop.type === 'text') {
      return (
        <div key={prop.key} className="prop-row">
          <span className="prop-label">{prop.label}</span>
          <input
            className="prop-input"
            type="text"
            value={val}
            onChange={(e) => handleChange(prop.key, e.target.value)}
          />
        </div>
      );
    }

    return null;
  };

  const toggleGroup = (group) => {
    setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <div className="panel-right">
      <div className="panel-header">
        <span className="panel-header-title">
          {meta?.icon} {meta?.label || selected}
        </span>
      </div>
      <div className="panel-body">
        {/* Position properties */}
        {positionProps.length > 0 && (
          <div className="prop-group">
            <div className="prop-group-header" onClick={() => toggleGroup('position')}>
              <span className="prop-group-title">Position & Size</span>
              <span className={`prop-group-chevron ${openGroups.position ? 'open' : ''}`}>▶</span>
            </div>
            {openGroups.position && (
              <div className="prop-group-body">{positionProps.map(renderProp)}</div>
            )}
          </div>
        )}

        {/* Appearance properties */}
        {appearanceProps.length > 0 && (
          <div className="prop-group">
            <div className="prop-group-header" onClick={() => toggleGroup('appearance')}>
              <span className="prop-group-title">Appearance</span>
              <span className={`prop-group-chevron ${openGroups.appearance ? 'open' : ''}`}>▶</span>
            </div>
            {openGroups.appearance && (
              <div className="prop-group-body">{appearanceProps.map(renderProp)}</div>
            )}
          </div>
        )}

        {/* Boolean toggles */}
        {booleanProps.length > 0 && (
          <div className="prop-group">
            <div className="prop-group-header" onClick={() => toggleGroup('options')}>
              <span className="prop-group-title">Options</span>
              <span className={`prop-group-chevron ${openGroups.options ? 'open' : ''}`}>▶</span>
            </div>
            {openGroups.options && (
              <div className="prop-group-body">{booleanProps.map(renderProp)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
