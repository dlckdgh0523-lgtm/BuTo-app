import React from "react";

import { butoTheme } from "../../../../packages/ui/src/index.ts";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  color?: "primary" | "dark" | "danger";
  variant?: "fill" | "weak";
  size?: "small" | "large" | "xlarge";
  display?: "full";
  loading?: boolean;
};

export function TDSButton(props: ButtonProps) {
  const {
    color = "dark",
    variant = "fill",
    size = "large",
    display,
    loading,
    disabled,
    children,
    style,
    ...rest
  } = props;

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{
        ...getButtonStyle(color, variant, size, display === "full"),
        opacity: disabled || loading ? 0.56 : 1,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        ...style
      }}
    >
      {loading ? "처리 중..." : children}
    </button>
  );
}

export function TDSTextButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  as?: "a" | "button";
  href?: string;
  size?: string;
}) {
  const {
    children,
    style,
    as,
    href,
    size,
    ...rest
  } = props;

  if (as === "a" && href) {
    return (
      <a
        href={href}
        style={{
          color: butoTheme.colors.brand,
          fontWeight: 700,
          fontSize: size === "small" ? 13 : 14,
          lineHeight: 1.5,
          textDecoration: "none",
          ...style
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      {...rest}
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        color: butoTheme.colors.brand,
        fontWeight: 700,
        fontSize: 14,
        lineHeight: 1.5,
        cursor: "pointer",
        ...style
      }}
    >
      {children}
    </button>
  );
}

function ListRow(props: {
  contents: React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
  border?: string;
  verticalPadding?: string;
  horizontalPadding?: string;
}) {
  return (
    <div
      onClick={props.onClick}
      role={props.onClick ? "button" : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      onKeyDown={
        props.onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                props.onClick?.();
              }
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        borderRadius: 24,
        padding: props.verticalPadding === "large" ? "16px 14px" : "12px 14px",
        background: "#ffffff",
        border: `1px solid ${butoTheme.colors.line}`,
        ...(props.onClick ? { cursor: "pointer" } : null),
        ...props.style
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>{props.contents}</div>
      {props.right ? <div style={{ flexShrink: 0 }}>{props.right}</div> : null}
    </div>
  );
}

function ListRowTexts(props: {
  type?: string;
  top: React.ReactNode;
  bottom?: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <strong style={{ color: butoTheme.colors.ink, fontSize: 15, lineHeight: 1.5 }}>{props.top}</strong>
      {props.bottom ? <span style={{ color: "#6b7280", fontSize: 13, lineHeight: 1.5 }}>{props.bottom}</span> : null}
    </div>
  );
}

export const TDSListRow = Object.assign(ListRow, {
  Texts: ListRowTexts
});

function TabRoot(props: {
  children: React.ReactNode;
  onChange(index: number): void;
  fluid?: boolean;
  size?: string;
  ariaLabel?: string;
}) {
  const items = React.Children.toArray(props.children);
  return (
    <div
      aria-label={props.ariaLabel}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))`,
        gap: 8,
        padding: 8,
        borderRadius: 24,
        background: "#ffffff",
        border: `1px solid ${butoTheme.colors.line}`
      }}
    >
      {items.map((child, index) => {
        if (!React.isValidElement(child)) {
          return null;
        }

        const itemProps = child.props as { selected?: boolean; children?: React.ReactNode };
        const selected = Boolean(itemProps.selected);
        return (
          <button
            key={index}
            type="button"
            onClick={() => props.onChange(index)}
            style={{
              border: "none",
              borderRadius: 18,
              padding: "12px 10px",
              background: selected ? butoTheme.colors.brand : "transparent",
              color: selected ? "#ffffff" : butoTheme.colors.ink,
              fontWeight: 700,
              fontSize: 14,
              lineHeight: 1.4,
              cursor: "pointer"
            }}
          >
            {itemProps.children}
          </button>
        );
      })}
    </div>
  );
}

function TabItem(props: { selected?: boolean; children: React.ReactNode }) {
  return <>{props.children}</>;
}

export const TDSTab = Object.assign(TabRoot, {
  Item: TabItem
});

function getButtonStyle(color: "primary" | "dark" | "danger", variant: "fill" | "weak", size: "small" | "large" | "xlarge", fullWidth: boolean): React.CSSProperties {
  const palette = {
    primary: variant === "fill"
      ? { background: butoTheme.colors.brand, color: "#ffffff", border: "transparent" }
      : { background: "#ecf3ff", color: butoTheme.colors.brand, border: "#d6e6ff" },
    dark: variant === "fill"
      ? { background: butoTheme.colors.ink, color: "#ffffff", border: "transparent" }
      : { background: "#f4f6fa", color: butoTheme.colors.ink, border: butoTheme.colors.line },
    danger: variant === "fill"
      ? { background: "#dc2626", color: "#ffffff", border: "transparent" }
      : { background: "#fef2f2", color: "#b91c1c", border: "#fecaca" }
  }[color];

  const sizing = {
    small: { fontSize: 13, padding: "10px 12px", borderRadius: 16 },
    large: { fontSize: 15, padding: "14px 16px", borderRadius: 18 },
    xlarge: { fontSize: 16, padding: "16px 18px", borderRadius: 20 }
  }[size];

  return {
    width: fullWidth ? "100%" : undefined,
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
    fontWeight: 700,
    lineHeight: 1.4,
    ...sizing
  };
}
