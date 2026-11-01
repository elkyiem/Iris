# @pond/icons

Pond's own icon set. Every glyph is drawn once on an 18×18 grid and scales to
any size. Import from the package root:

```tsx
import { IconFolder, IconStarFill } from "@pond/icons";

<IconFolder />
<IconFolder size={12} />
<IconStarFill size={24} />
```

`IconName` is the outline glyph and `IconNameFill` is its solid twin, when one
exists. Props:

- `size` sets width and height. Default `18`.
- `strokeWidth` is the on-screen stroke in pixels at `size`. Default `1.5` at
  18px. Below 18px the default thins by the square root of the scale, never
  under 1px: about 1.41 at 16px, 1.32 at 14px, and 1.22 at 12px. An explicit
  `strokeWidth` is exact at any size up to 18px. Above 18px the stroke grows
  with the glyph. When CSS resizes the icon instead
  of `size`, the stroke scales with it, so a 14px button icon thins to match.
- `title` labels the icon for assistive tech. Without it the icon is
  `aria-hidden`.

## Drawing a glyph

1. Draw on an 18×18 artboard: 1.5 stroke, round caps and joins, live area
   2.25 to 15.75. Circles use r6.75, squares 2.75 to 15.25 with r3. Badges sit
   at the bottom-right around (13.5, 13.5), and the base shape stops short of
   them.
2. Save the outline as `svg/outline/<kebab-name>.svg` and the fill, if any, as
   `svg/fill/<kebab-name>.svg`. Use only `<path>`, `<circle>`, and `<rect>`.
   Fills are flattened shapes with `fill="currentColor"`, not strokes.
3. Run `pnpm --filter @pond/icons generate` to rebuild `index.ts` and
   `manifest.ts`. CI runs the same script with `--check`.

The generator lists glyphs nothing imports, so unused drawings are easy to
spot.

## Brand marks

Social and brand marks live under `social-media/custom/`. The X, GitHub, and
Google Chrome paths come from [Simple Icons](https://simpleicons.org/) (CC0).
Provider logos are documented in `social-media/custom/provider-logos.md`. The
marks remain their owners' trademarks.

The `tweet-*` and `threads-*` fills in `svg/fill/` redraw the X and Threads
post controls on the 18×18 grid so capture cards match the original post. They
remain their owners' marks.

The Pond mark lives in `brand/`: `icon.svg` is the vector source, and `tints/`
holds Icon Composer colorways. The desktop app defaults to `tints/aqua` for the
Dock icon.

## License

The glyphs in `svg/` are original Pond artwork under the repository's MIT
license, except the `tweet-*` and `threads-*` redraws noted above.
