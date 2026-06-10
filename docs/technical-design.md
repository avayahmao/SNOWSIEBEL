# SNOW Ticket Manager — Technical Design Document

## 1. Overview

SNOW Ticket Manager is a Chrome sidebar extension (Manifest V3) that allows users to manage ServiceNow tickets directly from the browser sidebar. It leverages the user's existing SSO session — no API tokens, no additional authentication required.

### Target Instance

`avaya.service-now.com` (Avaya corporate ServiceNow instance)

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

### 2.3 Two-Step Script Injection

Chrome extensions cannot directly access page JavaScript context. The two-step injection pattern is required:

1. **Step 1**: Inject `content-snow.js` into the page's MAIN world. This file defines the `snowFetch()` helper function that has access to `g_ck` (ServiceNow CSRF token) and session cookies.

2. **Step 2**: Execute a self-contained function in the MAIN world that calls `snowFetch()`. Each function must be self-contained because `executeScript` functions run in isolation — they cannot reference variables from other functions.

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
├── panel.html             # Sidebar UI — layout, styles, 4-tab structure
├── panel.js               # Sidebar UI logic — event handlers, DOM rendering
└── icons/
    └── icon48.png         # Extension icon (48x48)
```

### 3.1 File Responsibilities

| File | Role | Execution Context |
|------|------|-------------------|
| `manifest.json` | Extension config, permissions, entry points | N/A |
| `background.js` | Service worker, message routing, script injection | Service Worker |
| `content-snow.js` | Provides `snowFetch()` for authenticated API calls | Page MAIN world |
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
| `getTicket` | `ticketNumber`, `includeJournal` | Fetch ticket details + optional journal |
| `listTickets` | `table`, `query`, `limit`, `fields` | List tickets by encoded query |
| `addComment` | `ticketNumber`, `comment`, `isWorkNote`, `noteType`, `visibility`, `effortMinutes` | Add comment/work note with metadata |
| `updateTicket` | `ticketNumber`, `fields` | Update ticket fields (state, priority) |
| `resolveTicket` | `ticketNumber`, `resolutionNote` | Resolve ticket with notes |

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

**Structure:** 4-tab interface in the Chrome Side Panel.

| Tab | Order | Default | Purpose |
|-----|-------|---------|---------|
| Comment | 1st | Yes | Add work notes/comments |
| Action | 2nd | No | Update state, priority, resolve |
| List | 3rd | No | Query ticket lists with filters |
| Query | 4th | No | Search single ticket by number |

### 4.4 panel.js — UI Logic

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `send(msg)` | Send message to background.js via `chrome.runtime.sendMessage` |
| `displayVal(value)` | Recursively extract display_value from SNOW's `{value, display_value}` objects |
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
| Update ticket | PUT | `/{table}/{sys_id}` | Body = fields to update |
| Add comment/note | PUT | `/{table}/{sys_id}` | Set `work_notes` or `comments` field |
| Resolve ticket | PUT | `/{table}/{sys_id}` | Set `state: "6"` + resolution notes |
| Log effort | POST | `/task_time_worked` | `document_id`, `time_worked`, `time_worked_units` |
| Get journal | GET | `/sys_journal_field?sysparm_query=element_id={sys_id}^name={table}^ORDERBYDESCsys_created_on` | Work notes + comments history |

### 5.2 Custom Fields

| Field | Type | Purpose |
|-------|------|---------|
| `u_work_note_type` | String (dropdown) | Work note category (Status Update, ADM 1-6, etc.) |
| `u_internal_public` | String | Visibility: "internal" or "public" |
| `u_resolution_notes` | String | Resolution notes for resolved tickets |

> **Note:** These field names are instance-specific and may differ across ServiceNow deployments.

### 5.3 Journal Query (Activity Log)

Work notes and comments are stored in the `sys_journal_field` table:
- `element_id` = ticket's sys_id
- `name` = table name (e.g., "incident")
- `element` = "work_notes" or "comments"
- `value` = the actual note content

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
  "permissions": ["cookies", "activeTab", "scripting", "sidePanel"],
  "host_permissions": ["*://avaya.service-now.com/*"]
}
```

- `cookies` — reserved for potential future cookie-based auth
- `activeTab` — access current tab for script injection
- `scripting` — inject content-snow.js into SNOW page
- `sidePanel` — open sidebar UI
- `host_permissions` — restricted to the Avaya ServiceNow instance only

---

## 7. Quick Filter Presets

| Preset | Encoded Query |
|--------|--------------|
| My Open Tickets | `active=true^assigned_to=javascript:gs.getUserID()` |
| My Recently Updated | `assigned_to=javascript:gs.getUserID()^ORDERBYDESCsys_updated_on` |
| My Resolved (7 days) | `assigned_to=javascript:gs.getUserID()^state=7^resolved_onONLast 7 days@javascript:gs.daysAgoStart(7)@javascript:gs.daysAgoEnd(0)` |
| My Group's Open | `active=true^assignment_group=javascript:gs.getUser().getMyGroups()` |
| P1/P2 Open | `active=true^priorityIN1,2` |
| All Open | `active=true^ORDERBYDESCsys_updated_on` |
| Updated Today | `sys_updated_onONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^ORDERBYDESCsys_updated_on` |
| Created Today | `sys_created_onONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^ORDERBYDESCsys_created_on` |
| Awaiting User Info | `state=4^assigned_to=javascript:gs.getUserID()` |

> **Note:** `javascript:gs.getUserID()` and similar are ServiceNow server-side evaluated expressions — they are not executed in the browser.

---

## 8. Limitations & Future Improvements

### Current Limitations

- Requires an active ServiceNow tab (extension will error if no SNOW tab is open)
- Session timeout follows SSO policy (~8 hours) — no auto-refresh
- Journal entries limited to most recent 20
- Custom field names (`u_work_note_type`, `u_internal_public`, `u_resolution_notes`) are instance-specific
- No offline capability or local caching

### Potential Future Enhancements

- Auto-detect SNOW tab changes and refresh data
- Keyboard shortcuts for common actions
- Notification support for ticket updates
- Configurable instance URL (support multiple ServiceNow instances)
- Dark mode / theme customization
- Ticket bookmarking / favorites
- Batch operations (update multiple tickets)
