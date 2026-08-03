# Theme variants, round 2 — design

Four new theme experiments for the ongoing theme poll, each on its own
`design/*` branch (never on `develop` itself) — three off `develop`,
tyttebær off `design/rabarbra`, the branch it refines. Round 1
signal: rabarbra-light and rosemaling-dark got votes; the pink rabarbra
primary was the main doubt. This round refines that favourite, adds two
genuinely new colour directions, and isolates typography as its own
variable.

Each colour branch edits only `frontend/lib/theme.js`; the font branch
edits `fontFamilies` there plus the font imports in
`frontend/app/_layout.tsx` and the `@expo-google-fonts/*` packages in
`frontend/package.json`. Dark palettes follow the established contrast
rule: `bg-clay`/`bg-sage` surfaces carry `text-cream` (dark in dark
mode), so clay/sage stay light-ish; `bg-butter` carries `text-ink`
(light in dark mode), so butter darkens.

## 1. `design/tyttebær` — rabarbra with red instead of pink

Branch from `design/rabarbra` (keeps its Baloo 2 / Nunito Sans fonts and
celery-white ground) so the poll isolates exactly one change: the
primary shifts from raspberry pink to deep lingonberry red.

Only `clay` changes from rabarbra:

| token | light | dark |
|-------|-------|------|
| clay | `#AC3B4E` | `#D2686F` |

Known trade-off: rabarbra's pink was chosen partly so the primary never
reads as an error colour; lingonberry red moves toward that risk. The
screenshots exist to judge whether it does. The dark-mode red must stay
light enough for dark text, which pulls it slightly rose — accepted.

## 2. `design/skjærgård` — summer coast (new colour direction)

The only blue in the poll is Nord, which is cool and wintry. This is the
warm blue: sand ground, clear sea-blue primary, seagrass secondary,
driftwood ink. Fonts stay default (Fraunces / Karla) — colour-only
experiment.

| token | light | dark (dusk over water) |
|-------|-------|------|
| cream | `#FAF6ED` | `#16222D` |
| linen | `#F0E7D6` | `#20303D` |
| clay | `#2E7DA0` | `#63AECF` |
| sage | `#6F9884` | `#8CB8A2` |
| sageDeep | `#47685A` | `#A6CDB9` |
| butter | `#F2E3C0` | `#6B5F38` |
| ink | `#3B3A34` | `#E9E4D6` |

## 3. `design/skifer` — minimal slate (new colour direction)

Tests the quiet end of the field: warm paper, slate greys, one burnt
saffron accent for primary actions. Even a losing result is signal
(whether people want less colour). Fonts stay default.

| token | light | dark |
|-------|-------|------|
| cream | `#FAF8F4` | `#1B1D20` |
| linen | `#ECE9E2` | `#26292E` |
| clay | `#A87908` | `#E3B84F` |
| sage | `#6E7674` | `#A6ADAA` |
| sageDeep | `#474E4C` | `#C2C9C6` |
| butter | `#F1E8CF` | `#564F35` |
| ink | `#26282B` | `#EFEDE8` |

## 4. `design/grotesk` — fonts only

Default palette untouched (dark keeps mirroring light, as on
`develop`), typography swapped so the poll separates font opinion from
colour opinion:

- display: `BricolageGrotesque_600SemiBold` / `_700Bold`
  (`@expo-google-fonts/bricolage-grotesque`)
- body: `SchibstedGrotesk_400Regular` / `_700Bold`
  (`@expo-google-fonts/schibsted-grotesk`) — a Norwegian typeface,
  fitting Ingredo's identity

Package swap replaces `@expo-google-fonts/fraunces` and `/karla` on
this branch only.

## Screenshots

Per branch, using the documented emulator workflow (Pixel_API_35
emulator, Expo Go, double deep link after cache-cleared Metro start,
`cmd uimode night` for dark mode): capture Today and Recipes screens in
light and dark (grotesk: light only, since dark mirrors it). Output to
`screenshots/` (currently absent from the repo — recreated, untracked as
before) and combined into a `new-themes.png` montage via ImageMagick. A
combined all-themes montage is only possible if the round-1 captures
resurface or are re-shot; not in scope by default.

## Out of scope

- No layout changes; theme = colours and fonts only.
- No changes on `develop` beyond this spec document.
- No re-capture of the six round-1 branches.
