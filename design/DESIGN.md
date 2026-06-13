# Ingredo — Mobile Design Specification

Meal planning · recipes · ingredient-based shopping · shared households.
iOS and Android only. No desktop layouts.

**Mockups:** open `index.html` in a browser. Each screen is rendered in a phone
frame with its UX annotation alongside.

---

## 1. Design language

| Token | Value | Used for |
|---|---|---|
| Cream | `#FBF7F1` | App background |
| Linen | `#F3ECE1` | Secondary surfaces, ghost buttons |
| Clay | `#C96B45` | Primary actions, active nav, quantities |
| Sage | `#7D9474` / `#50664A` | Confirmation, presence, plan→shop bridge |
| Butter | `#F3E2BE` | Gentle status (offline, pending sync) |
| Ink | `#3A322B` | Text |

- **Type:** Fraunces (display — warm, food-editorial serif) + Karla (body — clear humanist sans).
- **Shape:** 18–22 px corner radii on cards; pill chips; soft, warm shadows.
- **Touch:** every primary target ≥ 56 pt tall and full-width where possible; bottom
  nav and primary CTAs live in the thumb zone.
- **Tone:** a kitchen, not a cockpit. No charts, no streaks, no red error banners,
  no checkboxes.

### Color semantics (consistent everywhere)
- **Clay** = "do something" (add, save, create, primary nav state).
- **Sage** = "it worked / they're here" (purchase confirmation, presence dots,
  generate-list action).
- **Butter** = "good to know" (offline, pending sync). Never red, never blocking.

---

## 2. Bottom navigation

**Today · Plan · Recipes · Shop** — four tabs.

- Four, not five: keeps each target ~90 pt wide for one-handed use.
- **Shop carries a live badge** with the active item count — "do we need anything?"
  is answered without opening the app's list.
- The **household is not a tab.** It's reached by tapping the avatar cluster shown
  in every screen header. Social context is ambient; managing it is rare.
- Tab order mirrors the daily rhythm: check today → plan the week → find recipes →
  go shopping.

---

## 3. Screens

### 3.1 Home — "Today"
The home screen answers exactly three questions: *what's for dinner tonight*,
*do we need to buy anything*, and *what's coming tomorrow*.

- **Tonight's dinner** is the hero card, pulled from the meal plan. 1 tap → recipe,
  ready to cook.
- **Shopping glance card**: live item count, preview chips, and partner activity
  ("Maja added 2 items just now") with a pulsing presence dot.
- **Tomorrow** peeks below — a gentle nudge toward the planning habit.
- Quick actions (Plan week / Add item) close the loop without hunting through tabs.

*Flow:* open app → tonight's recipe in 1 tap, or store-ready list in 1 tap.

### 3.2 Weekly meal plan
A **vertical week** — one row per day, scrolled with a thumb. Today is anchored
with a clay date token.

- Empty days render as dashed **"+ Add dinner" slots** — the empty state *is* the
  tap target. Tapping opens a recipe picker pre-filtered to favourites/recent.
- Meal cards carry the **avatar of whoever planned them** — the plan feels co-owned.
- Long-press to drag a meal between days; swipe left to remove.
- **Sticky sage CTA: "Add week to shopping list · 23 ingredients."** The keystone
  action. It aggregates all ingredients from planned meals, merges duplicates
  (2 onions + 1 onion → 3 onions), skips what's already listed, and sorts by store
  category. **Planning becomes shopping in one tap.**

*Taps:* plan a dinner = 2 · week → shopping list = 1.

### 3.3 Recipe list
Two-column **visual grid** — dinner is chosen with the eyes.

