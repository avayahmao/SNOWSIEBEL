# Siebel Backlog List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "My Backlog" list to the Siebel tab showing SRs and SRAs from the OCD API, with inline "Add Note" that triggers GCT automation.

**Architecture:** Backend (background.js) makes direct `fetch()` calls to the OCD API (form-encoded POST). Username is auto-detected from SNOW via snowFetch. Frontend (panel.js) renders cards in a new section below the existing manual form in the Siebel tab panel.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JS, OCD REST API (form-encoded POST)

---

### Task 1: Add OCD host permission to manifest.json

**Files:**
- Modify: `chrome-extension/manifest.json:7`

- [ ] **Step 1: Add OCD host permission**

In `chrome-extension/manifest.json`, change line 7 from:
```json
"host_permissions": ["*://avaya.service-now.com/*", "*://gct.avaya.com/*"],
```
to:
```json
"host_permissions": ["*://avaya.service-now.com/*", "*://gct.avaya.com/*", "*://ocd.avaya.com/*"],
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/manifest.json
git commit -m "feat: add OCD API host permission for Siebel backlog"
```

---

### Task 2: Add SNOW username detection in background.js

**Files:**
- Modify: `chrome-extension/background.js:264-272` (after `getUserIdInPage`)
- Modify: `chrome-extension/background.js:446` (in `handleMessage`)

- [ ] **Step 1: Add `getSnowUserNameInPage` function**

Insert after the `getUserIdInPage` function (after line 272):

```javascript
function getSnowUserNameInPage() {
  // Try client-side globals first (synchronous)
  try { if (typeof g_user !== "undefined" && g_user && g_user.userName) return g_user.userName; } catch (e) {}
  try { if (typeof g_user_name !== "undefined" && g_user_name) return g_user_name; } catch (e) {}
  // Fallback: query sys_user via API
  return snowFetch("GET", "/api/now/table/sys_user?sysparm_query=javascript:gs.getUserName()&sysparm_limit=1&sysparm_fields=user_name")
    .then(function(d) { return d.result && d.result[0] ? d.result[0].user_name : ""; })
    .catch(function() { return ""; });
}
```

- [ ] **Step 2: Add `detectSnowUser` message handler**

In `handleMessage`, insert before the `siebelCreateActivity` block (before line 448):

```javascript
  if (msg.action === "detectSnowUser") {
    // Primary: try SNOW API
    try {
      const tab = await findSnowTab();
      const userName = await injectAndExec(tab.id, getSnowUserNameInPage, []);
      if (userName) {
        await chrome.storage.local.set({ snowUserName: userName });
        return { userName: userName, source: "snow" };
      }
    } catch (e) { /* SNOW tab not available */ }

    // Fallback: try Siebel/GCT cookies
    try {
      const cookie = await chrome.cookies.get({ url: "https://gct.avaya.com", name: "OCD3-nm" });
      if (cookie && cookie.value) {
        await chrome.storage.local.set({ snowUserName: cookie.value });
        return { userName: cookie.value, source: "cookie" };
      }
    } catch (e) { /* cookies API failed */ }

    throw new Error("Please open a ServiceNow tab first");
  }
```

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat: add SNOW username detection for OCD API"
```

---

### Task 3: Add OCD backlog fetch in background.js

**Files:**
- Modify: `chrome-extension/background.js` (after the `detectSnowUser` handler)

- [ ] **Step 1: Add OCD API constants**

Insert near the top of background.js, after the `INSTANCE_URL` constant (after line 3):

```javascript
const OCD_API_URL = "https://ocd.avaya.com/api.php";
const OCD_AUTH = { auth_user: "aiq_service", auth_key: "3eb5e739c865df854b54b8bcfb994225" };
```

- [ ] **Step 2: Add `fetchOcdBacklog` message handler**

Insert after the `detectSnowUser` handler (before `siebelCreateActivity`):

```javascript
  if (msg.action === "fetchOcdBacklog") {
    // Get stored username
    const stored = await chrome.storage.local.get("snowUserName");
    const userName = stored.snowUserName;
    if (!userName) throw new Error("Username not detected. Click 'Load Backlog' again after opening ServiceNow.");

    // Build form-encoded params
    function buildOcdParams(method) {
      return new URLSearchParams({
        ...OCD_AUTH,
        object: "user",
        method: method,
        user_name: userName
      });
    }

    // Fetch both SR and SRA backlogs in parallel
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    const [srResp, sraResp] = await Promise.all([
      fetch(OCD_API_URL, { method: "POST", headers, body: buildOcdParams("backlog_sr") }).then(r => r.json()),
      fetch(OCD_API_URL, { method: "POST", headers, body: buildOcdParams("backlog_sra") }).then(r => r.json())
    ]);

    if (srResp.code !== 200) throw new Error("OCD API error (SR): " + (srResp.status || "unknown"));
    if (sraResp.code !== 200) throw new Error("OCD API error (SRA): " + (sraResp.status || "unknown"));

    const srItems = (srResp.data || []).map(function(item) { item._type = "SR"; return item; });
    const sraItems = (sraResp.data || []).map(function(item) { item._type = "SRA"; return item; });
    const allItems = srItems.concat(sraItems);

    return { userName: userName, items: allItems };
  }
