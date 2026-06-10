# Design: List Tab — Stale Ticket Ordering & Highlighting

## Problem
The List tab currently shows tickets without a reliable "oldest first" ordering, and there is no visual cue when a ticket has not been updated for more than 7 days. Users want:
1. Tickets sorted by last update time ascending (stalest first).
2. A subtle visual indicator when a ticket was last updated more than 7 days ago.

## Decision
Implement **Option C** (hybrid) with **mild styling**.

## Sorting

1. Update the `PRESETS` object in `panel.js`:
   - Change `my-updated` and `all-open` from `ORDERBYDESCsys_updated_on` to `ORDERBYsys_updated_on`.
2. Add a defensive client-side sort in the `btn-list` click handler before rendering:
   - Parse `sys_updated_on` via `displayVal()` and `new Date()`.
   - Sort ascending (`da - db`).
   - Unparseable dates are pushed to the end.

## Stale Marking (>7 days)

### Helper functions (new, in `panel.js`)
- `isStale(updatedOn)` — returns `true` if the date string is parseable and `now - date > 7 days`.
- `staleBadge(updatedOn)` — returns HTML for a small badge like "Stale (8d)" if stale, otherwise empty string.
- `staleClass(updatedOn)` — returns `" stale-ticket"` if stale, otherwise `""`.

### Application
- **List panel**: append `staleClass()` to each `.ticket-card` class list; append `staleBadge()` to the card HTML.
- **Query panel**: apply the same helpers to the single ticket result for consistency.

### CSS additions (in `panel.html` `<style>`)
```css
.ticket-card.stale-ticket {
  border-left: 3px solid var(--danger);
  background: linear-gradient(to right, var(--danger-light) 0%, var(--surface) 40%);
}
.ticket-card.stale-ticket:hover {
  background: linear-gradient(to right, #FCE8E1 0%, var(--surface-alt) 40%);
}
.stale-badge {
  display: inline-flex; align-items: center; gap: 3px;
  background: var(--danger); color: #fff;
  padding: 1px 6px; border-radius: 999px;
  font-size: var(--text-xs); font-weight: 600; margin-left: 6px;
}
```

## Error Handling
- Invalid or missing `sys_updated_on`: treated as non-stale; sorted to the end.

## Testing Plan
- Manual: verify each preset in List tab renders oldest-first.
- Manual: verify a ticket updated >7 days ago shows the red left border and badge.
- Manual: verify Query tab single result shows the same stale indicator.

## Files Changed
- `chrome-extension/panel.js`
- `chrome-extension/panel.html`
