import React from "react";

import { butoTheme } from "./theme.ts";

export function SafetyCard(props: { title: string; body: string }) {
  return (
    <article
      style={{
        borderRadius: butoTheme.radius.card,
        background: "#ffffff",
        padding: 20,
        border: `1px solid ${butoTheme.colors.line}`,
        boxShadow: butoTheme.shadow
      }}
    >
      <h3 style={{ margin: "0 0 10px", color: butoTheme.colors.ink }}>{props.title}</h3>
      <p style={{ margin: 0, lineHeight: 1.6, color: "#44403c" }}>{props.body}</p>
    </article>
  );
}

