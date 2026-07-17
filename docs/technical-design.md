# SNOW + Siebel Ticket Manager — Technical Design Document

## 1. Overview

SNOW + Siebel Ticket Manager is a Chrome sidebar extension (Manifest V3) that lets users manage ServiceNow tickets and Siebel CRM activities directly from the browser sidebar. It leverages the user's existing SSO/browser sessions — no API tokens, no additional authentication required.

This document focuses on the ServiceNow side. The Siebel CRM integration (GCT automation + OCD backlog API) follows the same injection pattern but targets `gct.avaya.com` via `content-gct.js` and `ocd.avaya.com` via direct REST.

### Target Instances

- `avaya.service-now.com` — ServiceNow (ticket management)
- `gct.avaya.com` — Siebel CRM (activity creation via the Siebel JS API)
- `ocd.avaya.com` — OCD API (Siebel backlog fetch)

### Key Constraints

- SSO-only authentication (SAML), no API token or Basic Auth available
- Must operate within the browser's existing session context
- Chrome Extension Manifest V3 compliance (no remote code execution, strict CSP)

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────┐
│                    Chrome Browser                     │
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │              │    │    ServiceNow Web Page     │   │
│  │   Side Panel │    │  (avaya.service-now.com)  │   │
│  │  (panel.html)│    │                            │   │
│  │              │    │  ┌──────────────────────┐  │   │
│  │  panel.js    │    │  │  content-snow.js     │  │   │
│  │  (UI logic)  │    │  │  (MAIN world)        │  │   │
│  │              │    │  │                      │  │   │
│  └──────┬───────┘    │  │  snowFetch()         │  │   │
│         │            │  │  - reads g_ck token  │  │   │
│         │ messages   │  │  - uses session      │  │   │
│         │            │  │    cookies            │  │   │
│  ┌──────▼───────┐    │  │  - calls SNOW REST  │  │   │
│  │              │    │  │    API                │  │   │
│  │ background.js│    │  └──────────┬───────────┘  │   │
│  │ (service     │    │             │ fetch()       │   │
│  │  worker)     │    │             ▼               │   │
│  │              │    │  /api/now/table/{table}     │   │
│  │ - routing    │    └──────────────────────────┘   │
│  │ - inject     │                                    │
│  │ - orchestrate│                                    │
│  └──────────────┘                                    │
└─────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
User Action → panel.js → chrome.runtime.sendMessage() → background.js
                                                         │
                                                         ▼
                                              chrome.scripting.executeScript({
                                                target: { tabId },
                                                world: "MAIN",
                                                files: ["content-snow.js"]
                                              })
                                                         │
                                                         ▼
                                              chrome.scripting.executeScript({
                                                target: { tabId },
                                                world: "MAIN",
                                                func: <pageFunction>,
                                                args: [...]
                                              })
                                                         │
                                                         ▼
                                              snowFetch() → fetch(relativeUrl)
                                                         │
                                                         ▼
                                              ServiceNow REST API response
                                                         │
                                                         ▼
                                              background.js → sendResponse()
                                                         │
                                                         ▼
                                              panel.js → update UI