- Persistent search across **titles and ingredients** ("what can we make with
  halloumi?").
- Filter chips for real weeknight questions: Quick (<30 min), Favourites,
  Vegetarian, Recent. One tap each, no filter screens.
- Hearts are **household favourites** — shared, not personal.
- Clay floating **+** button creates a recipe from anywhere.
- **Long-press a card** → quick sheet: *Plan it · Add ingredients to list ·
  Favourite* — frequent flows skip the detail screen entirely.

### 3.4 Recipe detail
One scroll, three zones: **hero photo → ingredients → method.**

- **Servings stepper + US ⇄ Metric toggle sit directly above the ingredients they
  transform.** Tap + and every quantity rescales in place (600 g → 900 g). Unit
  conversion is a single segmented control, also stored as a household-wide default.
- Quantities set in clay Fraunces — scannable at arm's length while cooking.
- **"Add N ingredients to shopping list"** respects the current serving scale and
  merges into the household list by category. Tap any ingredient row first to
  exclude things you already have.
- Method steps: large numerals, 1.6 line-height — readable propped against a jar.
- **Plan it** button → day picker sheet → lands in the weekly plan.

*Taps:* rescale = 1 · convert units = 1 · all ingredients → list = 1.

### 3.5 Shopping list — the signature interaction
**No checkboxes.** Every item is a full-width tappable card (~60 pt tall).
Tap anywhere on it → it squeezes, blooms sage, and **glides down to the
"Recently Purchased" shelf.** Nothing to aim at — the whole card is the target,
which one-handed shopping with a basket demands.

- Items group by **store category in walking order** (Produce → Dairy → Bakery →
  Pantry). The list empties top-to-bottom as you move through the store.
- Quantities are **pre-merged across recipes**; each card lists its recipe origins
  ("Curry · Bolognese") so substitutions can be judged in the aisle.
- Partner-added items carry their avatar and arrive live; a pulsing dot in the
  header shows who's in the list right now.
- **Quick-add bar** pinned at top: type "butter", return, done — auto-categorised.
- Every purchase shows a brief toast with **"Put back"** — second undo path beyond
  the shelf itself.

*Taps:* purchase = 1 · undo = 1 · manual add = 1 + typing.

### 3.6 Recently Purchased
**A shelf, not a graveyard.** Purchased items keep their identity — dashed outline,
softened color, fully legible. The metaphor is the counter after unpacking, not a
struck-through to-do list.

Three jobs, one section:
1. **Undo** — tap a shelf item, it slides back to its category, quantity intact.
2. **History** — grouped by time (*this trip · earlier this week*), person-attributed.
   "Did we already buy parmesan?" is answered by glancing, 0 taps.
3. **Quick re-add** — staples live here permanently. Milk runs out → open Shop →
   tap milk on the shelf → it's back. Faster than typing, every week.

A **"Buy again" suggestion row** surfaces the household's most frequently purchased
items — Ingredo learns staples without being told.

### 3.7 Add recipe
Full-screen modal sheet. Cancel left, Save right, both always visible — a recipe
with only a title is valid and finishable later (and offline).

- **"Paste a link" import strip comes first** — most recipes start on a website.
  Import fills title, photo, ingredients, steps; the form becomes review-and-fix.
- **Natural-language ingredient entry:** type "2 tbsp olive oil" as one line;
  quantity / unit / name parse into chips live. The parsed structure powers
  scaling, conversion, and list merging — but the user never fills 3 fields per
  ingredient.
- Steps are plain numbered text boxes; drag handles (⠿) reorder both lists.
- New recipes are **household-shared by default.**

*Taps:* URL import = 2 · save = 1.

### 3.8 Empty states
Empty screens recur weekly (list empties after every trip; plan resets each week),
so they're designed as calm moments with **one obvious next action** — never dead
ends, never guilt.

- **Shopping (mocked):** tilted basket tile, friendly copy, then two refills —
  *"Add this week's plan · 23 items"* (1 tap) and tappable "Buy again" staples.
- **Meal plan:** "A fresh week. What are you hungry for?" + *Plan from favourites*
  suggesting three household favourites.
- **Recipes (first run):** leads with link-import — "Bring your first recipe" —
  because new users own zero recipes here but dozens in browser tabs.
- **Recently Purchased:** simply absent until the first purchase; the divider
  appears with the first tapped item, teaching the mechanic by demonstration.

### 3.9 Offline states
Grocery stores are concrete boxes with no signal — offline is an **expected
condition, not an error.**

- Everything works against the local store: browse/cook/edit recipes, plan meals,
  add items, purchase items. Taps glide items to the shelf instantly (optimistic UI).
- A **butter-yellow pill** states the truth without alarm: "You're offline — your
  list is safe. Changes sync automatically." No red, no blocked buttons.
- Offline-made changes carry a quiet **"syncs later" chip** with a slow spinner.
- Presence dots and partner avatars hide rather than show stale state.
- On reconnect: pill flips to sage "All caught up ✓" and fades. Sync is per-item,
  last-writer-wins; purchases are never lost (a purchase + a concurrent edit both
  survive — the item lands on the shelf with the edit applied).

### 3.10 Household sharing
**Ambient, not administrative.** Day to day, sharing shows up as avatars on meals
and items, presence dots, and live list updates. The management screen (avatar
cluster → 1 tap) is visited rarely.

- **Joining survives a kitchen conversation:** QR scan or a 6-letter code
  (`KJN-4LM`). No email invites, no pending states.
- **One pool, no permissions:** recipes, plans, lists belong to the household;
  anyone edits anything. Matches real kitchens; nothing to configure or think about.
- **Activity feed** answers "what changed while I was out?" — reverse-chronological,
  person-attributed, glanceable. Push notifications are reserved for deliberate
  nudges, not every change.
- Household-level preferences set once for everyone: **units (metric default)**,
  week start day.

---

## 4. Tap budget — the flows that matter most

| Flow | Taps |
|---|---|
| Mark item purchased | **1** |
| Undo / re-add from shelf | **1** |
| Check "did we buy it?" | **0** (shelf is visible) |
| Whole week → shopping list | **1** |
| Scale servings / convert units | **1** each |
| Recipe's ingredients → list | **1** |
| Plan a dinner on an empty day | **2** |
| Open tonight's recipe from launch | **1** |
| Quick-add a manual item | **1** + typing |
| Import a recipe from URL | **2** |

---

## 5. Platform notes

- **iOS:** SF-style large-title behaviour on scroll; sheets with grabber handles;
  haptic tick on purchase tap (light impact) and on shelf-return (soft).
- **Android:** Material You-compatible — the palette maps cleanly to tonal roles;
  predictive back; the FAB and bottom nav follow Material metrics.
- Both: respect system font scaling (layout is row-based and tolerant), dark mode
  variant uses espresso surfaces (`#211B15`) with the same clay/sage accents.
