importScripts("note-fields.js");

const INSTANCE_URL = "https://avaya.service-now.com";

// Open sidebar when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

const TABLE_MAP = {
  INC: "incident", CHG: "change_request", TAS: "task",
  RIT: "sc_req_item", REQ: "sc_request", PRB: "problem",
  KB0: "kb_knowledge", STY: "rm_story", SCT: "sc_task",
};

function detectTable(ticketNumber) {
  const prefix = ticketNumber.slice(0, 3).toUpperCase();
  return TABLE_MAP[prefix] || "incident";
}

async function findSnowTab() {
  const tabs = await chrome.tabs.query({ url: "*://avaya.service-now.com/*" });
  if (tabs.length === 0) throw new Error("Please open a ServiceNow tab and log in first");
  return tabs[0];
}

async function findGctTab() {
  const tabs = await chrome.tabs.query({ url: "*://gct.avaya.com/*" });
  if (tabs.length === 0) {
    // Open a new GCT tab
    const tab = await chrome.tabs.create({ url: "https://gct.avaya.com/callcenter_enu/", active: false });
    throw new Error("GCT tab opened. Please log in to GCT, then retry.");
  }
  return tabs[0];
}

// Inject and execute in the page's MAIN world so we can access g_ck and session cookies
async function injectAndExec(tabId, fn, args) {
  // Step 1: inject snowFetch helper into the MAIN world
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["content-snow.js"],
  });
  // Step 2: execute the function in the MAIN world
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fn,
    args,
  });
  return results?.[0]?.result;
}

let gctInjected = false;

async function injectAndExecGct(tabId, fn, args) {
  // Only inject content-gct.js once per workflow
  if (!gctInjected) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["content-gct.js"],
    });
    gctInjected = true;
  }
  // Execute the step function
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fn,
    args,
  });
  return results?.[0]?.result;
}

// Helper: Wait for Siebel to be fully initialized after page load
// Uses polling since fixed delays are unreliable — Siebel views load asynchronously
async function pollSiebelReady(tabId, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  var start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      var results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: "MAIN",
        func: function () {
          try {
            var app = theApplication();
            if (app && app.ActiveViewName()) return app.ActiveViewName();
          } catch (e) {}
          return null;
        }
      });
      if (results && results[0] && results[0].result) return results[0].result;
    } catch (e) {
      // Script injection may fail if page context isn't ready yet
    }
    await new Promise(function (r) { setTimeout(r, 1000); });
  }
  throw new Error("Siebel not ready after " + (timeoutMs / 1000) + "s");
}

// Helper: Navigate GCT tab to a Siebel view and wait for page load
function navigateGctTab(tabId, viewName, rowIds) {
  return new Promise(function (resolve, reject) {
    var timeout = setTimeout(function () {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Navigation timeout after 30s"));
    }, 30000);

    function listener(tid, info) {
      if (tid === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Reset injection flag on navigation since page context is destroyed
        gctInjected = false;
        // Poll for Siebel readiness instead of fixed delay
        pollSiebelReady(tabId).then(resolve, reject);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Extract _tid from current tab URL first
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Tab not found"));
        return;
      }

      var url = new URL(tab.url);
      var tid = url.searchParams.get("_tid") || "";
      var base = "https://gct.avaya.com/siebel/app/callcenter/enu/";
      var params = new URLSearchParams();
      params.set("SWECmd", "GotoView");
      params.set("SWEView", viewName);
      params.set("SWERF", "1");
      params.set("SWEHo", "");
      params.set("SWEBU", "1");
      if (tid) params.set("_tid", tid);
      if (rowIds) {
        for (var i = 0; i < rowIds.length; i++) {
          params.set("SWEApplet" + i, rowIds[i].applet);
          params.set("SWERowId" + i, rowIds[i].rowId);
        }
      }
      var newUrl = base + "?" + params.toString();
      chrome.tabs.update(tabId, { url: newUrl }, function () {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error("Failed to navigate: " + chrome.runtime.lastError.message));
        }
      });
    });
  });
}

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

// --- Functions that run inside the ServiceNow page (can call snowFetch) ---

function getTicketInPage(table, ticketNumber) {
  return snowFetch("GET", "/api/now/table/" + table + "?sysparm_query=number=" + ticketNumber + "&sysparm_limit=1&sysparm_display_value=all")
    .then(function(d) { return d.result && d.result[0] ? d.result[0] : null; });
}

function listTicketsInPage(table, query, limit, fields) {
  var params = new URLSearchParams({ sysparm_query: query, sysparm_limit: String(limit), sysparm_display_value: "all" });
  params.set("sysparm_fields", fields || "number,short_description,state,priority,assigned_to,sys_updated_on,contact_type");
  return snowFetch("GET", "/api/now/table/" + table + "?" + params)
    .then(function(d) { return d.result || []; });
}

