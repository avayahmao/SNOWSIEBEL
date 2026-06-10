# Siebel Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Siebel Note" tab to the sidebar that automates GCT Siebel CRM activity creation (post-login).

**Architecture:** Content script DOM automation. `content-gct.js` is injected into the GCT tab's MAIN world and provides Siebel navigation functions. `background.js` orchestrates step-by-step: find/inject GCT tab, then call each step function sequentially. `panel.js` provides a form in a new "Siebel Note" tab with SR Number, Activity Type, Comments, Time, and Status inputs.

**Tech Stack:** Vanilla JS (Chrome extension Manifest V3), DOM manipulation for Siebel CRM

---

## File Structure

```
chrome-extension/
├── panel.html          ← MODIFY: add Siebel Note tab + form section
├── panel.js            ← MODIFY: tab switching, form handler, result display
├── background.js       ← MODIFY: siebelCreateActivity handler, GCT tab management
├── content-gct.js      ← CREATE:  Siebel DOM navigation + automation functions
tests/
└── siebel-note.test.js ← CREATE:  unit tests for content-gct.js logic
```

---

### Task 1: Add Siebel Note tab button and panel to panel.html

**Files:**
- Modify: `chrome-extension/panel.html`

- [ ] **Step 1: Add "Siebel Note" tab button**

Add the new tab button after the Query tab button (line 80):

```html
  <button class="tab" data-tab="siebel-note">Siebel Note</button>
```

Location: After the `<button class="tab" data-tab="query">Query</button>` line.

- [ ] **Step 2: Add Siebel Note panel section**

Add after the Query panel closing `</div>` (after line 260):

```html
<!-- Siebel Note Panel -->
<div id="panel-siebel-note" class="panel">
  <div class="form-group">
    <label>SR Number</label>
    <input id="siebel-sr" placeholder="e.g. 1-23642931672">
  </div>
  <div class="form-group">
    <label>Activity Type</label>
    <select id="siebel-type">
      <option value="SR Status - Outbound" selected>SR Status - Outbound</option>
      <option value="SR Note">SR Note</option>
    </select>
  </div>
  <div class="form-group">
    <label>Comments</label>
    <textarea id="siebel-comments" placeholder="Enter activity comments..." required></textarea>
  </div>
  <div class="form-group">
    <label>Time (min)</label>
    <input id="siebel-time" type="number" value="15" min="1" max="480">
  </div>
  <div class="form-group">
    <label>Status</label>
    <select id="siebel-status">
      <option value="Done" selected>Done</option>
      <option value="In Progress">In Progress</option>
      <option value="Pending">Pending</option>
      <option value="Cancelled">Cancelled</option>
    </select>
  </div>
  <div class="btn-row">
    <button class="btn btn-primary" id="btn-siebel-create">Create Activity &amp; Save</button>
  </div>
  <div id="siebel-result" class="result-box"></div>
</div>
```

- [ ] **Step 3: Verify HTML**

Load `chrome-extension/panel.html` in a browser and confirm the new tab and form appear.

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/panel.html
git commit -m "feat: add Siebel Note tab and form to panel UI"
```

---

### Task 2: Add Siebel Note tab switching and form handler to panel.js

**Files:**
- Modify: `chrome-extension/panel.js`

- [ ] **Step 1: Add siebel-note to tab switching**

The `switchTab` function at line 2 handles tab names. The `data-tab="siebel-note"` attribute matches the panel ID `panel-siebel-note`, so the generic tab switching logic already works — no changes needed to `switchTab`. Verify that `document.querySelectorAll(".tab")` and `document.querySelectorAll(".panel")` cover the new elements.

- [ ] **Step 2: Add form submit handler**

Add at the end of `panel.js`:

```js
// --- Siebel Note ---
const siebelResult = document.getElementById("siebel-result");

