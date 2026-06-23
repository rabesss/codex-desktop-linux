# Codex Desktop Linux Overlay Design System

## 1. Atmosphere & Identity

This project preserves the official Codex Desktop interface while making Linux
behavior reliable. Its visual signature is therefore inherited fidelity: added
metadata and controls must look and behave like native Codex surfaces.

## 2. Color

The overlay introduces no colors. All surfaces, text, borders, accents, and
status colors inherit the official Codex Desktop theme tokens.

## 3. Typography

The overlay introduces no typography scale or font family. Labels, tooltips,
and metadata use the official component typography without overrides.

## 4. Spacing & Layout

The overlay introduces no layout primitives or spacing values. Patched controls
retain the official component structure and its responsive behavior.

## 5. Components

### Model option tooltip

- **Structure**: the official model option tooltip with additional text lines.
- **Content**: provider, display name, upstream model, capabilities, reasoning
  levels, context window, auto-compaction limit, truncation limit, and source.
- **States and accessibility**: inherited from the official tooltip component.
- **Motion and spacing**: unchanged from upstream.

### Provider-grouped model submenu

- **Structure**: the official model submenu, with native dropdown title and
  separator primitives inserted between provider groups.
- **Content**: group labels come from `providerDisplayName` / provider
  metadata. If the upstream dropdown normalizes row props before rendering,
  Desktop may recover the provider label from the generated
  `<model> via <provider>.` description. Primary model labels stay
  route-neutral and do not reintroduce `provider / model` prefixes.
- **States and accessibility**: inherited from the official dropdown item,
  title, and separator components.
- **Motion and spacing**: unchanged from upstream.

## 6. Motion & Interaction

The overlay adds no motion. Hover, focus, keyboard, reduced-motion, loading,
empty, and error behavior remain owned by official Codex components.

## 7. Depth & Surface

Depth and surface treatment are inherited from the official Codex Desktop
theme. Overlay patches must not add independent borders, shadows, or elevation.
