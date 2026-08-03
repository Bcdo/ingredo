# Theme Variants Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create four new theme-experiment branches (tyttebaer, skjaergard, skifer, grotesk) and capture emulator screenshots of each for the ongoing theme poll.

**Architecture:** Each theme is one commit on its own `design/*` branch editing `frontend/lib/theme.js` (the single source of truth for palettes and font names); the font branch additionally swaps `@expo-google-fonts/*` packages and imports in `frontend/app/_layout.tsx`. Verification is visual: per-branch screenshots from the Android emulator via the documented Expo Go workflow, montaged into one comparison image.

**Tech Stack:** React Native / Expo (Expo Go), NativeWind CSS variables, @expo-google-fonts, adb + Android emulator (AVD `Pixel_API_35`), ImageMagick `montage`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-theme-variants-round2-design.md` — hex values there are authoritative.
- Theme experiments NEVER land on `develop`; each lives on its own `design/*` branch (ASCII branch names: `design/tyttebaer`, `design/skjaergard`, `design/skifer`, `design/grotesk`).
- `design/tyttebaer` branches from `design/rabarbra`; the other three branch from `develop`.
- Commit message style for theme branches: `design: <description>` (matches `design: experiment with Rabarbra fresh theme`).
- Dark contrast rule: `bg-clay`/`bg-sage` carry `text-cream` → clay/sage stay light-ish in dark palettes; `bg-butter` carries `text-ink` → butter darkens.
- Layout/copy changes are out of scope; only colours and fonts change.
- `frontend/lib/theme.js` is plain CommonJS (required by tailwind.config.js from Node) — no imports/TS syntax.
- Screenshots go to repo-root `screenshots/` (untracked, recreate with `mkdir -p`); do not commit images.

---

### Task 1: `design/tyttebaer` branch — rabarbra with lingonberry-red primary

**Files:**
- Modify: `frontend/lib/theme.js` (on new branch `design/tyttebaer`, branched from `design/rabarbra`)

**Interfaces:**
- Consumes: `design/rabarbra` branch's theme.js (celery ground, Baloo 2 / Nunito Sans fonts stay).
- Produces: branch `design/tyttebaer` with only the `clay` token changed — light `#C2497B` → `#AC3B4E`, dark `#D9739E` → `#D2686F`. Task 5 checks this branch out by this exact name.

- [ ] **Step 1: Create the branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout design/rabarbra
git checkout -b design/tyttebaer
```

- [ ] **Step 2: Edit the two clay values and the palette comments**

In `frontend/lib/theme.js`, make exactly these three edits:

Light palette — replace:
```js
  clay: '#C2497B', // primary actions, active nav, quantities
```
with:
```js
  clay: '#AC3B4E', // primary actions, active nav, quantities
```

Dark palette — replace:
```js
  clay: '#D9739E',
```
with:
```js
  clay: '#D2686F',
```

Update the light-palette comment block — replace:
```js
// Experiment: Rabarbra — Nordic summer instead of Nordic winter. Celery-
// white ground, raspberry/rhubarb primary (pink enough to never read as
// an error color), bright herb green, spruce-cast ink.
```
with:
```js
// Experiment: Tyttebær — Rabarbra's summer ground with the primary
// shifted from raspberry pink to deep lingonberry red. Tests whether
// the round-1 favourite works better without the pink buttons.
```

- [ ] **Step 3: Verify the file still parses as CommonJS and only clay changed**

```bash
node -e "const t=require('./frontend/lib/theme.js'); console.log(t.palettes.light.clay, t.palettes.dark.clay)"
git diff design/rabarbra -- frontend/lib/theme.js
```
Expected: prints `#AC3B4E #D2686F`; diff touches only the comment block and the two clay lines.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/theme.js
git commit -m "design: Tyttebær variant — lingonberry red primary on Rabarbra ground

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `design/skjaergard` branch — summer coast palette

**Files:**
- Modify: `frontend/lib/theme.js` (on new branch `design/skjaergard`, branched from `develop`)

**Interfaces:**
- Consumes: `develop`'s theme.js (Fraunces/Karla fonts stay; only the two palette literals and their comments change).
- Produces: branch `design/skjaergard` with sand/sea-blue light palette and dusk-navy dark palette. Task 5 checks this branch out by this exact name.

- [ ] **Step 1: Create the branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b design/skjaergard
```

- [ ] **Step 2: Replace the palette section of `frontend/lib/theme.js`**

Replace everything from the `const light = buildPalette({` line through the `const dark = light;` line (including the comment above `const dark`) with:

```js
// Experiment: Skjærgård — summer coast. Warm sand ground, clear
// sea-blue primary, seagrass secondary, driftwood ink. The warm
// counterpart to Nord's wintry blue.
const light = buildPalette({
  cream: '#FAF6ED', // app background; also text on clay/sage surfaces
  linen: '#F0E7D6', // secondary surfaces, ghost buttons, borders
  clay: '#2E7DA0', // primary actions, active nav, quantities
  sage: '#6F9884', // confirmation, presence, plan→shop bridge
  sageDeep: '#47685A',
  butter: '#F2E3C0', // gentle status (offline, pending sync); ink text on top
  ink: '#3B3A34', // text
});

// Dark counterpart: dusk over water. Blues and greens lighten for the
// navy ground; butter darkens so light ink stays readable on it.
const dark = buildPalette({
  cream: '#16222D',
  linen: '#20303D',
  clay: '#63AECF',
  sage: '#8CB8A2',
  sageDeep: '#A6CDB9',
  butter: '#6B5F38',
  ink: '#E9E4D6',
});
```

Leave `fontFamilies` (Fraunces/Karla) and everything else untouched.

- [ ] **Step 3: Verify parse and diff scope**

```bash
node -e "const t=require('./frontend/lib/theme.js'); console.log(t.palettes.light.clay, t.palettes.dark.cream)"
git diff develop --stat
```
Expected: prints `#2E7DA0 #16222D`; diff stat shows only `frontend/lib/theme.js`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/theme.js
git commit -m "design: Skjærgård variant — sand ground, sea-blue primary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `design/skifer` branch — minimal slate palette

**Files:**
- Modify: `frontend/lib/theme.js` (on new branch `design/skifer`, branched from `develop`)

**Interfaces:**
- Consumes: `develop`'s theme.js (Fraunces/Karla fonts stay).
- Produces: branch `design/skifer` with paper/slate/saffron light palette and slate-black dark palette. Task 5 checks this branch out by this exact name.

- [ ] **Step 1: Create the branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b design/skifer
```

- [ ] **Step 2: Replace the palette section of `frontend/lib/theme.js`**

Replace everything from the `const light = buildPalette({` line through the `const dark = light;` line (including the comment above `const dark`) with:

```js
// Experiment: Skifer — the quiet end of the poll. Warm paper, slate
// greys, and a single burnt-saffron accent for primary actions. Tests
// whether people want less colour, not more.
const light = buildPalette({
  cream: '#FAF8F4', // app background; also text on clay/sage surfaces
  linen: '#ECE9E2', // secondary surfaces, ghost buttons, borders
  clay: '#A87908', // primary actions, active nav, quantities
  sage: '#6E7674', // confirmation, presence, plan→shop bridge
  sageDeep: '#474E4C',
  butter: '#F1E8CF', // gentle status (offline, pending sync); ink text on top
  ink: '#26282B', // text
});

// Dark counterpart: slate black. Saffron and greys lighten for the
// dark ground; butter darkens so light ink stays readable on it.
const dark = buildPalette({
  cream: '#1B1D20',
  linen: '#26292E',
  clay: '#E3B84F',
  sage: '#A6ADAA',
  sageDeep: '#C2C9C6',
  butter: '#564F35',
  ink: '#EFEDE8',
});
```

Leave `fontFamilies` and everything else untouched.

- [ ] **Step 3: Verify parse and diff scope**

```bash
node -e "const t=require('./frontend/lib/theme.js'); console.log(t.palettes.light.clay, t.palettes.dark.cream)"
git diff develop --stat
```
Expected: prints `#A87908 #1B1D20`; diff stat shows only `frontend/lib/theme.js`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/theme.js
git commit -m "design: Skifer variant — warm paper, slate greys, saffron accent

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `design/grotesk` branch — fonts only (Bricolage Grotesque + Schibsted Grotesk)

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json` (via npm), `frontend/app/_layout.tsx:3-4`, `frontend/app/_layout.tsx:58-63`, `frontend/lib/theme.js` (fontFamilies block only) — all on new branch `design/grotesk`, branched from `develop`

**Interfaces:**
- Consumes: `develop`'s font wiring: imports at `_layout.tsx:3-4`, `useFonts({...})` at `_layout.tsx:58-63`, `fontFamilies` export in theme.js.
- Produces: branch `design/grotesk` where `fontFamilies.display = 'BricolageGrotesque_600SemiBold'`, `displayBold = 'BricolageGrotesque_700Bold'`, `body = 'SchibstedGrotesk_400Regular'`, `bodyBold = 'SchibstedGrotesk_700Bold'`; palettes untouched (dark still mirrors light). Task 5 checks this branch out by this exact name and MUST run `npm install` when switching to/from it.

- [ ] **Step 1: Create the branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b design/grotesk
```

- [ ] **Step 2: Swap the font packages**

```bash
cd frontend
npm uninstall @expo-google-fonts/fraunces @expo-google-fonts/karla
npm install @expo-google-fonts/bricolage-grotesque @expo-google-fonts/schibsted-grotesk
```
Expected: both commands succeed; package.json now lists `bricolage-grotesque` and `schibsted-grotesk` instead of `fraunces` and `karla`.

- [ ] **Step 3: Update the imports in `frontend/app/_layout.tsx`**

Replace lines 3–4:
```tsx
import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Karla_400Regular, Karla_700Bold } from '@expo-google-fonts/karla';
```
with:
```tsx
import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { SchibstedGrotesk_400Regular, SchibstedGrotesk_700Bold } from '@expo-google-fonts/schibsted-grotesk';
```

And the `useFonts` block (lines 58–63) — replace:
```tsx
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Karla_400Regular,
    Karla_700Bold,
  });
```
with:
```tsx
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    SchibstedGrotesk_400Regular,
    SchibstedGrotesk_700Bold,
  });
```

- [ ] **Step 4: Update `fontFamilies` in `frontend/lib/theme.js`**

Replace:
```js
const fontFamilies = {
  display: 'Fraunces_600SemiBold',
  displayBold: 'Fraunces_700Bold',
  body: 'Karla_400Regular',
  bodyBold: 'Karla_700Bold',
};
```
with:
```js
// Experiment: Grotesk — default colours, new voice. Bricolage Grotesque
// display over Schibsted Grotesk body (a Norwegian typeface).
// Loaded in app/_layout.tsx.
const fontFamilies = {
  display: 'BricolageGrotesque_600SemiBold',
  displayBold: 'BricolageGrotesque_700Bold',
  body: 'SchibstedGrotesk_400Regular',
  bodyBold: 'SchibstedGrotesk_700Bold',
};
```

- [ ] **Step 5: Verify the font modules exist and TypeScript compiles**

```bash
cd /home/mrb/Work/Programming/ingredo/frontend
node -e "const b=require('@expo-google-fonts/bricolage-grotesque'); const s=require('@expo-google-fonts/schibsted-grotesk'); console.log(!!b.BricolageGrotesque_600SemiBold, !!b.BricolageGrotesque_700Bold, !!s.SchibstedGrotesk_400Regular, !!s.SchibstedGrotesk_700Bold)"
npx tsc --noEmit
```
Expected: prints `true true true true`; tsc exits 0. If a named export is missing (prints `false`), check the package's exports with `node -e "console.log(Object.keys(require('@expo-google-fonts/bricolage-grotesque')))"` and use the closest available weight, updating `_layout.tsx` and `theme.js` consistently.

- [ ] **Step 6: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/package.json frontend/package-lock.json frontend/app/_layout.tsx frontend/lib/theme.js
git commit -m "design: Grotesk variant — Bricolage Grotesque + Schibsted Grotesk, default colours

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Capture emulator screenshots for all four branches

**Files:**
- Create: `screenshots/tyttebaer-today-light.png`, `screenshots/tyttebaer-recipes-light.png`, `screenshots/tyttebaer-today-dark.png`, `screenshots/tyttebaer-recipes-dark.png`, and the same four names for `skjaergard` and `skifer`; `screenshots/grotesk-today-light.png`, `screenshots/grotesk-recipes-light.png` (grotesk has no dark look — dark mirrors light). 14 images total, all untracked.

**Interfaces:**
- Consumes: the four branches by exact name from Tasks 1–4.
- Produces: the 14 PNGs above, at 1080×2400, for Task 6's montage.

**Workflow notes (from the documented recipe, verified 2026-07-18):**
- The FIRST deep link after a cache-cleared Metro start often stalls (Expo Go returns to launcher). Fire the deep link a second time; the bundle completes in ~10s. ALWAYS verify with a screencap before tapping — taps can land on the launcher.
- The in-app colour mode is stored in a shared SQLite DB that survives branch switches; it was left on System, so `cmd uimode night` flips light/dark live. Verify with a screencap that dark mode actually rendered before capturing.
- Tap coordinates at 1080×2400: Recipes tab (674, 2285).
- `lsof` is not installed; use `fuser -k 8081/tcp` to kill Metro.
- Branches with different font packages than the previous checkout need `npm install` before starting Metro (tyttebaer ships Baloo 2/Nunito Sans, grotesk ships Bricolage/Schibsted, skjaergard and skifer ship develop's Fraunces/Karla).

- [ ] **Step 1: Boot the emulator and prepare adb**

```bash
adb devices
```
If `emulator-5554` is not listed:
```bash
(emulator -avd Pixel_API_35 -no-snapshot-save >/dev/null 2>&1 &)
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
```
Then:
```bash
adb reverse tcp:8081 tcp:8081
mkdir -p /home/mrb/Work/Programming/ingredo/screenshots
```
Expected: `adb devices` shows `emulator-5554  device`.

- [ ] **Step 2: Capture one branch (repeat this step for each of tyttebaer, skjaergard, skifer, grotesk)**

For BRANCH in that order:

```bash
cd /home/mrb/Work/Programming/ingredo
fuser -k 8081/tcp 2>/dev/null; sleep 2
git checkout design/BRANCH
cd frontend && npm install   # required when font packages changed vs. previous checkout; harmless otherwise
npx expo start -c            # run in background
```
Wait ~15s for Metro, then:
```bash
adb shell "cmd uimode night no"
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
sleep 10
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"   # second link — first often stalls
sleep 12
adb exec-out screencap -p > /tmp/check.png   # VERIFY: must show the app's Today screen, not the launcher
```
If the check shows the launcher or a loading screen, re-fire the deep link and re-check. Once the Today screen is up:
```bash
adb exec-out screencap -p > screenshots/BRANCH-today-light.png
adb shell input tap 674 2285 && sleep 3
adb exec-out screencap -p > screenshots/BRANCH-recipes-light.png
```
For tyttebaer, skjaergard, skifer additionally (skip for grotesk):
```bash
adb shell "cmd uimode night yes" && sleep 3
adb exec-out screencap -p > /tmp/check.png   # VERIFY dark rendered (background actually dark)
adb exec-out screencap -p > screenshots/BRANCH-recipes-dark.png
# navigate back to Today: the tab bar keeps its layout — Today tab is the leftmost; tap it
adb shell input tap 134 2285 && sleep 3
adb exec-out screencap -p > screenshots/BRANCH-today-dark.png
adb shell "cmd uimode night no"
```
(If tapping (134, 2285) does not land on the Today tab — verify with a screencap — capture the two dark shots in whatever tab order works, matching the light captures' screens.)

- [ ] **Step 3: Verify the capture set**

```bash
cd /home/mrb/Work/Programming/ingredo
ls -la screenshots/ | wc -l
for f in screenshots/*.png; do identify -format "%f %wx%h\n" "$f"; done
```
Expected: 14 PNGs, each 1080×2400. Visually spot-check one light and one dark image per colour branch (Read the PNG) to confirm the palette actually changed — e.g. skifer shows saffron buttons on paper, skjaergard shows sea-blue on sand.

- [ ] **Step 4: Return the working tree to develop and restart Metro cleanly**

```bash
fuser -k 8081/tcp 2>/dev/null
cd /home/mrb/Work/Programming/ingredo
git checkout develop
cd frontend && npm install   # restore develop's font packages in node_modules
```

---

### Task 6: Montage and hand-off

**Files:**
- Create: `screenshots/new-themes.png` (untracked)

**Interfaces:**
- Consumes: the 14 PNGs from Task 5, by exact filename.
- Produces: one labelled comparison montage for the poll.

- [ ] **Step 1: Build the montage**

One row per theme, light pair then dark pair, labels under each cell:

```bash
cd /home/mrb/Work/Programming/ingredo/screenshots
montage -label '%t' \
  tyttebaer-today-light.png tyttebaer-recipes-light.png tyttebaer-today-dark.png tyttebaer-recipes-dark.png \
  skjaergard-today-light.png skjaergard-recipes-light.png skjaergard-today-dark.png skjaergard-recipes-dark.png \
  skifer-today-light.png skifer-recipes-light.png skifer-today-dark.png skifer-recipes-dark.png \
  grotesk-today-light.png grotesk-recipes-light.png \
  -tile 4x -geometry 270x600+6+6 -pointsize 14 new-themes.png
```
Expected: `new-themes.png` exists; `identify` shows roughly 1128px wide, 4 rows.

- [ ] **Step 2: Verify visually**

Read `screenshots/new-themes.png` and confirm: four distinct themes, dark cells actually dark, labels legible. For the grotesk row, compare its typography against the skjaergard/skifer rows (those keep the default Fraunces/Karla) — the headings and body text must look clearly different while the colours match develop's defaults.

- [ ] **Step 3: Report to the user**

Present `new-themes.png` plus the per-branch shots, restate which branch is which, and remind that all six round-1 branches still exist for a combined montage if the round-1 captures resurface.