```

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat: add OCD backlog fetch (SR + SRA) in background service worker"
```

---

### Task 4: Add CSS for Siebel backlog cards

**Files:**
- Modify: `chrome-extension/panel.html` (in the `<style>` block, after existing Siebel styles)

- [ ] **Step 1: Add Siebel card and badge CSS**

Insert before the closing `</style>` tag, after the existing `.badge-siebel` styles. Find the `step-progress` section (around line 265) and insert after the `.step-item.step-fail` rule:

```css
/* ── Siebel Backlog ── */
.sbl-section-title { font-size: var(--text-sm); font-weight: 700; color: var(--navy); margin: 18px 0 8px; padding-top: 14px; border-top: 1px solid var(--border-light); }
.sbl-card {
  padding: 10px 14px; border-bottom: 1px solid var(--border-light);
  transition: background var(--transition);
}
.sbl-card:last-child { border-bottom: none; }
.sbl-card:hover { background: var(--surface-alt); }
.sbl-num { font-weight: 700; color: var(--navy); font-size: var(--text-md); }
.sbl-badge {
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
  font-size: var(--text-xs); font-weight: 600; margin-left: 6px; vertical-align: middle;
}
.sbl-badge-type { background: var(--navy-light); color: var(--navy); }
.sbl-badge-status { background: #DBEAFE; color: #1E40AF; }
.sbl-badge-status.sbl-status-working { background: #FEF3C7; color: #92400E; }
.sbl-badge-status.sbl-status-in-progress { background: #FEF3C7; color: #92400E; }
.sbl-badge-status.sbl-status-open { background: #DBEAFE; color: #1E40AF; }
.sbl-badge-status.sbl-status-resolved { background: #D1FAE5; color: #065F46; }
.sbl-badge-status.sbl-status-closed { background: #F3F4F6; color: #4B5563; }
.sbl-badge-severity { background: #FEE2E2; color: #991B1B; }
.sbl-field { color: var(--text-secondary); margin-top: 2px; line-height: 1.45; word-break: break-word; font-size: var(--text-sm); }
.sbl-field b { color: var(--text); font-weight: 600; }
.sbl-meta { color: var(--text-muted); font-size: var(--text-xs); margin-top: 3px; }
.sbl-parent { color: var(--text-muted); font-size: var(--text-xs); margin-top: 2px; }
.sbl-parent a { color: var(--navy); text-decoration: none; }
.sbl-parent a:hover { text-decoration: underline; }
.sbl-note-preview { color: var(--text-muted); font-size: var(--text-xs); margin-top: 3px; font-style: italic; max-height: 36px; overflow: hidden; cursor: pointer; transition: max-height 0.2s; }
.sbl-note-preview.expanded { max-height: 500px; font-style: normal; color: var(--text-secondary); }
.sbl-actions { margin-top: 6px; }
.sbl-add-note-link { color: var(--primary); cursor: pointer; font-size: var(--text-sm); font-weight: 500; transition: color var(--transition); }
.sbl-add-note-link:hover { color: var(--primary-hover); text-decoration: underline; }
.sbl-loading { display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--text-muted); gap: 8px; }
.sbl-loading::before { content: ""; display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--navy); border-radius: 50%; animation: spin 0.6s linear infinite; }
.sbl-empty { color: var(--text-muted); text-align: center; padding: 24px; font-size: var(--text-sm); }
.btn-siebel-load { margin-top: 4px; }
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/panel.html
git commit -m "feat: add CSS for Siebel backlog cards"
```

---

### Task 5: Add backlog HTML section to Siebel tab

**Files:**
- Modify: `chrome-extension/panel.html:540` (after `#siebel-result` div, before closing `</div>` of panel)

- [ ] **Step 1: Add backlog section HTML**

In the Siebel panel (`#panel-siebel-note`), after the `#siebel-result` div (line 540), add:

