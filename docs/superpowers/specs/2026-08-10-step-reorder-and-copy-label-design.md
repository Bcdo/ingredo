# Beta feedback: step reordering + copy-button label

Date: 2026-08-10
Source: beta tester feedback (round 4)

## Goal

1. Let recipe authors reorder instruction steps by holding and dragging a
   step, instead of deleting and retyping everything after a forgotten step.
2. Drop the trailing ellipsis from the "Kopier til en annen husholdning …"
   button on the recipe detail screen.

## 1. Step reordering (hold-to-drag)

### Library

`react-native-sortables`, chosen over `react-native-draggable-flatlist`:

- Actively maintained; built directly on `react-native-gesture-handler` and
  `react-native-reanimated`, both already in the app at versions it supports.
- Pure JS → works in Expo Go (our beta distribution channel).
- Designed to sit inside an existing ScrollView with edge auto-scroll while
  dragging — `RecipeForm` renders the step list inside a larger ScrollView,
  so FlatList-based libraries are a non-starter.
- Handles variable-height rows (our steps are multiline inputs).

API/compat is verified against current docs before installing; see fallback.

### Interaction

- Long-press on a step row lifts it; dragging moves it; releasing commits
  the new order. **No visual affordance** — no drag handle, no icon, no hint
  text. Discovery matches the tester's own expectation ("hold in on steps").
- Long-press **inside the text input keeps native text behavior**
  (cursor/selection). The drag gesture activates only from the step-number
  column — an invisible touch zone (~32px wide, full row height) around the
  number. The delete button stays a plain tap target. (Narrowed from the
  original "rest of the row" wording during implementation; confirmed with
  the user 2026-08-10 after final review.)
- While lifted, the row gets the library's default lift treatment (scale/
  shadow); step numbers renumber on drop since they render from index.

### Data flow

Drop → reordered array → existing `patch({ instructions })` on form state.
Instructions already persist as an ordered array; no db/backend change.

### Scope

Instructions list only. Ingredients keep current behavior.

## 2. Copy-button label

Remove the trailing " …" from the `copyToHousehold` string in both
`lib/i18n/nb.json` and `lib/i18n/en.json`. No code change.

## Error handling

- Drag ends with unchanged order → patch is a no-op re-set of the same
  array; harmless.
- If the library misbehaves only at runtime (gesture conflicts, crashes in
  Expo Go), see fallback below — verified on emulator before merging.

## Testing

- Unit test for the reorder handler: given a from/to index pair, form state
  ends with the correctly reordered instructions array and intact keys/text.
- Existing RecipeForm/Jest suite stays green.
- Manual emulator verification with screenshots: lift, drag past several
  rows, auto-scroll near edges, text input still editable, long-press in
  input selects text instead of dragging.

## Fallback

If `react-native-sortables` proves incompatible with reanimated 4 / Expo Go
during verification, fall back to invisible-affordance alternatives is not
possible — arrows require visible controls — so the decision returns to the
user before switching approach.

## Out of scope

- Ingredient reordering.
- Any backend or schema changes.
