# List View — Remote Access Info Design

**Date:** 2026-06-10
**Target version:** v2.9
**Status:** Approved — ready for implementation

## Problem

The Query tab fetches and renders full CI Remote Access details (IP, SE ID, NAT IP, Connectivity, device credentials) for the single ticket being inspected. The List tab — which is the default tab and shows up to 100 tickets (default 50) — only renders the muted `CI: <name>` line. Users investigating multiple tickets must drop into Query for each one to see remote access info, which defeats the purpose of the at-a-glance List view.

## Goals

- Show Remote Access fields (IP, SE ID, NAT IP, Connectivity) inline on every List card without N+1 API calls.
- Keep credential disclosure deliberate — never preload device passwords for tickets the user merely listed.
- Preserve current Query tab behavior (no regressions).
- Ship a Chrome Web Store-ready zip.

## Non-goals

- No changes to the Action, Work Note, Query, or Siebel tabs.
- No CI info on Siebel backlog cards (different data model).
- No persistent caching across panel sessions — the bulk fetch runs on every Search click.

## Approach

Two-tier fetch strategy:

1. **Bulk fetch (eager)** — one `cmdb_ci?sysparm_query=sys_idIN...` call per list load, returning lightweight fields only. Merged onto tickets as `_ci`.
2. **Credential fetch (lazy)** — one `u_cmdb_passwords?sysparm_query=u_configuration_item=<id>...` call per card, only when the user clicks "▶ Device Password". Result cached on the DOM node.

## Backend changes (`chrome-extension/background.js`)

### New function: `getCiDetailsBulkInPage(ciSysIds)`

Runs in SNOW MAIN world. Takes an array of unique CI sys_ids, performs one `IN` query, returns a `{[sysId]: ciData}` map.

```
GET /api/now/table/cmdb_ci
    ?sysparm_query=sys_idIN{id1},{id2}...
    &sysparm_fields=sys_id,name,ip_address,serial_number,asset_tag,
                    u_se_id,u_nat_ip_address,u_primary_connectivity_method
    &sysparm_display_value=all
    &sysparm_limit={ciSysIds.length}
```

Each map entry: `{ciName, seId, ipAddress, natIp, connectivity}`. No `credentials` key — that's lazy.

### New function: `getCredentialsInPage(ciSysId)`

Runs in SNOW MAIN world. Fetches `u_cmdb_passwords` filtered by `u_configuration_item=<ciSysId>^u_active=true`, returns `[{username, password, loginType, accessType}]` (empty array if none, throws on HTTP error).

### Extend `listTickets` handler

When `msg.includeCi` is true:

1. Run `listTicketsInPage` as today.
2. Collect unique non-empty `cmdb_ci.value` sys_ids from results.
3. If any exist, call `getCiDetailsBulkInPage(uniqueIds)`.
4. Merge each map entry onto its ticket as `t._ci`.
5. On bulk-call failure: log warning, return tickets without `_ci` (graceful degradation; cards fall back to muted `CI: <name>`).

### New `getCredentials` action

```
msg = { action: "getCredentials", ciSysId: "<sys_id>" }
→ injectAndExec(tab.id, getCredentialsInPage, [ciSysId])
→ returns [{username, password, loginType, accessType}, ...]
```

## Frontend changes (`chrome-extension/panel.js`)

### 1. Pass `includeCi` flag

[panel.js:969](chrome-extension/panel.js:969):

```js
const tickets = await send({ action: "listTickets", table, query, limit, includeCi: true });
```

### 2. Refactor `renderCiBlock`

Split into two helpers; `renderCiBlock` becomes a thin composer for Query tab parity:

- `renderCiFields(ci)` → IP, SE ID, NAT IP, Connectivity rows (no credentials)
- `renderCredentialsBlock(prefix, credentials)` → existing collapsible password section
- `renderCiBlock(ci, prefix)` → `renderCiFields(ci) + (ci.credentials ? renderCredentialsBlock(prefix, ci.credentials) : "")`

Query tab keeps eager credential loading — no behavior change there.

### 3. Update list card rendering

Replace [panel.js:998-999](chrome-extension/panel.js:998) with:

```js
const ciRef = t.cmdb_ci;
const ciSysId = (typeof ciRef === "object" && ciRef !== null) ? ciRef.value : ciRef;
if (t._ci && ciSysId) {
  html += '<div class="ticket-field" style="margin-top:6px"><b>Remote Access:</b></div>';
  html += renderCiFields(t._ci);
  const credKey = 'l-' + (ciSysId || Math.random().toString(36).slice(2,8));
  html += '<a class="load-creds-link" data-ci-sysid="' + esc(ciSysId) + '" data-prefix="' + esc(credKey) + '" style="cursor:pointer;color:var(--primary);font-size:var(--text-sm)">&#9654; Device Password</a>';
  html += '<div class="creds-container" id="creds-' + esc(credKey) + '" style="display:none;margin-top:4px"></div>';
} else if (displayVal(t.cmdb_ci)) {
  html += '<div class="ticket-field" style="color:var(--text-muted)"><b>CI:</b> ' + esc(displayVal(t.cmdb_ci)) + '</div>';
}
```

