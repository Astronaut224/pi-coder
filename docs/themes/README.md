# Pi Coder Themes

Pi Coder reads JSON theme files from a single fixed directory and maps them onto
its CSS variables, so the whole UI — backgrounds, text, borders, the brand
accent, message bubbles — recolors to match.

The built-in **Default theme** (warm off-white / orange, with a dark variant) is
always available and needs no files. The themes described here override it.

## Theme directory

```
~/.pi/agent/themes/
```

That is the only directory Pi Coder reads. It cannot read arbitrary paths, the
project directory, or files you point it at — drop theme JSON here.

### Install the example themes

```bash
mkdir -p ~/.pi/agent/themes
cp docs/themes/example-dark.json  ~/.pi/agent/themes/example-dark.json
cp docs/themes/example-light.json ~/.pi/agent/themes/example-light.json
```

Then open the theme picker (palette button in the top bar) and choose **Example**.

## File naming

A theme is identified by its **base name**. Provide one or two files per theme:

| Files                                  | Base name  | Variants          |
| -------------------------------------- | ---------- | ----------------- |
| `gruvbox-dark.json` + `gruvbox-light.json` | `gruvbox`  | light + dark  |
| `monokai.json`                         | `monokai`  | one file (polarity inferred from `bg0`) |

Base-name rules (enforced by a strict whitelist):

- Start with a letter or digit.
- Only letters, digits, `_`, `-` after that.
- 1–64 characters.
- No `/`, `\`, `:`, `.`, spaces, or `..`.

When you switch light/dark mode, Pi Coder automatically loads the matching
`-light` / `-dark` file. If only one variant exists, that file is used for both
modes (no error). The light/dark label of a variant is decided by the actual
brightness of its `bg0`, not only by the filename suffix.

## JSON format

```json
{
  "name": "example-dark",
  "vars": {
    "bg0": "#1c1b1a",
    "bg1": "#24231f",
    "bg2": "#2f2d28",
    "bg3": "#393631",
    "fg0": "#eceae6",
    "fg3": "#9c978d",
    "fg4": "#736f68",
    "orange": "#f0932e"
  },
  "colors": {
    "accent": "orange",
    "border": "bg3",
    "text": "fg0",
    "selectedBg": "bg2",
    "userMessageBg": "bg1",
    "toolSuccessBg": "bg1"
  }
}
```

- `vars` — your palette. Each value is a color (see below).
- `colors` — semantic tokens. Each value is either a literal color or the **name
  of a `vars` entry** (e.g. `"accent": "orange"` resolves to `vars.orange`).
  Missing tokens fall back to safe defaults chosen for the theme's own polarity.

You do not need to list every token — only the ones you want to set. The loader
fills in the rest.

### Supported color values

| Value        | Meaning                                   |
| ------------ | ----------------------------------------- |
| `#f0932e`    | 6-digit hex                               |
| `#f52`       | 3-digit hex (expanded to `#ff5522`)       |
| `f0932e`     | hex without `#`                           |
| `242`        | ANSI 256-color index → hex                |
| `"orange"`   | reference to `vars.orange`                |
| `""`         | empty → use the mapping's default         |

Anything else (`url(...)`, `var(...)`, `;`, unknown words) is **ignored** — it
can never reach the page's inline styles.

## How it maps to the UI

The loader resolves the palette and produces these CSS variables (the only ones
a JSON theme may set):

`--bg`, `--bg-panel`, `--bg-hover`, `--bg-selected`, `--border`, `--text`,
`--text-muted`, `--text-dim`, `--accent`, `--accent-hover`, `--accent-active`,
`--accent-soft`, `--accent-soft-2`, `--accent-border`, `--user-bg`,
`--assistant-bg`, `--tool-bg`, `--bg-subtle`.

`--accent-hover` / `--accent-active` / `--accent-soft*` / `--accent-border` are
derived from `--accent` automatically; you usually only need to set `accent`.

## Troubleshooting

- **My theme doesn't appear in the picker.** Confirm the file is
  `~/.pi/agent/themes/<name>.json`, has a `.json` extension, is a regular file
  (not a symlink), is under 256 KB, and parses as valid JSON with a `name`
  string and a `colors` object. Corrupt files are skipped silently so they don't
  break the rest of the list.
- **Colors look wrong / unchanged.** Hard-refresh the page. Theme JSON is read
  fresh on every request (never cached), and the list is re-fetched each time
  you open the picker.
- **The page reverted to the default theme.** The selected theme's file was
  removed or became unreadable. Pi Coder falls back to the default theme, clears
  the stored theme name, and keeps your light/dark mode. Re-add the file and
  reselect it.
- **Switching light/dark keeps one variant.** You only provided one file. Add a
  paired `-light.json` / `-dark.json` to get a true variant per mode.
