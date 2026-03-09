import React from "react";

import { butoTheme } from "./theme.ts";

export function StatusBadge(props: { label: string; tone?: "default" | "danger" | "warning" | "brand" }) {
  const tone = props.tone ?? "default";
  const palette = {
    default: { background: "#f5f5f4", color: butoTheme.colors.ink },
    danger: { background: "#fee2e2", color: butoTheme.colors.danger },
    warning: { background: "#fef3c7", color: butoTheme.colors.caution },
    brand: { background: butoTheme.colors.brandSoft, color: butoTheme.colors.brand }
  }[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: butoTheme.radius.pill,
        padding: "6px 10px",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        background: palette.background,
        color: palette.color
      }}
    >
      {props.label}
    </span>
  );
}