```

### 2.3 Cached Script Injection

Chrome extensions cannot directly access page JavaScript context, so helpers are injected into the page's MAIN world. Each injectable helper (`content-snow.js`, `content-gct.js`) is injected **once per tab** and cached in a `Set` (`snowInjectedTabs` / `gctInjectedTabs`); subsequent operations on the same tab skip re-injection and run only the function-exec step.

1. **Step 1 (once per tab)**: Inject the helper file (`content-snow.js` defines `snowFetch()` with access to `g_ck` and session cookies; `content-gct.js` provides the Siebel JS API wrappers).
2. **Step 2 (every call)**: Execute a self-contained function in the MAIN world that calls the helper. Functions must be self-contained — `executeScript` functions run in isolation and cannot reference variables from other functions.

A global `chrome.tabs.onUpdated` listener clears both caches on a top-level reload (`status === "loading"`) so a hard `F5` — which tears down the MAIN world — forces a fresh re-inject on the next operation. SPA route changes and iframe refreshes don't trip the filter, so the cache persists across normal in-app navigation.

> **Safety:** caching is safe because `snowFetch()` reads the `g_ck` token live on every call, never capturing it at injection time — a rotated token is picked up automatically.

### 2.4 Authentication Model

```
┌─────────────────────────────────────────┐
│         Browser Session                  │
│                                          │
│  SSO Login → SAML → Session Cookie       │
│                          │               │
│                          ▼               │
│              ServiceNow sets g_ck         │
│              (CSRF/X-UserToken)           │
│                          │               │
│              ┌───────────▼────────────┐   │
│              │  snowFetch()           │   │
│              │  headers:              │   │
│              │    X-UserToken: g_ck   │   │
│              │  credentials:          │   │
│              │    same-origin         │   │
│              └────────────────────────┘   │
└─────────────────────────────────────────┘
```

Authentication relies on two mechanisms:
- **Session cookies**: Automatically included by `fetch()` with `credentials: "same-origin"`
- **g_ck token**: ServiceNow's CSRF token, read from the page's global scope and sent as `X-UserToken` header

---

## 3. File Structure

```
chrome-extension/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker — message routing & API orchestration
├── content-snow.js        # Injected into SNOW page (MAIN world) — snowFetch helper
├── content-gct.js         # Injected into Siebel/GCT page (MAIN world) — headless BC API automation
├── note-fields.js         # Shared module — builds comment/work-note field maps (importScripts)
├── panel.html             # Sidebar UI — layout, styles, 5-tab structure
├── panel.js               # Sidebar UI logic — event handlers, DOM rendering
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 3.1 File Responsibilities

| File | Role | Execution Context |
|------|------|-------------------|
| `manifest.json` | Extension config, permissions, entry points | N/A |
| `background.js` | Service worker, message routing, script injection, orchestration, OCD API calls | Service Worker |
| `content-snow.js` | Provides `snowFetch()` for authenticated SNOW API calls | SNOW page MAIN world |
| `content-gct.js` | Automates Siebel CRM via the Siebel JS API (`theApplication()`, `SiebelApp.S_App`) | Siebel page MAIN world |
| `note-fields.js` | Builds the work-note/comment field maps shared by background.js | Loaded via `importScripts` in background.js |
| `panel.html` | Sidebar UI layout and CSS styles | Side Panel |
| `panel.js` | UI logic, tab switching, form handling, DOM rendering | Side Panel |

---

## 4. Module Design

### 4.1 background.js — Service Worker

**Responsibilities:**
- Listen for messages from panel.js
- Find an active ServiceNow tab
- Inject content-snow.js and execute API functions in the page's MAIN world
- Orchestrate multi-step operations (e.g., get ticket sys_id → then update)

**Message Protocol:**

```javascript
// Request
{ action: string, ticketNumber?: string, ... }

// Response
{ ok: boolean, data?: any, error?: string }
```

**Supported Actions:**

