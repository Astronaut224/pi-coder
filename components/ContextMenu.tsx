"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Lightweight, reusable right-click menu. Rendered through a portal to
 * document.body so it is never clipped by ancestor overflow. It clamps itself
 * inside the viewport and closes on outside-click, Esc, scroll, or blur.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp into the viewport once the element has been measured.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const nextX = x + rect.width + margin > window.innerWidth
      ? Math.max(margin, window.innerWidth - rect.width - margin)
      : x;
    const nextY = y + rect.height + margin > window.innerHeight
      ? Math.max(margin, window.innerHeight - rect.height - margin)
      : y;
    setPos({ x: nextX, y: nextY });
  }, [x, y]);

  // Close on outside pointer-down, Esc, any scroll, or window blur.
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClose = () => onClose();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("blur", handleClose);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("blur", handleClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        minWidth: 160,
        maxWidth: 260,
        padding: "4px 0",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
        zIndex: 100000,
        fontSize: 12,
        color: "var(--text)",
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 12px",
            border: "none",
            background: "none",
            color: "var(--text)",
            textAlign: "left",
            cursor: item.disabled ? "default" : "pointer",
            fontSize: 12,
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
