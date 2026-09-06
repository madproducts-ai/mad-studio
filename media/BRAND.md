# MAD Studio — Brand Guidelines

**App name:** MAD Studio
**Domain:** https://studio.madproducts.ai
**Tagline:** Prompt to production in under 60 seconds.

## Mark
The mark is an "M" cut from a single continuous stroke inside a graphite tile. The bottom-right
signal-blue square is the *live cursor*: the point where the AI hands control back to the human.
It appears wherever the product is "live" (streaming generation, selected component, running preview).

Minimum size: 24px. Clear space: 25% of the tile width on all sides. Never recolour the M;
on light surfaces use `logo-light.svg`, which keeps the graphite tile.

## Palette (60 / 30 / 10)
| Role | Token | Hex | Contrast on graphite-950 |
|---|---|---|---|
| 60% Surface | graphite-950 | #0B0D12 | App canvas |
| | graphite-900 | #12151C | Panels, sidebars |
| | graphite-800 | #181C26 | Elevated cards, inputs |
| | graphite-700 | #1F2432 | Hover states |
| 30% Structure | line-600 | #2A3040 | Hairline borders |
| | ink-100 | #E7EAF0 | Primary text, 17.6:1 |
| | ink-400 | #9AA3B5 | Secondary text, 7.9:1 (AAA) |
| 10% Accent | ember-500 | #F5A524 | Primary action and brand, 9.1:1 |
| | signal-400 | #5FD3FF | Live / AI state only, 11.9:1 |
| Semantic | success-400 | #3DDC97 | 11.4:1 |
| | danger-400 | #FF5C5C | 6.1:1 (AA text, AAA large) |

Rule: ember is for *the* primary action per view and for brand moments. Signal is reserved for
anything that is live (streaming, selection, cursor). Never put both on the same element.

## Typography
- **Display:** Bricolage Grotesque 600–800, tracking −0.035em at hero sizes, −0.02em above 24px.
- **Body / UI:** Instrument Sans 400–600.
- **Code / Data:** JetBrains Mono 400–500, tabular numerals wherever a number can change.

Fluid scale (rem, clamped between 360px and 1440px viewports):

| Step | clamp() |
|---|---|
| −1 | clamp(0.8125rem, 0.79rem + 0.11vw, 0.875rem) |
| 0 | clamp(0.9375rem, 0.90rem + 0.17vw, 1.0625rem) |
| 1 | clamp(1.125rem, 1.05rem + 0.35vw, 1.375rem) |
| 2 | clamp(1.375rem, 1.20rem + 0.75vw, 1.875rem) |
| 3 | clamp(1.75rem, 1.40rem + 1.50vw, 2.75rem) |
| 4 | clamp(2.25rem, 1.60rem + 2.80vw, 4rem) |
| 5 | clamp(2.75rem, 1.70rem + 4.60vw, 5.75rem) |

## Motion
Springs, never linear. Default UI spring: stiffness 420, damping 34, mass 1 (Motion One).
Entrance: cubic-bezier(0.16, 1, 0.3, 1) over 560ms, staggered 40ms. Exit: cubic-bezier(0.7, 0, 0.84, 0) over 220ms.
Only transform and opacity animate. Under prefers-reduced-motion, springs collapse to 120ms opacity fades.

## Voice
Confident, technical, terse. Verbs first. No exclamation marks in product UI.