```html
  <div class="sbl-section-title">My Siebel Backlog</div>
  <div class="btn-row">
    <button class="btn btn-primary btn-siebel-load" id="btn-siebel-backlog">Load Backlog</button>
  </div>
  <div id="siebel-backlog-results"></div>
```

The final `#panel-siebel-note` should look like:

```html
<div id="panel-siebel-note" class="panel">
  <div class="section-badge badge-siebel">Siebel CRM</div>
  <div class="form-group">
    <label>SR Number or Activity ID</label>
    <input id="siebel-sr" placeholder="e.g. 1-23642931672 or 1-AUKUM2Z">
  </div>
  <div class="info-box">
    Enter an <b>SR Number</b> to open the SR and create a new Activity. Enter an <b>Activity ID</b> (e.g. 1-AUKUM2Z) to jump directly to that Activity.
  </div>
  <div class="btn-row">
    <button class="btn btn-primary" id="btn-siebel-create">Add a Note in Siebel</button>
  </div>
  <div id="siebel-result" class="result-box"></div>
  <div class="sbl-section-title">My Siebel Backlog</div>
  <div class="btn-row">
    <button class="btn btn-primary btn-siebel-load" id="btn-siebel-backlog">Load Backlog</button>
  </div>
  <div id="siebel-backlog-results"></div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/panel.html
git commit -m "feat: add backlog section HTML to Siebel tab"
```

---

### Task 6: Add backlog fetch and card rendering in panel.js

**Files:**
- Modify: `chrome-extension/panel.js:1318` (after the existing Siebel section)

- [ ] **Step 1: Add "Load Backlog" click handler**

Append after the existing Siebel note handler (after line 1318, the closing `});` of the `btn-siebel-create` listener):

```javascript
// --- Siebel Backlog ---
const sblResults = document.getElementById("siebel-backlog-results");
let sblUserName = null;

document.getElementById("btn-siebel-backlog").addEventListener("click", async () => {
  const btn = document.getElementById("btn-siebel-backlog");
  btn.disabled = true;
  btn.textContent = "Loading...";
  sblResults.innerHTML = '<div class="sbl-loading">Fetching backlog from OCD...</div>';

  try {
    // Detect username if not yet known
    if (!sblUserName) {
      try {
        const userResp = await send({ action: "detectSnowUser" });
        sblUserName = userResp.userName;
      } catch (e) {
        sblResults.innerHTML = '<div class="error">' + esc(e.message) + '</div>';
        return;
      }
    }

    // Fetch backlog
    const resp = await send({ action: "fetchOcdBacklog" });
    if (!resp.items || resp.items.length === 0) {
      sblResults.innerHTML = '<div class="sbl-empty">No SR/SRA items in your backlog</div>';
      return;
    }

    // Sort by updated_time descending (most recent first)
    resp.items.sort((a, b) => (parseInt(b.updated_time) || 0) - (parseInt(a.updated_time) || 0));

    let html = '<div class="result-box">';
    html += '<div class="ticket-field" style="margin-bottom:8px;color:var(--text-muted)">' + esc(resp.items.length) + ' items for ' + esc(sblUserName) + '</div>';
    for (const item of resp.items) {
      html += renderSblCard(item);
    }
    html += '</div>';
    sblResults.innerHTML = html;
  } catch (e) {
    sblResults.innerHTML = '<div class="error">' + esc(e.message) + ' <span class="toggle-link" id="sbl-retry">Retry</span></div>';
  } finally {
    btn.disabled = false;
    btn.textContent = "Load Backlog";
  }
});

function renderSblCard(item) {
  const statusClass = "sbl-status-" + (item.activity_status_name || "").toLowerCase().replace(/\s+/g, "-");
  const updatedSec = parseInt(item.updated_time) || 0;
  const updatedAgo = updatedSec ? timeAgo(updatedSec * 1000) : "";
  const desc = esc(item.activity_description || "");
  const truncatedDesc = desc.length > 120 ? desc.substring(0, 120) + "..." : desc;
  const noteText = esc(item.last_status_note || "");
  const truncatedNote = noteText.length > 80 ? noteText.substring(0, 80) + "..." : noteText;

  let html = '<div class="sbl-card">';
  html += '<div><span class="sbl-num">' + esc(item.activity_number) + '</span>';
  html += ' <span class="sbl-badge sbl-badge-type">' + esc(item._type) + '</span>';
  html += ' <span class="sbl-badge sbl-badge-status ' + statusClass + '">' + esc(item.activity_status_name) + '</span>';
  html += ' <span class="sbl-badge sbl-badge-severity">' + esc(item.activity_severity_name) + '</span>';
  html += '</div>';
  html += '<div class="sbl-field">' + truncatedDesc + '</div>';
  html += '<div class="sbl-field"><b>Customer:</b> ' + esc(item.customer_name) + '</div>';
  html += '<div class="sbl-field"><b>Skill:</b> ' + esc(item.skill_name) + '</div>';
  html += '<div class="sbl-meta">Hours: ' + esc(item.hours) + ' | Age: ' + esc(item.age) + ' | Updated: ' + updatedAgo + '</div>';
  if (noteText) {
    html += '<div class="sbl-note-preview" title="Click to expand">' + truncatedNote + '</div>';
  }
  if (item._type === "SRA" && item.parent_activity_number) {
    html += '<div class="sbl-parent">Parent SR: <a href="https://ocd.avaya.com/" target="_blank">' + esc(item.parent_activity_number) + '</a></div>';
  }
  html += '<div class="sbl-actions"><span class="sbl-add-note-link" data-sbl-id="' + esc(item.activity_number) + '">+ Add Note</span></div>';
  html += '</div>';
  return html;
}

function timeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  return days + "d ago";
}
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: add Siebel backlog fetch and card rendering"
```

