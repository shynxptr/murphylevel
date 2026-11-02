import React from 'react';
import { ELEMENT_META } from '../layoutConfig';

/**
 * Left panel showing the list of card elements.
 * Click to select, toggle to show/hide.
 */
export default function ElementTree({ layout, selected, onSelect, onToggle }) {
  const contentElements = ELEMENT_META.filter((e) => e.category === 'content');
  const decorElements = ELEMENT_META.filter((e) => e.category === 'decor' || e.category === 'theme');
  const layoutElements = ELEMENT_META.filter((e) => e.category === 'layout');

  const renderItem = (el) => {
    const isSelected = selected === el.key;
    const elementData = layout[el.key];
    const hasEnabled = elementData && typeof elementData.enabled === 'boolean';
    const isEnabled = hasEnabled ? elementData.enabled : true;

    return (
      <div
        key={el.key}
        className={`element-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelect(el.key)}
      >
        <div className="element-icon" style={{ opacity: isEnabled ? 1 : 0.4 }}>
          {el.icon}
        </div>
        <span className="element-name" style={{ opacity: isEnabled ? 1 : 0.5 }}>
          {el.label}
        </span>
        {hasEnabled && (
          <div
            className={`element-toggle ${isEnabled ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(el.key, !isEnabled);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div className="panel-left">
      <div className="panel-header">
        <span className="panel-header-title">Elements</span>
      </div>
      <div className="panel-body">
        <div style={{ marginBottom: 8 }}>
          <div className="prop-group-header" style={{ cursor: 'default' }}>
            <span className="prop-group-title">Layout</span>
          </div>
          {layoutElements.map(renderItem)}
        </div>
        <div style={{ marginBottom: 8 }}>
          <div className="prop-group-header" style={{ cursor: 'default' }}>
            <span className="prop-group-title">Content</span>
          </div>
          {contentElements.map(renderItem)}
        </div>
        <div>
          <div className="prop-group-header" style={{ cursor: 'default' }}>
            <span className="prop-group-title">Style</span>
          </div>
          {decorElements.map(renderItem)}
        </div>
      </div>
    </div>
  );
}
