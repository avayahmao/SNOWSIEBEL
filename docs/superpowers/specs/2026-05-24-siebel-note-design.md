# Siebel Note — GCT Activity Automation Design Spec

**Date:** 2026-05-24
**Status:** Approved

## Problem

Creating activities in the Avaya GCT (Siebel CRM) portal is a repetitive multi-step process:
navigate to Service → All Service Requests → query SR → drill into SR → Activities tab →
create activity → add comments → log time → change status → save. Agents repeat this
workflow dozens of times per day.

## Solution

Add a "Siebel Note" tab to the existing Chrome extension sidebar that automates the
post-login GCT activity creation workflow via DOM automation.

## Scope

- Post-login only — user handles authentication manually
- Single SR per automation run
- Two activity types: SR Status - Outbound, SR Note
- Integrated into existing sidebar as a 5th tab

## UI Design

### Location: New "Siebel Note" tab in sidebar

Tab order: List (default) → Work Note → Action → Query → **Siebel Note**

**Form elements:**

1. **SR Number** — text input, required. Accepts formats like `1-23642931672`
2. **Activity Type** — dropdown, default "SR Status - Outbound"
   - SR Status - Outbound
   - SR Note
3. **Comments** — textarea, required
4. **Time (min)** — number input, default 15
5. **Status** — dropdown, default "Done"
   - Done
   - In Progress
   - Pending
   - Cancelled
6. **Submit button** — "Create Activity & Save"
7. **Result area** — shows step-by-step progress

Send Update Email is always unchecked (no UI control exposed).

## Automation Flow

When the user clicks "Create Activity & Save", background.js orchestrates:

```
1. Find/open GCT tab (gct.avaya.com)
2. Navigate: Service → All Service Requests
3. Query: enter SR number in SR List Applet, execute query
4. Drill: click SR hyperlink in results
5. Navigate: click Activities tab in SR detail view
6. Create Activity:
   a. Click "New" in Activity List Applet
   b. Set activity type (e.g., SR Status - Outbound)
   c. Enter comments
   d. Set status (e.g., Done)
7. Log Time:
   a. Click "New" in Time List Applet
   b. Click Minutes field to activate calculator input
   c. Enter time value
8. Save: Ctrl+S
```

Each step reports back to the result area. If any step fails, the chain stops and
reports which step failed with the error.

## Architecture

### Files

| File | Change |
|---|---|
| `chrome-extension/panel.html` | Add Siebel Note tab button + form section |
| `chrome-extension/panel.js` | Tab switching, form handler, send request to background, display results |
| `chrome-extension/background.js` | New `siebelCreateActivity` message handler — finds GCT tab, injects content-gct.js, orchestrates step sequence |
| `chrome-extension/content-gct.js` | **New** — Siebel DOM interaction functions |

### Data Flow

```
panel.js ──{ siebelCreateActivity, { srNumber, activityType, comments, time, status } }──► background.js
                                                                                              │
                                                                                    find/inject GCT tab
                                                                                              │
                                                                                    ──{ cmd: "querySR" }──► content-gct.js
                                                                                    ◄──{ ok: true }        ──
                                                                                    ──{ cmd: "drillIn" }──►
                                                                                    ◄──{ ok: true }        ──
                                                                                    ... (each step)
                                                                                    ──{ cmd: "save" }─────►
                                                                                    ◄──{ ok: true }        ──
                                                                                              │
panel.js ◄──{ success: true, steps: [...] }────────────────────────────────────────────────┘
```

### Step-based protocol

`background.js` sends one command at a time to `content-gct.js`:

```js
// background → content
{ cmd: "querySR", srNumber: "1-23642931672" }

// content → background
{ ok: true }
// or
{ error: "SR not found" }
```

This matches the existing `snowFetch` injection pattern and keeps
retry/failure logic centralized in the service worker.

### GCT tab management

- If a GCT tab is already open → reuse it
- If not → open new tab to `https://gct.avaya.com/callcenter_enu/`
- If the tab shows login page → report "Please log in to GCT first"

## Error Handling

| Failure | Behavior |
|---|---|
| GCT tab not open / not logged in | "Open gct.avaya.com and log in first" |
| SR not found | "SR X not found. Check the number and try again." |
| Siebel UI element not found | "Could not find [element]. The Siebel UI may have changed." — stop with step name |
| Save fails | "Save failed — try saving manually with Ctrl+S" |
| Network timeout (>30s per step) | "Step timed out: [step name]. Check GCT tab responsiveness." |
| Siebel alert dialog | Dismiss automatically, report dialog text |

All errors stop the chain immediately — no partial saves. Form state is preserved for retry.

## Testing Strategy

1. **Manual end-to-end**: Test with a real GCT SR; happy path first, then edge cases
2. **`tests/siebel-note.test.js`**: Unit tests for content-gct.js logic (selector construction, data formatting) — not live Siebel
3. **Background handler tests**: Verify message routing, tab finding, injection logic

## Out of Scope

- Bulk activity creation across multiple SRs
- Login automation
- Activity types beyond SR Status - Outbound and SR Note
- Non-Done default status
- Preset comment templates
