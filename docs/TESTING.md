# Testing Strategy

## Goal

Use tests where they provide clear value, especially for logic that would be tedious or risky to manually test repeatedly.

## Test Stack

- Jest
- React Native Testing Library

Expo officially documents Jest-based testing, so Jest is preferred for this project.

## What to Test Early

### Recipe Scaling

Example:

```text
Original servings: 2
Target servings: 4
200g chicken → 400g chicken
```

### Unit Conversion

Examples:

```text
1 cup → 240 ml
1 tbsp → 15 ml
1 tsp → 5 ml
1 oz → 28 g
```

### Shopping List Generation

Test:

- Add ingredients from recipe
- Skip ingredients user already has
- Merge duplicates if implemented
- Preserve quantities and units

## What to Test Later

### Offline Sync

Test:

- Offline actions are queued
- Actions retry when online
- Duplicate actions are avoided
- Sync failures do not lose local data

### Conflict Resolution

Test:

- Last write wins
- Soft-deleted records stay deleted
- Concurrent changes behave predictably

## Manual Testing

Manual testing happens in the GitHub Project Review column.

Checklist:

- Android
- iOS if available
- Offline mode
- Online mode
- Empty states
- Longer text
- Small screen layout

## Testing Rule

Every utility function should have tests.

Every sync-related feature should have tests.

Simple UI screens can be tested manually at first.

## Recipe scaling & unit conversion (manual pass)

- Open a recipe → step servings up/down → quantities rescale in place; leaving and reopening resets to saved servings.
- Toggle Metric/US → quantities convert (fractions on US); kill and relaunch the app → the toggle choice is remembered.
- Mark an ingredient "Fixed amount" in the edit form → save → scale the recipe → that row stays constant and shows the "adjust to taste" hint.
- Norwegian device language: decimals show commas ("1,5 dl"); all new labels localized.

## Weekly meal planning (manual pass)

- Plan tab shows today (clay token) plus the next six days; every day ends with a dashed "+ Add dinner" slot.
- Plan a dinner in 2 taps: add slot → pick recipe → Add. It appears under the right day and on Today (if planned for today).
- Tap a meal card → entry sheet: change servings (persists), Move to another day, Remove.
- Recipe detail → "Plan it" → pick a day → entry lands in the plan with the recipe's servings.
- Today tab: tonight hero opens the recipe; tomorrow peek lists tomorrow's dinners; empty state's "Plan your week" jumps to the Plan tab.
- Soft-delete a planned recipe → its plan entries disappear everywhere.
- Norwegian device language: day names, all plan/today labels localized.
- Kill and relaunch — the plan persists.