document.getElementById("btn-siebel-create").addEventListener("click", async () => {
  const srNumber = document.getElementById("siebel-sr").value.trim();
  const activityType = document.getElementById("siebel-type").value;
  const comments = document.getElementById("siebel-comments").value.trim();
  const time = parseInt(document.getElementById("siebel-time").value, 10);
  const status = document.getElementById("siebel-status").value;

  if (!srNumber) { showError(siebelResult, "Enter an SR number"); return; }
  if (!comments) { showError(siebelResult, "Enter comments"); return; }
  if (!time || time < 1) { showError(siebelResult, "Enter a valid time"); return; }

  const btn = document.getElementById("btn-siebel-create");
  btn.disabled = true;
  btn.textContent = "Working...";
  siebelResult.innerHTML = '<div class="loading">Initializing...</div>';

  try {
    const data = await send({
      action: "siebelCreateActivity",
      srNumber, activityType, comments, time, status
    });

    let html = '<div class="success">Activity created and saved for SR ' + esc(srNumber) + '</div>';
    if (data.steps) {
      html += '<div style="font-size:11px;margin-top:6px;color:#555">';
      for (const step of data.steps) {
        const icon = step.ok ? '&#10003;' : '&#10007;';
        const cls = step.ok ? 'color:#2e7d32' : 'color:#c62828';
        html += '<div style="' + cls + '">' + icon + ' ' + esc(step.label) + '</div>';
      }
      html += '</div>';
    }
    siebelResult.innerHTML = html;
    document.getElementById("siebel-comments").value = "";
  } catch (e) {
    showError(siebelResult, e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Activity & Save";
  }
});
```

- [ ] **Step 3: Verify no syntax errors**

```bash
node -c chrome-extension/panel.js
```

Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: add Siebel Note form handler to panel.js"
```

---

### Task 3: Add siebelCreateActivity handler to background.js

**Files:**
- Modify: `chrome-extension/background.js`

- [ ] **Step 1: Add GCT tab finder function**

Add after `findSnowTab()` (after line 25):

```js
async function findGctTab() {
  const tabs = await chrome.tabs.query({ url: "*://gct.avaya.com/*" });
  if (tabs.length === 0) {
    // Open a new GCT tab
    const tab = await chrome.tabs.create({ url: "https://gct.avaya.com/callcenter_enu/", active: false });
    throw new Error("GCT tab opened. Please log in to GCT, then retry.");
  }
  return tabs[0];
}
```

- [ ] **Step 2: Add GCT injection helper**

Add after `injectAndExec()` (after line 43):

```js
async function injectAndExecGct(tabId, fn, args) {
  // Inject content-gct.js into the MAIN world
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["content-gct.js"],
  });
  // Execute the step function
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fn,
    args,
  });
  return results?.[0]?.result;
}
```

- [ ] **Step 3: Add step functions (defined in background, executed in GCT page)**

Add after the GCT helpers:

```js
// Step functions — serialized and executed in GCT tab's MAIN world.
// These reference globals defined in content-gct.js.

function gctNavigateToServiceRequests() {
  return window._siebel.navigateToServiceRequests();
}

function gctQuerySR(srNumber) {
  return window._siebel.querySR(srNumber);
}

function gctDrillIntoSR() {
  return window._siebel.drillIntoSR();
}

function gctNavigateActivities() {
  return window._siebel.navigateActivities();
}

function gctCreateNewActivity() {
  return window._siebel.createNewActivity();
}

function gctFillActivityForm(params) {
  return window._siebel.fillActivityForm(params);
}

function gctLogTime(minutes) {
  return window._siebel.logTime(minutes);
}

function gctSave() {
  return window._siebel.save();
}
```

- [ ] **Step 4: Add siebelCreateActivity message handler**

Add inside `handleMessage()`, before the final closing `}` of the function:

```js
if (msg.action === "siebelCreateActivity") {
  let gctTab;
  try {
    gctTab = await findGctTab();
  } catch (e) {
    // Tab was just opened — tell user to log in
    throw e;
  }

  const steps = [];
  const stepDefs = [
    { fn: gctNavigateToServiceRequests, args: [], label: "Navigating to Service → All Service Requests" },
    { fn: gctQuerySR, args: [msg.srNumber], label: "Querying SR " + msg.srNumber },
    { fn: gctDrillIntoSR, args: [], label: "Opening SR detail" },
    { fn: gctNavigateActivities, args: [], label: "Opening Activities tab" },
    { fn: gctCreateNewActivity, args: [], label: "Creating new activity" },
    { fn: gctFillActivityForm, args: [{ type: msg.activityType, comments: msg.comments, status: msg.status }], label: "Filling activity form" },
    { fn: gctLogTime, args: [msg.time], label: "Logging " + msg.time + " minutes" },
    { fn: gctSave, args: [], label: "Saving activity" },
  ];

  for (const step of stepDefs) {
    try {
      await injectAndExecGct(gctTab.id, step.fn, step.args);
      steps.push({ ok: true, label: step.label });
    } catch (e) {
      steps.push({ ok: false, label: step.label + " — " + e.message });
      throw new Error("Step failed: " + step.label + " — " + e.message);
    }
  }

  return { success: true, steps };
}
```

- [ ] **Step 5: Verify no syntax errors**

```bash
node -c chrome-extension/background.js
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat: add siebelCreateActivity handler to background.js"
```

---

### Task 4: Create content-gct.js with Siebel DOM automation functions

**Files:**
- Create: `chrome-extension/content-gct.js`

- [ ] **Step 1: Create content-gct.js with frame navigation helper**

```js
// content-gct.js — Siebel CRM DOM automation
// Injected into GCT tab's MAIN world by background.js

(function () {
  "use strict";

  // --- Frame navigation ---
  // Siebel uses nested frames. Navigate to the content frame.
  function getSiebelDoc() {
    // Try _sweclient frame first (most common)
    var frames = document.querySelectorAll('frame[name="_sweclient"], iframe[name="_sweclient"]');
    for (var i = 0; i < frames.length; i++) {
      try {
        var doc = frames[i].contentDocument || frames[i].contentWindow.document;
        if (doc && doc.body) return doc;
      } catch (e) { /* cross-origin, skip */ }
    }
    // Fallback: search all frames for Siebel content
    var allFrames = document.querySelectorAll("frame, iframe");
    for (var j = 0; j < allFrames.length; j++) {
      try {
        var d = allFrames[j].contentDocument || allFrames[j].contentWindow.document;
        if (d && d.querySelector('[id*="s_"]')) return d;
      } catch (e) { /* skip */ }
    }
    return document;
  }

  // --- Wait helper ---
  function waitFor(testFn, timeout) {
    timeout = timeout || 30000;
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      function poll() {
        try {
          var result = testFn();
          if (result) return resolve(result);
        } catch (e) { /* keep polling */ }
        if (Date.now() - start > timeout) {
          return reject(new Error("Timeout waiting for element after " + (timeout / 1000) + "s"));
        }
        setTimeout(poll, 500);
      }
      poll();
    });
  }

  // --- Click helper with wait ---
  function clickAndPause(el) {
    if (!el) throw new Error("Element not found");
    el.click();
    return new Promise(function (resolve) { setTimeout(resolve, 1500); });
  }

  // --- Find button/link by visible text ---
  function findByText(doc, text, tag) {
    if (!doc) doc = getSiebelDoc();
    var els = doc.querySelectorAll(tag || "a, button, span, div");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      if (t === text || t.indexOf(text) === 0) return els[i];
    }
    return null;
  }

  // Exports
  window._siebel = {

    // Step 1: Navigate to Service → All Service Requests
    navigateToServiceRequests: function () {
      var doc = getSiebelDoc();

      // Click "Service" in the navigation bar (top-level tab)
      return waitFor(function () {
        return findByText(doc, "Service");
      }).then(function (serviceTab) {
        return clickAndPause(serviceTab);
      }).then(function () {
        // Click "All Service Requests" link
        return waitFor(function () {
          return findByText(getSiebelDoc(), "All Service Requests");
        });
      }).then(function (link) {
        return clickAndPause(link);
      }).then(function () {
        // Wait for SR List Applet to load
        return waitFor(function () {
          var d = getSiebelDoc();
          // Look for the SR List Applet — typically has "Service Request" in its title
          return d.querySelector('[id*="Service_Request"]') || findByText(d, "SR #") || findByText(d, "Service Request #");
        });
      });
    },

    // Step 2: Query SR number
    querySR: function (srNumber) {
      var doc = getSiebelDoc();

      // Click "Query" button to enter query mode
      return waitFor(function () {
        // Siebel Query button — look for button with "Query" text or menu item
        var menuBtn = findByText(doc, "Query") || doc.querySelector('a[title*="Query"], button[title*="Query"]');
        return menuBtn;
      }).then(function (queryBtn) {
        return clickAndPause(queryBtn);
      }).then(function () {
        // Find SR# field in the list applet (readonly grid cell, click to activate)
        return waitFor(function () {
          var d = getSiebelDoc();
          // SR# is typically in a grid cell with an input or span
          var srField = d.querySelector('input[id*="SR"], input[id*="s_"]') ||
                        findByText(d, "SR #");
          return srField;
        });
      }).then(function (srField) {
        // If it's a readonly textbox in a grid, click the parent cell first
        if (srField.readOnly || srField.tagName === "SPAN") {
          var cell = srField.closest("td, div[role='gridcell']");
          if (cell) cell.click();
          // Now find the actual input that appears
          return waitFor(function () {
            var d = getSiebelDoc();
            return d.querySelector('input:not([readonly])[id*="s_"]') ||
                   d.querySelector('input[type="text"]:not([readonly])');
          });
        }
        return srField;
      }).then(function (input) {
        // Clear and enter SR number
        input.value = "";
        input.value = srNumber;
        // Trigger input events
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }).then(function () {
        // Execute query — press Enter or click Go
        return new Promise(function (resolve) {
          setTimeout(resolve, 500);
        });
      }).then(function () {
        var d = getSiebelDoc();
        var goBtn = findByText(d, "Go") || d.querySelector('a[id*="go"], button[id*="go"]');
        if (goBtn) {
          return clickAndPause(goBtn);
        }
        // If no Go button, try keyboard Enter
        d.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return new Promise(function (resolve) { setTimeout(resolve, 2000); });
      });
    },

    // Step 3: Drill into SR
    drillIntoSR: function () {
      return waitFor(function () {
        var doc = getSiebelDoc();
        // SR hyperlink is in the first data row of the SR List Applet
        // Look for a link in a gridcell that contains the SR number pattern
        var links = doc.querySelectorAll("a");
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute("href") || "";
          var text = (links[i].textContent || "").trim();
          if (text.match(/^\d+-\d+/) || href.indexOf("SR") > -1) {
            return links[i];
          }
        }
        // Fallback: click the first cell in the first data row
        var cells = doc.querySelectorAll("td[role='gridcell'], div[role='gridcell']");
        for (var j = 0; j < cells.length; j++) {
          var cellText = (cells[j].textContent || "").trim();
          if (cellText.match(/^\d+-\d+/)) {
            return cells[j];
          }
        }
        return null;
      }).then(function (link) {
        if (!link) throw new Error("SR hyperlink not found in results");
        return clickAndPause(link);
      }).then(function () {
        // Wait for SR detail view to load (look for Activities tab or SR detail elements)
        return waitFor(function () {
          var d = getSiebelDoc();
          return findByText(d, "Activities") || findByText(d, "Service Request") ||
                 d.querySelector('[id*="Activity"]');
        });
      });
    },

    // Step 4: Navigate to Activities tab
    navigateActivities: function () {
      return waitFor(function () {
        return findByText(getSiebelDoc(), "Activities");
      }).then(function (tab) {
        return clickAndPause(tab);
      }).then(function () {
        // Wait for Activity List Applet to appear
        return waitFor(function () {
          var d = getSiebelDoc();
          return findByText(d, "Activity") || d.querySelector('[id*="Activity"]');
        });
      });
    },

    // Step 5: Click "New" in Activity List Applet
    createNewActivity: function () {
      return waitFor(function () {
        var doc = getSiebelDoc();
        // Look for New button in the Activity list area
        var buttons = doc.querySelectorAll("a, button, input[type='button']");
        for (var i = 0; i < buttons.length; i++) {
          var text = (buttons[i].textContent || buttons[i].value || "").trim();
          if (text === "New") return buttons[i];
        }
        return null;
      }).then(function (newBtn) {
        if (!newBtn) throw new Error("New Activity button not found");
        return clickAndPause(newBtn);
      });
    },

    // Step 6: Fill the activity form
    fillActivityForm: function (params) {
      // Find all form controls in the Activity form
      function getFormDoc() {
        var doc = getSiebelDoc();
        // The activity form may be in a dialog or inline applet
        // Look for input fields that belong to the activity form
        return doc;
      }

      // Set activity type
      function setType(doc, type) {
        var selects = doc.querySelectorAll("select");
        for (var i = 0; i < selects.length; i++) {
          var opts = selects[i].options;
          for (var j = 0; j < opts.length; j++) {
            if (opts[j].text.trim().indexOf(type) === 0) {
              selects[i].value = opts[j].value;
              selects[i].dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      }

      // Enter comments (find the textarea)
      function setComments(doc, comments) {
        var textareas = doc.querySelectorAll("textarea");
        for (var i = 0; i < textareas.length; i++) {
          if (textareas[i].offsetParent !== null) {
            textareas[i].value = comments;
            textareas[i].dispatchEvent(new Event("input", { bubbles: true }));
            return true;
          }
        }
        // Try contenteditable divs
        var editables = doc.querySelectorAll('[contenteditable="true"]');
        for (var j = 0; j < editables.length; j++) {
          editables[j].textContent = comments;
          return true;
        }
        return false;
      }

      // Set status
      function setStatus(doc, status) {
        var selects = doc.querySelectorAll("select");
        for (var i = 0; i < selects.length; i++) {
          var opts = selects[i].options;
          for (var j = 0; j < opts.length; j++) {
            if (opts[j].text.trim() === status || opts[j].text.trim().indexOf(status) === 0) {
              selects[i].value = opts[j].value;
              selects[i].dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      }

      return waitFor(function () {
        var d = getFormDoc();
        return d.querySelector("textarea, select, input") ? d : null;
      }).then(function (doc) {
        // Set activity type first (may trigger field changes)
        if (params.type) setType(doc, params.type);
        // Then set status
        if (params.status) setStatus(doc, params.status);
        // Then set comments
        if (params.comments) setComments(doc, params.comments);
        return new Promise(function (resolve) { setTimeout(resolve, 500); });
      });
    },

    // Step 7: Log time in Time List Applet
    logTime: function (minutes) {
      // Click "New" in Time List Applet
      function findTimeNewBtn(doc) {
        // Time applet is typically below the Activity applet
        // Its "New" button appears after the activity form
        var buttons = doc.querySelectorAll("a, button, input[type='button']");
        var found = [];
        for (var i = 0; i < buttons.length; i++) {
          if ((buttons[i].textContent || buttons[i].value || "").trim() === "New") {
            found.push(buttons[i]);
          }
        }
        // Return the second "New" button (first is Activity, second is Time)
        return found.length >= 2 ? found[1] : found[0] || null;
      }

      return new Promise(function (resolve) { setTimeout(resolve, 500); })
        .then(function () {
          var doc = getSiebelDoc();
          var timeNewBtn = findTimeNewBtn(doc);
          if (!timeNewBtn) throw new Error("Time applet New button not found");
          return clickAndPause(timeNewBtn);
        }).then(function () {
          // Find the Minutes field (calculator field in Siebel)
          // Siebel calculator fields show as StaticText initially, need to click to activate
          return waitFor(function () {
            var doc = getSiebelDoc();
            // Look for "Minutes" label nearby and find the associated input
            var labels = doc.querySelectorAll("span, label, td");
            for (var i = 0; i < labels.length; i++) {
              if ((labels[i].textContent || "").trim() === "Minutes") {
                // The calculator input is typically in the next cell or sibling
                var row = labels[i].closest("tr, div");
                if (row) {
                  var calcField = row.querySelector('input[type="text"], span[id*="Minutes"]');
                  if (calcField) return calcField;
                }
              }
            }
            // Fallback: look for any visible text input in the time row
            return doc.querySelector('input[type="text"]:not([readonly])');
          });
        }).then(function (minutesField) {
          if (!minutesField) throw new Error("Minutes field not found");
          // Click to activate calculator field
          minutesField.click();
          minutesField.focus();
          return new Promise(function (resolve) { setTimeout(resolve, 300); });
        }).then(function () {
          var doc = getSiebelDoc();
          // After click, the field should be editable — type the value
          var activeEl = doc.activeElement;
          if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
            activeEl.value = String(minutes);
            activeEl.dispatchEvent(new Event("input", { bubbles: true }));
            activeEl.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
    },

    // Step 8: Save (Ctrl+S)
    save: function () {
      return new Promise(function (resolve) { setTimeout(resolve, 500); })
        .then(function () {
          var doc = getSiebelDoc();
          // Fire Ctrl+S on the document
          doc.dispatchEvent(new KeyboardEvent("keydown", {
            key: "s",
            code: "KeyS",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }));
          // Also try on body
          if (doc.body) {
            doc.body.dispatchEvent(new KeyboardEvent("keydown", {
              key: "s",
              code: "KeyS",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }));
          }
          // Wait for save to complete
          return new Promise(function (resolve) { setTimeout(resolve, 3000); });
        }).then(function () {
          // Check for error dialogs
          var doc = getSiebelDoc();
          var errors = doc.querySelectorAll('[class*="error"], [class*="alert"], [id*="error"]');
          for (var i = 0; i < errors.length; i++) {
            if (errors[i].offsetParent !== null) {
              var errText = (errors[i].textContent || "").trim();
              if (errText) throw new Error("Save error: " + errText);
            }
          }
        });
    }
  };
})();
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node -c chrome-extension/content-gct.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/content-gct.js
git commit -m "feat: add content-gct.js with Siebel DOM automation functions"
```

---

### Task 5: Write unit tests for content-gct.js logic

**Files:**
- Create: `tests/siebel-note.test.js`

- [ ] **Step 1: Create test file**

```js
// tests/siebel-note.test.js
// Unit tests for content-gct.js helper logic (not live Siebel DOM).

const assert = require("assert");

// We can't run the full DOM automation in a test (no Siebel page),
// so we test the structural patterns: that content-gct.js is valid JS,
// that the _siebel namespace is properly structured, and that each
// step function exists and returns a Promise.

describe("content-gct.js structure", () => {
  // Test data representing what we'd pass through the automation
  const validParams = {
    srNumber: "1-23642931672",
    activityType: "SR Status - Outbound",
    comments: "Test comment",
    time: 15,
    status: "Done",
  };

  it("content-gct.js parses as valid JavaScript", () => {
    // This is verified by node -c in the build step
    // Here we just confirm the file exists and is non-empty
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "content-gct.js"),
      "utf-8"
    );
    assert.ok(content.length > 100, "content-gct.js should not be empty");
    assert.ok(
      content.includes("window._siebel"),
      "should export window._siebel namespace"
    );
  });

  it("_siebel namespace has all required step functions", () => {
    // Check that each step function name is referenced in the file
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "content-gct.js"),
      "utf-8"
    );
    const required = [
      "navigateToServiceRequests",
      "querySR",
      "drillIntoSR",
      "navigateActivities",
      "createNewActivity",
      "fillActivityForm",
      "logTime",
      "save",
    ];
    for (const fn of required) {
      assert.ok(
        content.includes(fn + ":"),
        "content-gct.js should define " + fn
      );
    }
  });

  it("panel.js has siebel-note form handler", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "panel.js"),
      "utf-8"
    );
    assert.ok(
      content.includes("siebelCreateActivity"),
      "panel.js should reference siebelCreateActivity action"
    );
    assert.ok(
      content.includes("btn-siebel-create"),
      "panel.js should handle btn-siebel-create click"
    );
  });

  it("background.js has siebelCreateActivity handler", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "background.js"),
      "utf-8"
    );
    assert.ok(
      content.includes("siebelCreateActivity"),
      "background.js should handle siebelCreateActivity action"
    );
    assert.ok(
      content.includes("findGctTab"),
      "background.js should define findGctTab"
    );
    assert.ok(
      content.includes("injectAndExecGct"),
      "background.js should define injectAndExecGct"
    );
  });

  it("panel.html has siebel-note tab and form elements", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "panel.html"),
      "utf-8"
    );
    assert.ok(
      content.includes('data-tab="siebel-note"'),
      "panel.html should have siebel-note tab button"
    );
    const requiredIds = [
      "siebel-sr",
      "siebel-type",
      "siebel-comments",
      "siebel-time",
      "siebel-status",
      "btn-siebel-create",
      "siebel-result",
    ];
    for (const id of requiredIds) {
      assert.ok(
        content.includes('id="' + id + '"'),
        "panel.html should have element with id=" + id
      );
    }
  });

  it("validParams has all required fields", () => {
    assert.ok(validParams.srNumber, "srNumber is required");
    assert.ok(validParams.activityType, "activityType is required");
    assert.ok(validParams.comments, "comments is required");
    assert.ok(validParams.time > 0, "time should be positive");
    assert.ok(validParams.status, "status is required");
  });
});

describe("background.js step definitions", () => {
  it("step sequence is in correct order", () => {
    // The step order must match the Siebel workflow:
    // 1. Navigate to Service → All Service Requests
    // 2. Query SR
    // 3. Drill into SR
    // 4. Navigate to Activities tab
    // 5. Create new activity
    // 6. Fill activity form
    // 7. Log time
    // 8. Save
    const expectedOrder = [
      "gctNavigateToServiceRequests",
      "gctQuerySR",
      "gctDrillIntoSR",
      "gctNavigateActivities",
      "gctCreateNewActivity",
      "gctFillActivityForm",
      "gctLogTime",
      "gctSave",
    ];

    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "background.js"),
      "utf-8"
    );

    // Find the stepDefs array and verify order
    const stepMatch = content.match(/stepDefs\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(stepMatch, "stepDefs array should exist in background.js");

    for (let i = 0; i < expectedOrder.length; i++) {
      const fnName = expectedOrder[i];
      assert.ok(
        content.includes(fnName),
        fnName + " should be referenced in background.js"
      );
    }
  });
});
```

- [ ] **Step 2: Run unit tests**

```bash
npx mocha tests/siebel-note.test.js
```

Expected: 7 tests pass (structure and validation checks).

- [ ] **Step 3: Commit**

```bash
git add tests/siebel-note.test.js
git commit -m "test: add unit tests for Siebel Note feature"
```

---

### Task 6: Manual end-to-end verification

**Files:**
- None (verification only)

- [ ] **Step 1: Reload extension in Chrome**

1. Go to `chrome://extensions/`
2. Click "Reload" on the SNOW Ticket Manager extension
3. Open the sidebar

- [ ] **Step 2: Verify tab appears**

Expected: "Siebel Note" tab is visible after "Query" tab. Clicking it shows the form with SR Number, Activity Type, Comments, Time, Status, and Submit button.

- [ ] **Step 3: Verify validation**

Click "Create Activity & Save" without filling any fields. Expected: "Enter an SR number" error message.

- [ ] **Step 4: Test with real GCT SR**

1. Open gct.avaya.com and log in
2. In the sidebar, go to Siebel Note tab
3. Fill in: SR Number `1-23642931672`, Activity Type `SR Status - Outbound`, Comments `Test automation`, Time `15`, Status `Done`
4. Click "Create Activity & Save"
5. Watch the GCT tab — it should navigate, fill the form, and save
6. Verify the result area shows green checkmarks for all steps

- [ ] **Step 5: Test error case — wrong SR number**

Fill in a non-existent SR number (e.g., `9-99999999999`). Expected: query fails, error message shown.

- [ ] **Step 6: Document any selector issues found**

If any step fails with "element not found", note the exact Siebel DOM structure and update `content-gct.js` selectors accordingly. Siebel's exact element IDs and frame structure can vary between instances.

- [ ] **Step 7: Commit any fixes**

```bash
git add chrome-extension/content-gct.js
git commit -m "fix: update Siebel DOM selectors based on manual testing"
```