| Action | Parameters | Description |
|--------|-----------|-------------|
| `getTicket` | `ticketNumber`, `includeJournal`, `includeCi` | Fetch ticket details + optional journal (work_notes/comments) and CI remote-access info |
| `listTickets` | `table`, `query`, `limit`, `fields`, `includeCi` | List tickets by encoded query; optionally enrich each with CI details (batched) |
| `getJournal` | `ticketNumber` | Fetch the journal fields for a ticket |
| `addComment` | `ticketNumber`, `note`, `noteType`, `effortMinutes`, … | Add work note with metadata + optional effort time |
| `updateTicket` | `ticketNumber`, `fields`, `effortMinutes` | Update ticket fields (state, priority, status reason, follow-up) |
| `resolveTicket` | `ticketNumber`, `resolutionNote`, `statusReason` | Resolve ticket with notes |
| `alarmClose` | `ticketNumber`, `note`, `effortMinutes`, `statusReason` | Chain alarm INC through to Closed (state steps + closure code + effort) |
| `takeTicket` | `ticketNumber`, `table` (optional) | Assign to current user + set the per-table work-started state (`TABLE_STATES[table].workStartState`). Infinity "Take" and German-queue "Take" both route through here. `table` is the authoritative `sys_class_name` from the panel; falls back to `detectTable` for back-compat. |
| `getNoteTypes` | — | Fetch Work Note Type options from `sys_choice` |
| `getCredentials` | `ciSysId` | Lazy-load CI device credentials |
| `openSiebel` | `siebelId` | Open an SR/Activity in the Siebel CRM tab |
| `siebelCreateActivity` | `srNumber` | Create a new Siebel Activity on an SR (GCT automation) |
| `fetchOcdBacklog` | — | Fetch the user's Siebel backlog (SRs/SRAs) from the OCD API |
| `debugFields` | — | Diagnostic: dump available fields on the instance |

**Table Detection:**

```javascript
const TABLE_MAP = {
  INC: "incident",      CHG: "change_request",
  PRB: "problem",       RIT: "sc_req_item",
  REQ: "sc_request",    TAS: "task",
  KB0: "kb_knowledge",  STY: "rm_story",
  SCT: "sc_task",
};
```

Table is detected from the first 3 characters of the ticket number.

> **`resolveTable` (note-fields.js, v2.12+) is the authoritative resolver for List rendering and Take.** It prefers `sys_class_name` from the API response (correct for every record, including the queue's mixed `task`/`change_task`/`problem` results where number-prefix guessing fails — `TASK` prefix can be `task` or `change_task`, and `detectTable` doesn't recognize `TASK`, silently defaulting to `incident`). `detectTable` / `TABLE_MAP` above remains the fallback for single-ticket lookups (Query/Note/Action tabs) where `sys_class_name` isn't requested, and for cached data.

### 4.2 content-snow.js — API Helper

**Responsibilities:**
- Provide `snowFetch(method, relativeUrl, body)` function
- Automatically attach authentication headers
- Handle HTTP error responses

```javascript
async function snowFetch(method, relUrl, body) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  // Attach CSRF token from page context
  if (typeof g_ck !== "undefined" && g_ck)
    headers["X-UserToken"] = g_ck;

  const opts = { method, headers, credentials: "same-origin" };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(relUrl, opts);
  const text = await resp.text();
  if (!resp.ok) throw new Error("HTTP " + resp.status + ": " + text);
  return JSON.parse(text);
}
```

### 4.3 panel.html — UI Layout

**Structure:** 5-tab interface in the Chrome Side Panel.

| Tab | Order | Default | Purpose |
|-----|-------|---------|---------|
| List | 1st | Yes | Query ticket lists with filters + sort; inline actions |
| Note (Comment) | 2nd | No | Add work notes/comments |
| Action | 3rd | No | Update state, priority, resolve; alarm quick-close |
| Query | 4th | No | Search a single ticket by number |
| Siebel | 5th | No | Open Siebel activities; Siebel backlog (OCD API) |

### 4.4 panel.js — UI Logic

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `send(msg)` | Send message to background.js via `chrome.runtime.sendMessage` |
| `displayVal(value)` | Extract display_value from SNOW's `{value, display_value}` objects |
| `valueVal(value)` | Like `displayVal` but prefers `.value` — used where display_value is a label, not the sort key (e.g. `state`) |
| `getStateConfig(table)` | Return the per-table state config (labels, transitions, status reasons, alarm chains) |
| `compareTickets(a,b,key,dir)` | Sort comparator for the List tab (id/priority/stale/updated/created/state × asc/desc) |
| `buildStatusReasonOptions(sel)` | Build the Closure Code dropdown options from the per-table state config |
| `stateBadge(state)` | Render state with colored badge + raw code |
| `esc(s)` | HTML entity escaping (prevent XSS) |
| `formatField(label, value)` | Render a label:value field row |

