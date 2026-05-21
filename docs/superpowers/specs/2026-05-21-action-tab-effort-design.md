# Action Tab Effort Time

**Date:** 2026-05-21

## Summary

Add time effort input to the Action tab so users can log effort when writing a note alongside a state change. Mirrors the existing Work Note tab's effort UI.

## Requirements

- Effort input is only processed when the Notes field is non-empty
- UI matches the Work Note tab: value input + minutes/hours unit selector
- Backend reuses existing `task_time_worked` and parent aggregate logic

## Changes

### `panel.html`

Add a `.row-2` in the Action panel, after the Notes textarea and before the Update button:

```html
<div class="row-2">
  <div class="form-group">
    <label>Effort Time</label>
    <input id="action-effort" type="text" placeholder="e.g. 30  (minutes)">
  </div>
  <div class="form-group">
    <label>&nbsp;</label>
    <select id="action-effort-unit">
      <option value="minutes">Minutes</option>
      <option value="hours">Hours</option>
    </select>
  </div>
</div>
```

### `panel.js` — Update button handler

After reading `resolutionNote`, parse effort values:

1. Read `action-effort` (raw string) and `action-effort-unit` (minutes|hours)
2. If `resolutionNote` is non-empty AND `effortRaw` is non-empty: parse to `effortMinutes`
3. Pass `effortMinutes` in the `send({ action: "updateTicket", ... })` message
4. On success, show effort feedback message (same pattern as Work Note tab)
5. Clear `action-effort` field after submit

### `background.js` — `handleMessage`

Line ~209: change condition from:

```js
if (msg.action === "addComment" && msg.effortMinutes)
```

to:

```js
if ((msg.action === "addComment" || msg.action === "updateTicket") && msg.effortMinutes)
```

No other backend changes needed — the existing `task_time_worked` creation and parent aggregate update apply to both actions.

## Files Touched

| File | Lines |
|------|-------|
| `chrome-extension/panel.html` | +10 (effort row) |
| `chrome-extension/panel.js` | +15 (parse + feedback) |
| `chrome-extension/background.js` | 1 (condition change) |
