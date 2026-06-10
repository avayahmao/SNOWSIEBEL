# Action Tab Effort Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add effort time logging to the Action tab, matching the Work Note tab's existing pattern.

**Architecture:** Mirror the Work Note tab's effort UI (value + unit selector) in the Action panel. Parse effort in the Update handler, pass to background, and extend the background's time-worked logic to also handle `updateTicket` actions.

**Tech Stack:** Chrome Extension (Manifest V3), vanilla JS, ServiceNow REST API

**Note:** No automated tests exist in this project. Verification is manual via the extension UI.

---

### Task 1: Add Effort UI to Action Panel

**Files:**
- Modify: `chrome-extension/panel.html:216-219` (between Notes textarea and Update button)

- [ ] **Step 1: Add the effort row HTML**

Insert the following HTML between the Notes textarea's `</div>` (line 219) and the `<div class="btn-row">` (line 220):

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

- [ ] **Step 2: Verify in browser**

Load extension, open sidebar, click Action tab. Confirm Effort Time row appears between Notes and Update button.

---

### Task 2: Parse Effort in Action Update Handler

**Files:**
- Modify: `chrome-extension/panel.js:356-401` (btn-update click handler)

- [ ] **Step 1: Add effort parsing logic**

In the `btn-update` click handler, after reading `resolutionNote` (line 385) and before building `fields`, add effort parsing. The full updated handler:

```js
document.getElementById("btn-update").addEventListener("click", async () => {
  const number = document.getElementById("action-number").value.trim();
  if (!number) return;
  const state = document.getElementById("action-state").value;
  if (!state) {
    showError(actionResult, "Select a state");
    return;
  }
  // Validate state transition
  if (currentTicketState) {
    var allowed = ALLOWED_TRANSITIONS[currentTicketState] || [];
    if (allowed.length > 0 && allowed.indexOf(state) < 0) {
      var fromLabel = STATE_LABELS[currentTicketState] || currentTicketState;
      var toLabel = STATE_LABELS[state] || state;
      showError(actionResult, "Cannot change from " + fromLabel + " to " + toLabel);
      return;
    }
  }
  const fields = { state };
  const statusReason = document.getElementById("action-status-reason").value;
  if (statusReason && statusReason !== "-- None --") fields.u_status_reason = statusReason;
  if (state === "-5") {
    const followup = document.getElementById("action-followup").value;
    if (!followup) {
      showError(actionResult, "Follow-up date is required for Pending state");
      return;
    }
    fields.follow_up = followup;
  }
  const resolutionNote = document.getElementById("action-resolution").value.trim();
  if (resolutionNote) {
    fields.work_notes = resolutionNote;
    fields.u_private_note = resolutionNote;
    if (state === "6") fields.u_resolution_notes = resolutionNote;
  }
  // Parse effort time (only when there's a note)
  let effortMinutes = null;
  const effortRaw = document.getElementById("action-effort").value.trim();
  const effortUnit = document.getElementById("action-effort-unit").value;
  if (resolutionNote && effortRaw) {
    const val = parseFloat(effortRaw);
    if (!isNaN(val) && val > 0) {
      effortMinutes = effortUnit === "hours" ? Math.round(val * 60) : val;
    }
  }
  showLoading(actionResult);
  try {
    const data = await send({ action: "updateTicket", ticketNumber: number, fields, effortMinutes });
    let msg = '<div class="success">State updated' + (resolutionNote ? ' with note' : '') + '</div>';
    if (effortMinutes && data && data.timeResult) {
      if (data.timeResult.error) {
        msg += '<div style="color:#e65100;font-size:11px;margin-top:4px">Time worked error: ' + esc(data.timeResult.error) + '</div>';
      } else {
        var hrs = Math.floor(effortMinutes / 60);
        var mins = effortMinutes % 60;
        var timeStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + ' minutes';
        msg += '<div style="font-size:11px;margin-top:4px;color:#2e7d32">Effort: ' + esc(timeStr) + ' recorded</div>';
      }
    }
    actionResult.innerHTML = msg;
    // Refresh state after update
    refreshActionState(number);
    document.getElementById("action-resolution").value = "";
    document.getElementById("action-effort").value = "";
  } catch (e) {
    showError(actionResult, e.message);
  }
});
```

Key changes from the original:
- Lines after `resolutionNote` block: parse `action-effort` and `action-effort-unit`, compute `effortMinutes` only if `resolutionNote` is truthy
- `send()` call now includes `effortMinutes`
- Success handler shows effort feedback (same pattern as Work Note tab) and clears `action-effort`
- `send()` response is now captured in `data` (was discarded before)

- [ ] **Step 2: Verify in browser**

Load extension, open Action tab, enter a ticket, select a state, type a note, enter effort. Confirm no console errors.

---

### Task 3: Extend Background to Handle Effort for updateTicket

**Files:**
- Modify: `chrome-extension/background.js:209` (effort condition in handleMessage)

- [ ] **Step 1: Update the condition**

Change line 209 from:

```js
    if (msg.action === "addComment" && msg.effortMinutes) {
```

to:

```js
    if ((msg.action === "addComment" || msg.action === "updateTicket") && msg.effortMinutes) {
```

Also update the return statement at line 222. Currently it returns different shapes for `addComment` vs others:

```js
    return msg.action === "addComment" ? { result, timeResult } : result;
```

Change to also return time info for `updateTicket`:

```js
    return (msg.action === "addComment" || msg.action === "updateTicket") ? { result, timeResult } : result;
```

- [ ] **Step 2: End-to-end verification**

1. Load extension in Chrome
2. Open a ServiceNow tab (logged in)
3. Open sidebar, go to Action tab
4. Enter a real ticket number, select a state transition, type a note, enter effort time (e.g. 15 minutes)
5. Click Update
6. Confirm success message shows both "State updated with note" and "Effort: 15 minutes recorded"
7. Verify on the ticket in ServiceNow that the state changed, work note was added, and time worked was recorded

- [ ] **Step 3: Verify edge case — no note, no effort**

1. Go to Action tab
2. Enter ticket, select state, leave Notes empty, put a value in Effort Time
3. Click Update
4. Confirm state updates but NO effort is recorded (effort is ignored without a note)

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/panel.html chrome-extension/panel.js chrome-extension/background.js
git commit -m "feat: add effort time input to Action tab

Mirrors Work Note tab's effort UI. Effort is only recorded when a note
is provided alongside the state change. Reuses existing task_time_worked
and parent aggregate logic in background.js."
```