function updateBySysIdInPage(table, sysId, fields) {
  return snowFetch("PATCH", "/api/now/table/" + table + "/" + sysId, fields)
    .then(function(d) { return { _result: d.result }; })
    .catch(function(e) { return { _error: e.message }; });
}

function addTimeWorkedInPage(table, sysId, minutes, userId, comment) {
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  var dur = "1970-01-01 " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":00";
  var body = { task: sysId, time_worked: dur };
  if (userId) body.user = userId;
  if (comment) body.comments = comment;
  return snowFetch("POST", "/api/now/table/task_time_worked", body).then(function(d) { return d.result; });
}

function getUserIdInPage() {
  // Try client-side globals first (synchronous)
  try { if (typeof g_user !== "undefined" && g_user && g_user.userID) return g_user.userID; } catch (e) {}
  try { if (typeof g_user_id !== "undefined" && g_user_id) return g_user_id; } catch (e) {}
  // Fallback: query sys_user via API using server-side gs.getUserName()
  return snowFetch("GET", "/api/now/table/sys_user?sysparm_query=user_name=javascript:gs.getUserName()&sysparm_limit=1&sysparm_fields=sys_id")
    .then(function(d) { return d.result && d.result[0] ? d.result[0].sys_id : ""; })
    .catch(function() { return ""; });
}

// Directly update the incident/task's aggregate time_worked field
function addTimeToParentInPage(table, sysId, minutesToAdd) {
  return snowFetch("GET", "/api/now/table/" + table + "/" + sysId + "?sysparm_fields=time_worked")
    .then(function(d) {
      var current = d.result ? d.result.time_worked : null;
      var totalSeconds = 0;
      if (current) {
        var val = String(typeof current === "object" ? current.value : current);
        // "1970-01-01 HH:MM:SS" format
        var dateMatch = val.match(/\d+-\d+-\d+\s+(\d+):(\d+):(\d+)/);
        if (dateMatch) {
          totalSeconds = parseInt(dateMatch[1]) * 3600 + parseInt(dateMatch[2]) * 60 + parseInt(dateMatch[3]);
        } else {
          // "D HH:MM:SS" format
          var match = val.match(/(\d+)\s+(\d+):(\d+):(\d+)/);
          if (match) {
            totalSeconds = parseInt(match[1]) * 86400 + parseInt(match[2]) * 3600 + parseInt(match[3]) * 60 + parseInt(match[4]);
          } else {
            // "HH:MM:SS" format
            match = val.match(/(\d+):(\d+):(\d+)/);
            if (match) totalSeconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
          }
        }
      }
      totalSeconds += minutesToAdd * 60;
      var dd = Math.floor(totalSeconds / 86400);
      var rem = totalSeconds % 86400;
      var hh = Math.floor(rem / 3600);
      rem = rem % 3600;
      var mm = Math.floor(rem / 60);
      var ss = rem % 60;
      var dur = dd + " " + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
      return snowFetch("PUT", "/api/now/table/" + table + "/" + sysId, { time_worked: dur });
    })
    .then(function(d) { return d.result ? d.result.time_worked : null; });
}

function getJournalInPage(sysId, tableName) {
  var params = new URLSearchParams({
    sysparm_query: "element_id=" + sysId + "^name=" + tableName + "^ORDERBYDESCsys_created_on",
    sysparm_limit: "20",
    sysparm_display_value: "all"
  });
  return snowFetch("GET", "/api/now/table/sys_journal_field?" + params)
    .then(function(d) { return d.result || []; });
}

function debugFieldsInPage() {
  return snowFetch("GET", "/api/now/table/sys_journal_field?sysparm_query=name=incident^ORDERBYDESCsys_created_on&sysparm_limit=20&sysparm_display_value=all&sysparm_fields=element,value,sys_created_on,element_id")
    .then(function(j) {
      var entries = j.result || [];
      if (entries.length === 0) return [{ element: "no_entries", column_label: "No journal entries found for incidents", internal_type: "debug" }];
      var output = [];
      var seen = {};
      for (var i = 0; i < entries.length; i++) {
        var el = entries[i].element;
        var key = el + "_" + (typeof el === "object" ? el.value : el);
        if (!seen[key]) {
          seen[key] = true;
          output.push({
            element: typeof el === "object" ? el.value : el,
            column_label: (typeof entries[i].value === "object" ? entries[i].value.display_value : (entries[i].value || "")).substring(0, 80),
            internal_type: typeof entries[i].sys_created_on === "object" ? entries[i].sys_created_on.display_value : (entries[i].sys_created_on || "")
          });
        }
      }
      return output;
    })
    .catch(function(e) { return [{ element: "error", column_label: e.message, internal_type: "debug" }]; });
}