**ServiceNow Value Format:**

ServiceNow REST API with `sysparm_display_value=all` returns fields as:
```json
{
  "assigned_to": {
    "value": "sys_id_hash",
    "display_value": "John Smith"
  }
}
```

`displayVal()` recursively extracts the human-readable string from these nested objects.

**State Mappings:**

| Code | Label | CSS Class |
|------|-------|-----------|
| 1 | New | `state-new` (blue) |
| 2 | In Progress | `state-active` (orange) |
| -5 | Pending | `state-active` (orange) |
| 3 | Awaiting Problem | `state-active` (orange) |
| 4 | Service Restored | `state-resolved` (green) |
| 5 | Assigned | `state-active` (orange) |
| 6 | Resolved | `state-resolved` (green) |
| 7 | Closed | `state-closed` (gray) |
| 8 | Cancelled | `state-closed` (gray) |

---

## 5. API Interactions

### 5.1 ServiceNow REST API Endpoints

All calls go to `https://avaya.service-now.com/api/now/table/{table}`.

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| Get ticket | GET | `/{table}?sysparm_query=number={num}&sysparm_display_value=all` | Returns single ticket |
| List tickets | GET | `/{table}?sysparm_query={query}&sysparm_limit={n}&sysparm_display_value=all` | Returns array |
| Update ticket | PATCH | `/{table}/{sys_id}` | Body = fields to update |
| Add comment/note | PATCH | `/{table}/{sys_id}` | Set `work_notes` or `comments` field |
| Resolve/close ticket | PATCH | `/{table}/{sys_id}` | Set `state` + resolution/close notes |
| Log effort | POST | `/task_time_worked` | `task`, `time_worked`, `user`, `comments` |
| Aggregate time | PATCH | `/{table}/{sys_id}` | Update `time_worked` field directly |
| Get journal | GET | `/{table}/{sys_id}?sysparm_fields=work_notes,comments&sysparm_display_value=all` | Read from the record, not `sys_journal_field` (ACL-blocked on this instance) |

### 5.2 Custom Fields

| Field | Type | Purpose |
|-------|------|---------|
| `u_wn_type` | String (dropdown, from `sys_choice`) | Work note category (Internal Only, Status Update, etc.) |
| `u_status_reason` | String (dropdown, from state config) | Closure/close reason — set on Resolved/Closed steps (Repaired, Alarm(s) Cleared on Access, …) |
| `u_resolution_notes` | String | Resolution notes for resolved tickets |
| `u_private_note` | String | Private note written alongside the close note |

> **Note:** These field names are instance-specific and may differ across ServiceNow deployments.

### 5.3 Journal Query (Activity Log)

Work notes and comments are read directly from the ticket record's `work_notes` and `comments` fields (via `GET /{table}/{sys_id}?sysparm_fields=work_notes,comments`), **not** from the `sys_journal_field` table — that table has ACL restrictions on this instance and returns empty results via REST API.

ServiceNow returns these journal fields as concatenated text where each entry has a header line in the format `YYYY-MM-DD HH:MM:SS - Author (info)`. The parser splits on this pattern, extracts datetime/author/body, and merges work notes and comments into a single list sorted newest-first. Duplicate entries (stubs + email bodies) are merged automatically.

---

## 6. Security Considerations

### 6.1 Authentication

- No credentials stored — relies entirely on browser SSO session
- `g_ck` token is read from page context at runtime, never persisted
- Session follows ServiceNow's SSO timeout policy (~8 hours)

### 6.2 Content Security

- No inline event handlers (CSP compliance) — uses delegated event listeners with `data-*` attributes
- HTML output escaped via `esc()` function to prevent XSS
- Extension has no `externally_connectable` config — only panel.js can send messages

### 6.3 Permissions

```json
{
  "permissions": ["activeTab", "scripting", "sidePanel"],
  "host_permissions": ["*://avaya.service-now.com/*", "*://gct.avaya.com/*", "*://ocd.avaya.com/*"]
}
```