---

### Task 7: Add delegated click handlers for Siebel backlog cards

**Files:**
- Modify: `chrome-extension/panel.js` (in the existing delegated click handler or as a new one)

- [ ] **Step 1: Add delegated click handlers for backlog actions**

Append after the `renderSblCard` and `timeAgo` functions added in Task 6:

```javascript
// Delegated click handlers for Siebel backlog cards
document.addEventListener("click", async (e) => {
  // Add Note on backlog card
  const addNoteLink = e.target.closest(".sbl-add-note-link");
  if (addNoteLink) {
    const activityId = addNoteLink.dataset.sblId;
    const card = addNoteLink.closest(".sbl-card");
    const actionsDiv = card.querySelector(".sbl-actions");
    addNoteLink.style.display = "none";
    actionsDiv.innerHTML += '<span class="sbl-note-status" style="color:var(--navy);font-size:var(--text-sm)">Opening in Siebel...</span>';

    try {
      const data = await send({ action: "siebelCreateActivity", srNumber: activityId });
      if (data.success) {
        actionsDiv.querySelector(".sbl-note-status").textContent = "Opened in Siebel";
        actionsDiv.querySelector(".sbl-note-status").style.color = "var(--success)";
      } else {
        actionsDiv.querySelector(".sbl-note-status").textContent = data.error || "Failed";
        actionsDiv.querySelector(".sbl-note-status").style.color = "var(--danger)";
      }
    } catch (err) {
      actionsDiv.querySelector(".sbl-note-status").textContent = err.message;
      actionsDiv.querySelector(".sbl-note-status").style.color = "var(--danger)";
    }
    // Show link again after 3s
    setTimeout(() => {
      addNoteLink.style.display = "";
      const status = actionsDiv.querySelector(".sbl-note-status");
      if (status) status.remove();
    }, 3000);
    return;
  }

  // Expand/collapse last note preview
  const notePreview = e.target.closest(".sbl-note-preview");
  if (notePreview) {
    notePreview.classList.toggle("expanded");
    return;
  }

  // Retry button
  const retryBtn = e.target.closest("#sbl-retry");
  if (retryBtn) {
    document.getElementById("btn-siebel-backlog").click();
    return;
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: add delegated click handlers for Siebel backlog cards"
```

---

### Task 8: Manual test

**Files:** None (testing only)

- [ ] **Step 1: Reload extension in Chrome**

1. Open `chrome://extensions`
2. Click refresh on "SNOW + Siebel Ticket Manager"
3. Open ServiceNow tab (ensure logged in)
4. Open sidebar

- [ ] **Step 2: Test username detection**

1. Click the Siebel tab
2. Click "Load Backlog"
3. Verify: username auto-detected, backlog items appear as cards
4. Verify: SR and SRA items both shown with correct type badges

- [ ] **Step 3: Test card actions**

1. Verify: status badges have correct colors
2. Verify: last note preview expands/collapses on click
3. Verify: SRA cards show parent SR link
4. Verify: "Add Note" triggers GCT automation for that activity

- [ ] **Step 4: Test error cases**

1. Close ServiceNow tab, reload extension, click "Load Backlog" — should show "Please open a ServiceNow tab first"
2. Click retry link — should re-attempt

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "v2.6: Siebel backlog list with OCD API integration"
```