### 4. New delegated click handler for `.load-creds-link`

```js
if (e.target.classList.contains("load-creds-link")) {
  e.preventDefault();
  const link = e.target;
  const ciSysId = link.dataset.ciSysid;
  const prefix = link.dataset.prefix;
  const container = document.getElementById("creds-" + prefix);

  // Toggle if already loaded
  if (link._loaded) {
    if (container.style.display === "none") {
      container.style.display = "block";
      link.innerHTML = "&#9660; Device Password";
    } else {
      container.style.display = "none";
      link.innerHTML = "&#9654; Device Password";
    }
    return;
  }

  // First click: fetch
  container.style.display = "block";
  container.innerHTML = '<div class="loading">Loading credentials...</div>';
  send({ action: "getCredentials", ciSysId: ciSysId })
    .then((creds) => {
      link._loaded = true;
      link.innerHTML = "&#9660; Device Password" + (creds.length ? " (" + creds.length + ")" : "");
      if (!creds || creds.length === 0) {
        container.innerHTML = '<div class="ticket-field" style="color:var(--text-muted)">No active credentials</div>';
      } else {
        container.innerHTML = renderCredentialsBlock(prefix, creds);
      }
    })
    .catch((err) => {
      container.innerHTML = '<div class="error">' + userFacingError(err.message) + '</div>';
    });
  return;
}
```

## Render order on list cards

1. Number link + stale badge
2. Alarm badge (if applicable)
3. Description, State, Priority, Assigned to, Updated
4. **Remote Access section (NEW)** — `<b>Remote Access:</b>` heading, then `renderCiFields` block, then `▶ Device Password` lazy link
5. Action links row
6. Inline forms (Add Note, Update Status, Close Alarm) appear below action links

## Edge cases

| Case | Behavior |
|---|---|
| Ticket has no `cmdb_ci` | Omit Remote Access section entirely |
| Bulk CI call fails | Fall back to muted `CI: <name>` line for tickets that have a CI |
| Bulk CI returns no entry for a sys_id (per-CI ACL deny) | Same fallback |
| Credentials lazy fetch fails | Inline error in creds container; toggle label stays `▶ Device Password` so user can retry |
| Credentials lazy fetch returns empty array | Show "No active credentials"; cache empty result (no refetch) |
| Same CI on N tickets | Bulk fetch deduplicates via `Set`; one map entry shared by all cards |

## Performance bounds

- 50 tickets, ~30 unique CIs typical → 1 extra IN-query call, response ≈ 8 KB
- 100 tickets, ~60 unique CIs worst case → ~15 KB response, query string ≈ 2 KB (well under URL limits)
- Credentials only fetched on demand → zero upfront cost for unused cards

## Release packaging (v2.9)

### Files to update

1. **[chrome-extension/manifest.json](chrome-extension/manifest.json)** — `"version": "2.9"`
2. **[CHANGELOG.md](CHANGELOG.md)** — new `## [2.9] - 2026-06-10` entry at top
3. **[CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)** — version field `2.8` → `2.9`; append Remote Access note to the List feature description

### Release zip

- Build `releases/SNOW-Siebel-Ticket-Manager-v2.9.zip`
- Contents: everything inside `chrome-extension/` at the zip root (`manifest.json`, `panel.html`, `*.js`, `icons/`) — matches existing convention
- Exclude: `.git`, test files, dev tooling
- Verify: no obfuscated code (Chrome Web Store policy); the XOR-encoded OCD creds already have a comment explaining the decode is intentionally readable

### Verification gate (must pass before declaring done)

- [ ] `manifest.json` version = `2.9`
- [ ] CHANGELOG.md and CHROMEWEBSTORE.md updated to 2.9
- [ ] `releases/SNOW-Siebel-Ticket-Manager-v2.9.zip` exists with correct contents
- [ ] Manual smoke test in Chrome:
  - Load `chrome-extension/` as unpacked extension
  - Open the sidebar; List tab auto-loads "My Open Tickets"
  - At least one card shows the Remote Access block (IP/SE ID/NAT IP/Connectivity)
  - Click `▶ Device Password` on a card — credentials lazy-load and render
  - Click again — toggles closed without refetch
  - Confirm Query tab still shows credentials eagerly (no regression)

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `cmdb_ci` table ACL denies bulk query | Graceful degradation: tickets fall back to muted `CI: <name>` line |
| URL length with 100 sys_ids in IN query | ~2 KB query string; well below practical browser/server limits |
| User expects credentials inline like Query tab | Single click `▶ Device Password` adds ~500 ms latency on first open; tradeoff is acceptable per UX decision in brainstorm |
| Stale `_loaded` cache after re-Search | Each Search rebuilds the list HTML, so new DOM nodes start with `_loaded` undefined — no stale-cache risk |