// --- Message handler ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then((r) => sendResponse({ ok: true, data: r }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

async function handleMessage(msg) {
  // GCT actions use a separate tab and don't need SNOW
  if (msg.action === "siebelCreateActivity") {
    const steps = [];
    gctInjected = false; // Reset injection flag for new workflow
    const gctTab = await findGctTab();

    // Step 1: Navigate to All Service Request List View
    try {
      await navigateGctTab(gctTab.id, "All Service Request List View", null);
      steps.push({ ok: true, label: "Navigating to Service → All Service Requests" });
    } catch (e) {
      steps.push({ ok: false, label: "Navigating to Service → All Service Requests — " + e.message });
      throw new Error("Step failed: Navigation — " + e.message);
    }

    // Step 2: Query SR (returns rowId for drill-in navigation)
    var queryResult;
    try {
      queryResult = await injectAndExecGct(gctTab.id, gctQuerySR, [msg.srNumber]);
      steps.push({ ok: true, label: "Querying SR " + msg.srNumber });
    } catch (e) {
      steps.push({ ok: false, label: "Querying SR " + msg.srNumber + " — " + e.message });
      throw new Error("Step failed: Query — " + e.message);
    }

    // Step 3: Drill into SR detail using Siebel's internal GotoView
    // (AJAX-based navigation — no page reload, no state token issues)
    try {
      await injectAndExecGct(gctTab.id, gctDrillIntoSR, []);
      steps.push({ ok: true, label: "Opening SR detail" });
    } catch (e) {
      steps.push({ ok: false, label: "Opening SR detail — " + e.message });
      throw new Error("Step failed: Drill-in — " + e.message);
    }

    // Step 4: Verify Activities tab loaded
    try {
      await injectAndExecGct(gctTab.id, gctNavigateActivities, []);
      steps.push({ ok: true, label: "Opening Activities tab" });
    } catch (e) {
      steps.push({ ok: false, label: "Opening Activities tab — " + e.message });
      throw new Error("Step failed: Activities — " + e.message);
    }

    // Step 5: Create new activity
    try {
      await injectAndExecGct(gctTab.id, gctCreateNewActivity, []);
      steps.push({ ok: true, label: "Creating new activity" });
    } catch (e) {
      steps.push({ ok: false, label: "Creating new activity — " + e.message });
      throw new Error("Step failed: New Activity — " + e.message);
    }

    // Step 6: Fill activity form
    try {
      await injectAndExecGct(gctTab.id, gctFillActivityForm, [{ type: msg.activityType, comments: msg.comments, status: msg.status }]);
      steps.push({ ok: true, label: "Filling activity form" });
    } catch (e) {
      steps.push({ ok: false, label: "Filling activity form — " + e.message });
      throw new Error("Step failed: Fill Form — " + e.message);
    }

    // Step 7: Log time
    try {
      await injectAndExecGct(gctTab.id, gctLogTime, [msg.time]);
      steps.push({ ok: true, label: "Logging " + msg.time + " minutes" });
    } catch (e) {
      steps.push({ ok: false, label: "Logging " + msg.time + " minutes — " + e.message });
      throw new Error("Step failed: Log Time — " + e.message);
    }

    // Step 8: Save
    try {
      await injectAndExecGct(gctTab.id, gctSave, []);
      steps.push({ ok: true, label: "Saving activity" });
    } catch (e) {
      steps.push({ ok: false, label: "Saving activity — " + e.message });
      throw new Error("Step failed: Save — " + e.message);
    }

    return { success: true, steps };
  }

  // All other actions require a ServiceNow tab
  const tab = await findSnowTab();
  const table = detectTable(msg.ticketNumber || "");

  if (msg.action === "getTicket") {
    const ticket = await injectAndExec(tab.id, getTicketInPage, [table, msg.ticketNumber]);
    if (ticket && msg.includeJournal) {
      const sysId = typeof ticket.sys_id === "object" ? ticket.sys_id.value : ticket.sys_id;
      const journal = await injectAndExec(tab.id, getJournalInPage, [sysId, table]);
      ticket._journal = journal;
    }
    return ticket;
  }

  if (msg.action === "listTickets") {
    return injectAndExec(tab.id, listTicketsInPage, [msg.table, msg.query, msg.limit, msg.fields || null]);
  }

  if (msg.action === "debugFields") {
    return injectAndExec(tab.id, debugFieldsInPage, []);
  }

  if (msg.action === "alarmClose") {
    const ticket = await injectAndExec(tab.id, getTicketInPage, [table, msg.ticketNumber]);
    if (!ticket) throw new Error("Ticket " + msg.ticketNumber + " not found");
    const sysId = typeof ticket.sys_id === "object" ? ticket.sys_id.value : ticket.sys_id;
    const rawState = typeof ticket.state === "object" ? ticket.state.value : ticket.state;
    const currentState = String(rawState);

    // Per-table alarm close chains (only incident supports this)
    const ALARM_CHAINS = {
      incident: {
        "1": ["2", "4", "6", "7"],
        "2": ["4", "6", "7"],
        "-5": ["4", "6", "7"],
        "5": ["4", "6", "7"],
        "4": ["6", "7"],
        "6": ["7"]
      }
    };
    const STATE_LABELS = {
      incident: { "2": "In Progress", "4": "Service Restored", "6": "Resolved", "7": "Closed" },
    };

    const chains = ALARM_CHAINS[table];
    if (!chains) throw new Error("Alarm close is not supported for table " + table);
    const labels = STATE_LABELS[table] || {};

    if (currentState === "7") throw new Error("Ticket is already closed");
    if (currentState === "8") throw new Error("Cannot close a cancelled ticket");

    const chain = chains[currentState];
    if (!chain) throw new Error("Cannot auto-close from state " + currentState);

    const steps = [];
    for (let i = 0; i < chain.length; i++) {
      const targetState = chain[i];
      const stepLabel = labels[targetState] || targetState;
      const fields = { state: targetState };
      if (targetState === "6" || targetState === "7") {
        fields.u_status_reason = "Alarm(s) Cleared on Access";
      }
      if (targetState === "7") {
        fields.work_notes = msg.note;
        fields.u_private_note = msg.note;
        fields.u_resolution_notes = msg.note;
      }
      const updateResult = await injectAndExec(tab.id, updateBySysIdInPage, [table, sysId, fields]);
      if (updateResult && updateResult._error) {
        const lastOk = steps.length > 0 ? " Ticket is now in " + steps[steps.length - 1].label + "." : "";
        throw new Error("Step " + (i + 1) + "/" + chain.length + " (" + stepLabel + ") failed: " + updateResult._error + lastOk);
      }
      steps.push({ state: targetState, label: stepLabel });
    }
    // Log effort time if specified
    let timeResult = null;
    if (msg.effortMinutes) {
      try {
        const userId = await injectAndExec(tab.id, getUserIdInPage, []);
        timeResult = await injectAndExec(tab.id, addTimeWorkedInPage, [table, sysId, msg.effortMinutes, userId, msg.note]);
      } catch (e) {
        timeResult = { error: e.message };
      }
      try {
        await injectAndExec(tab.id, addTimeToParentInPage, [table, sysId, msg.effortMinutes]);
      } catch (e) { /* best effort */ }
    }
    return { success: true, steps, totalSteps: chain.length, timeResult };
  }

  if (msg.action === "updateTicket" || msg.action === "addComment" || msg.action === "resolveTicket") {
    const ticket = await injectAndExec(tab.id, getTicketInPage, [table, msg.ticketNumber]);
    if (!ticket) throw new Error("Ticket " + msg.ticketNumber + " not found");

    let fields = msg.fields || {};
    if (msg.action === "addComment") {
      // Public updates are comments; internal updates are work notes.
      fields = buildCommentFields(msg);
    } else if (msg.action === "resolveTicket") {
      // Per-table resolve state codes
      const RESOLVE_STATES = {
        incident: "6", change_request: "3", problem: "105",
        sc_req_item: "3", sc_request: "4", task: "3", sc_task: "3",
      };
      fields = { state: RESOLVE_STATES[table] || "6" };
      if (msg.resolutionNote) fields.u_resolution_notes = msg.resolutionNote;
      if (msg.statusReason) fields.u_status_reason = msg.statusReason;
    }
    const sysId = typeof ticket.sys_id === "object" ? ticket.sys_id.value : ticket.sys_id;

    const updateResult = await injectAndExec(tab.id, updateBySysIdInPage, [table, sysId, fields]);
    if (updateResult && updateResult._error) throw new Error(updateResult._error);
    const result = updateResult ? updateResult._result : null;

    // Add time worked if effort specified
    let timeResult = null;
    if ((msg.action === "addComment" || msg.action === "updateTicket") && msg.effortMinutes) {
      try {
        const userId = await injectAndExec(tab.id, getUserIdInPage, []);
        const timeComment = msg.action === "addComment" ? msg.comment : (msg.fields.work_notes || "");
        timeResult = await injectAndExec(tab.id, addTimeWorkedInPage, [table, sysId, msg.effortMinutes, userId, timeComment]);
      } catch (e) {
        timeResult = { error: e.message };
      }
      // Update parent's aggregate time_worked
      try {
        await injectAndExec(tab.id, addTimeToParentInPage, [table, sysId, msg.effortMinutes]);
      } catch (e) { /* best effort */ }
    }

    return (msg.action === "addComment" || msg.action === "updateTicket") ? { result, timeResult } : result;
  }
}