- `activeTab` — access current tab for script injection
- `scripting` — inject `content-snow.js` / `content-gct.js` into SNOW / Siebel pages
- `sidePanel` — open sidebar UI
- `host_permissions` — ServiceNow (ticket management), Siebel CRM / GCT (activity creation), OCD API (Siebel backlog)

---

## 7. Quick Filter Presets

The List tab exposes these presets (defined in `PRESETS` in `panel.js`, plus the German queue which has its own `GERMAN_NS_QUEUE_QUERY` constant):

| Preset | Encoded Query |
|--------|--------------|
| My Open Tickets | `active=true^assigned_to=javascript:gs.getUserID()` |
| My Open Alarms | `active=true^assigned_to=javascript:gs.getUserID()^contact_type=Alarm` |
| My Recently Updated | `assigned_to=javascript:gs.getUserID()^ORDERBYDESCsys_updated_on` |
| My Resolved (7 days) | `assigned_to=javascript:gs.getUserID()^state=7^resolved_onONLast 7 days@javascript:gs.daysAgoStart(7)@javascript:gs.daysAgoEnd(0)` |
| Awaiting User Info | `state=4^assigned_to=javascript:gs.getUserID()` |
| Infinity Alarms (Unassigned) | `active=true^state=1^assignment_group.name=Avaya Infinity Platform^assigned_toISEMPTY^EQ` |
| German Non-Standard Queue | 3-part UNION on the `task` base table (group `9ed0c8781b4b3954ee7b1131b24bcb9d`); see `GERMAN_NS_QUEUE_QUERY` in `panel.js` for the full decoded string |

> **Notes:**
> - `javascript:gs.getUserID()` and similar are ServiceNow server-side evaluated expressions — they are not executed in the browser.
> - The Infinity preset's `assignment_group.name=` uses a dot-walk (not sys_id) because the sys_id form hits an ACL that silently excludes unassigned incidents, and the trailing `^EQ` is required on this instance or the `ISEMPTY` condition is dropped (matches SNOW's own "Open - Unassigned" module). Each Infinity card has a "Take" link that assigns the incident to the user and moves it to the work-started state for its table.
> - **My Tickets presets fan out to `incident` + `change_request` + `problem` in parallel** (`Promise.allSettled`, v2.12+) and merge into one sorted list capped at the user's Limit. A 400/ACL failure on one table surfaces an inline warning without losing the others.
> - **The German Non-Standard Queue queries the `task` base table** (not `incident`) because the queue mixes record classes. The UNION separator is `^NQ` (caret-N-Q) — NOT bare `NQ`, which SNOW parses as a malformed single condition returning 0 results (root cause of a real bug during development). Each queue card has a "Take" link. Switching off the German preset resets the hidden `#list-table` to `incident` so queue-mode state doesn't leak into the next My Tickets search.
> - **Take sets a per-table work-started state** (v2.12+): incident→2 (In Progress), problem→102 (Assess), change_request→-1 (Implement), task/change_task→2 (Work in Progress). `sc_request` has `workStartState: null` (no in-progress state) and is assigned without a state change.

---

## 8. Limitations & Future Improvements

### Current Limitations

- Requires an active ServiceNow tab (extension will error if no SNOW tab is open); Siebel features likewise require a logged-in GCT tab
- Session timeout follows SSO policy (~8 hours) — no auto-refresh
- Custom field names (`u_wn_type`, `u_status_reason`, `u_resolution_notes`) are instance-specific
- Closure-code options come from a hardcoded per-table state config, not a live `sys_choice` fetch (the fetch returned nothing on this instance)
- No offline capability or local caching

### Potential Future Enhancements

- Auto-detect SNOW tab changes and refresh data
- Keyboard shortcuts for common actions
- Notification support for ticket updates
- Configurable instance URL (support multiple ServiceNow instances)
- Dark mode / theme customization
- Ticket bookmarking / favorites
- Batch operations (update multiple tickets)
