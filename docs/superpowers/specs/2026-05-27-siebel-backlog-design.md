# Siebel Backlog List Design

## Summary

Add a backlog list to the existing Siebel tab showing the user's open SRs and SRAs from the OCD API. Each card has an "Add Note" button that triggers the existing GCT automation flow.

## Data Source

**OCD API** at `https://ocd.avaya.com/api.php` — form-encoded POST.

Two endpoints:
- `object=user&method=backlog_sr` — returns SRs
- `object=user&method=backlog_sra` — returns Service Request Activities

Both return identical field structures differentiated by `activity_model_name` (`SBL-SR` vs `SBL-SRA`).

Credentials: `auth_user=aiq_service`, `auth_key=3eb5e739c865df854b54b8bcfb994225` (hardcoded in background.js).

## Username Detection

OCD API requires `user_name` parameter. Detection chain:

1. **Primary**: Call SNOW `/api/now/ui/identity` via an open ServiceNow tab to get the logged-in user's `user_name`, store in `chrome.storage.local`
2. **Fallback**: Read Siebel/GCT tab cookies (`gct.avaya.com`) for the username
3. **Last resort**: Prompt user to enter manually

## UI Layout

Siebel tab is reorganized as two sections:

### Top: Manual "Add a Note" Form (existing, unchanged)
Current form with SR/Activity ID input and "Add a Note in Siebel" button.

### Bottom: "My Backlog" Section
- "Load Backlog" button — **no auto-loading**, only fetches on explicit click
- `#siebel-backlog-results` container for rendered cards
- Loading spinner during fetch, error/retry on failure, "No items" on empty

### Card Layout

```
┌─────────────────────────────────────────────────┐
│ 1-23371258192  [SR] [Working] [BI]              │
│ Agent can not receive the hotline call...        │
│ Customer: The Venetian Macao P1                 │
│ Product: Oceana Solution                        │
│ Hours: 69.47 | Age: 160.93 | Updated: 2h ago   │
│ Last note: Related the old the SR 1-23317...    │
│ [+ Add Note]                                    │
└─────────────────────────────────────────────────┘
```

**Type badge**: `[SR]` or `[SRA]` (navy, Siebel theme)
**Status badge**: colored by state (Working=blue, In Progress=orange, etc.)
**Severity badge**: BI/NBI/CI
**Last note**: truncated with expand on click
**Add Note**: triggers `siebelCreateActivity` GCT automation with the `activity_number`
**SRA cards** show parent link: `Parent SR: 1-23287015462`

### Card Fields Mapping

| Display | OCD API Field |
|---------|--------------|
| Title/Link | `activity_number` |
| Type badge | `activity_model_name` (SR vs SRA) |
| Status | `activity_status_name` |
| Severity | `activity_severity_name` |
| Description | `activity_description` |
| Customer | `customer_name` |
| Product/Skill | `skill_name` |
| Hours | `hours` |
| Age | `age` |
| Last note | `last_status_note` |
| Updated | `updated_time` (unix timestamp) |
| Parent SR (SRA only) | `parent_activity_number` |

## Backend Changes

### manifest.json
- Add `*://ocd.avaya.com/*` to `host_permissions`

### background.js

Two new message handlers:

1. **`detectSnowUser`** — finds SNOW tab, calls `/api/now/ui/identity` via snowFetch, stores `user_name` in `chrome.storage.local`, returns username to panel

2. **`fetchOcdBacklog`** — reads stored `user_name` from `chrome.storage.local`, makes two parallel form-encoded POST requests to OCD API (`backlog_sr` + `backlog_sra`), merges `data` arrays, returns combined list to panel

OCD API calls use standard `fetch()` in the service worker — no content script injection needed (unlike SNOW calls which need `g_ck` token from the page).

### panel.js

1. "Load Backlog" button click handler in Siebel tab
2. Sends `{ action: "fetchOcdBacklog" }` to background.js
3. Renders cards in `#siebel-backlog-results`
4. Each card's "Add Note" sends `{ action: "siebelCreateActivity", srNumber: activity_number }` — reuses existing GCT flow

### No new files

All changes in existing files: manifest.json, background.js, panel.js, panel.html.

## Error Handling

- **No SNOW username detected**: "Please open a ServiceNow tab first"
- **OCD API failure**: Error message with status code + retry button
- **Empty backlog**: "No SR/SRA items in your backlog"
- **No GCT tab for Add Note**: Existing error handling from current Siebel flow applies

## Design Constraints

- OCD API credentials hardcoded (no settings UI — update via code change)
- No auto-loading or polling — explicit user action only
- No caching — each "Load Backlog" fetches fresh data
- Cards are read-only display — only action is "Add Note" via GCT
