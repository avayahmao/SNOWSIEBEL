// --- Tab switching ---
function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add("active");
  document.getElementById(`panel-${tabName}`).classList.add("active");
  // Auto-load "My Open Tickets" when List tab is first shown
  if (tabName === "list" && !listAutoLoaded) {
    listAutoLoaded = true;
    document.getElementById("list-preset").value = "my-open";
    document.getElementById("list-query").value = PRESETS["my-open"];
    document.getElementById("btn-list").click();
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    switchTab(tab.dataset.tab);
  });
});

// --- Helpers ---
function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp) {
        reject(new Error("No response from background"));
        return;
      }
      if (resp.ok) resolve(resp.data);
      else reject(new Error(resp.error));
    });
  });
}

// --- Per-table state configuration ---
// Each key is a ServiceNow table name; entries define state labels, CSS classes,
// selectable states, allowed transitions, status reasons, alarm chains, etc.
const TABLE_STATES = {
  incident: {
    labels: { "-5": "Pending", "1": "New", "2": "In Progress", "3": "Awaiting Problem", "4": "Service Restored", "5": "Assigned", "6": "Resolved", "7": "Closed", "8": "Cancelled" },
    classes: { "-5": "state-active", "1": "state-new", "2": "state-active", "3": "state-active", "4": "state-resolved", "5": "state-active", "6": "state-resolved", "7": "state-closed", "8": "state-closed" },
    selectableStates: ["2", "-5", "4", "5", "6", "7", "8"],
    transitions: {
      "1": ["2", "5"],
      "2": ["-5", "4", "6", "8"],
      "-5": ["2", "4", "6", "8"],
      "4": ["2", "-5", "6", "8"],
      "5": ["2", "-5", "4", "6", "8"],
    },
    reasons: {
      "2": ["-- None --", "Escalation to Product House", "Dispatch", "Escalated to Vendor/Partner"],
      "-5": ["Additional Information from Client", "Approval from Client to Proceed", "Awaiting Change Request", "Client Action Required", "Client Hold", "Manager Intervention", "Remote Access to Equipment", "Success Confirmation from Client", "Support Contact Hold", "Third Party Vendor Action Required"],
      "4": ["-- None --"],
      "6": ["-- None --", "Customer or Third Party Action", "Repaired", "Replaced", "Patch / Upgrade", "Alarm(s) Cleared on Access", "Change Request"],
      "7": ["-- None --", "Repaired", "Replaced", "Patch / Upgrade", "Customer or Third Party Action", "Alarm(s) Cleared on Access", "Change Request"],
      "8": ["-- None --", "Customer/Location Inactive", "Duplicate Incident", "Ignore Alarm", "Test Alarm", "Customer Cancelled", "Created Change Request Instead", "Ticket Created in Error", "No Longer Required"],
    },
    alarmChains: {
      "1": ["2", "4", "6", "7"],
      "2": ["4", "6", "7"],
      "-5": ["4", "6", "7"],
      "5": ["4", "6", "7"],
      "4": ["6", "7"],
      "6": ["7"],
    },
    supportsAlarmClose: true,
    resolveState: "6",
    pendingState: "-5",
    hasFollowUp: true,
  },
  change_request: {
    labels: { "-5": "New", "-4": "Assess", "-3": "Authorize", "-2": "Scheduled", "-1": "Implement", "0": "Review", "3": "Closed", "4": "Canceled" },
    classes: { "-5": "state-new", "-4": "state-active", "-3": "state-active", "-2": "state-active", "-1": "state-active", "0": "state-resolved", "3": "state-closed", "4": "state-closed" },
    selectableStates: ["-4", "-3", "-2", "-1", "0", "3", "4"],
    transitions: {
      "-5": ["-4", "-2", "4"],
      "-4": ["-3", "-2", "4"],
      "-3": ["-2", "4"],
      "-2": ["-1", "4"],
      "-1": ["0", "4"],
      "0": ["3"],
    },
    reasons: {},
    supportsAlarmClose: false,
    resolveState: "3",
    pendingState: null,
    hasFollowUp: false,
  },
  problem: {
    labels: { "101": "New", "102": "Assess", "103": "Root Cause Analysis", "104": "Fix in Progress", "105": "Resolved", "106": "Closed" },
    classes: { "101": "state-new", "102": "state-active", "103": "state-active", "104": "state-active", "105": "state-resolved", "106": "state-closed" },
    selectableStates: ["102", "103", "104", "105", "106"],
    transitions: {
      "101": ["102"],
      "102": ["103", "106"],
      "103": ["104", "105", "106"],
      "104": ["105", "106"],
      "105": ["106"],
    },
    reasons: {},
    supportsAlarmClose: false,
    resolveState: "105",
    pendingState: null,
    hasFollowUp: false,
  },
  sc_req_item: {
    labels: { "1": "Open", "2": "Work in Progress", "3": "Closed Complete", "4": "Closed Incomplete", "5": "Closed Skipped" },
    classes: { "1": "state-new", "2": "state-active", "3": "state-closed", "4": "state-closed", "5": "state-closed" },
    selectableStates: ["2", "3", "4", "5"],
    transitions: {
      "1": ["2", "3", "4", "5"],
      "2": ["3", "4", "5"],
    },
    reasons: {},
    supportsAlarmClose: false,
    resolveState: "3",
    pendingState: null,
    hasFollowUp: false,
  },
  sc_request: {
    labels: { "-5": "Pending", "4": "Closed Complete", "5": "Closed Incomplete", "6": "Closed Rejected" },
    classes: { "-5": "state-active", "4": "state-closed", "5": "state-closed", "6": "state-closed" },
    selectableStates: ["4", "5", "6"],
    transitions: {
      "-5": ["4", "5", "6"],
    },
    reasons: {},
    supportsAlarmClose: false,
    resolveState: "4",
    pendingState: "-5",
    hasFollowUp: false,
  },
  task: {
    labels: { "-5": "Pending", "1": "Open", "2": "Work in Progress", "3": "Closed Complete", "4": "Closed Incomplete", "7": "Closed Skipped" },
    classes: { "-5": "state-active", "1": "state-new", "2": "state-active", "3": "state-closed", "4": "state-closed", "7": "state-closed" },
    selectableStates: ["2", "3", "4", "7"],
    transitions: {
      "-5": ["1", "3", "4", "7"],
      "1": ["2", "3", "4", "7"],
      "2": ["3", "4", "7"],
    },
    reasons: {},
    supportsAlarmClose: false,
    resolveState: "3",
    pendingState: "-5",
    hasFollowUp: false,
  },
  sc_task: {
    labels: { "-5": "Pending", "1": "Open", "2": "Work in Progress", "3": "Closed Complete", "4": "Closed Incomplete", "7": "Closed Skipped" },
    classes: { "-5": "state-active", "1": "state-new", "2": "state-active", "3": "state-closed", "4": "state-closed", "7": "state-closed" },
    selectableStates: ["2", "3", "4", "7"],
    transitions: {
      "-5": ["1", "3", "4", "7"],
      "1": ["2", "3", "4", "7"],
      "2": ["3", "4", "7"],
    },
    reasons: {},
    supportsAlarmClose: false,
    resolveState: "3",
    pendingState: "-5",
    hasFollowUp: false,
  },
};

function getStateConfig(table) {
  return TABLE_STATES[table] || TABLE_STATES.incident;
}

// Work note types — loaded dynamically from SNOW sys_choice, with hardcoded fallback
var NOTE_TYPES = ["", "Customer Feedback", "Detail Clarification", "Internal Only", "Cancellation Information", "Escalation 1", "Status Update", "Next Steps", "ADM 1: Problem Statement", "ADM 2: Details/Findings", "ADM 3: Problem Clarification", "ADM 4: Cause", "ADM 5: Solution", "ADM 6: Knowledge Management", "Manager Comments", "Management Escalation Request", "Management Escalation Response", "Management Escalation Update", "Management Escalation Closure", "General Information", "Customer Comments"];
var NOTE_TYPE_VALUES = null; // [{label, value}] from SNOW

function loadNoteTypes() {
  send({ action: "getNoteTypes" }).then(function(types) {
    if (types && types.length > 0) {
      NOTE_TYPE_VALUES = types;
      NOTE_TYPES = [""].concat(types.map(function(t) { return t.label || t.value; }));
      // Update the Comment tab dropdown
      var sel = document.getElementById("comment-note-type");
      if (sel) {
      var cur = sel.value;
        sel.innerHTML = buildNoteTypeOptions(cur || "Internal Only");
      }
    }
  }).catch(function() { /* keep fallback */ });
}

function buildNoteTypeOptions(selectedValue) {
  var html = '<option value="">-- Select --</option>';
  if (NOTE_TYPE_VALUES) {
    for (var i = 0; i < NOTE_TYPE_VALUES.length; i++) {
      var t = NOTE_TYPE_VALUES[i];
      var val = t.value || t.label;
      var lbl = t.label || t.value;
      var isSelected = (val === selectedValue || lbl === selectedValue);
      html += '<option value="' + esc(val) + '"' + (isSelected ? ' selected' : '') + '>' + esc(lbl) + '</option>';
    }
  } else {
    for (var j = 1; j < NOTE_TYPES.length; j++) {
      html += '<option value="' + esc(NOTE_TYPES[j]) + '"' + (NOTE_TYPES[j] === selectedValue ? ' selected' : '') + '>' + esc(NOTE_TYPES[j]) + '</option>';
    }
  }
  return html;
}

var STATUS_REASON_VALUES = null; // [{label, value}] from SNOW sys_choice

// R1: fallback is the single verified value only — we don't invent close-reason
// strings SNOW might reject on write. Custom/other reasons come from the dynamic
// fetch once it loads (a <select> can't accept typed input).
function buildStatusReasonOptions(selectedValue) {
  var FALLBACK = ["Alarm(s) Cleared on Access"];
  var html = '';
  var src = STATUS_REASON_VALUES
    ? STATUS_REASON_VALUES.map(function(r) { return { val: r.value || r.label, lbl: r.label || r.value }; })
    : FALLBACK.map(function(v) { return { val: v, lbl: v }; });
  for (var i = 0; i < src.length; i++) {
    var o = src[i];
    var isSel = (o.val === selectedValue || o.lbl === selectedValue);
    html += '<option value="' + esc(o.val) + '"' + (isSel ? ' selected' : '') + '>' + esc(o.lbl) + '</option>';
  }
  return html;
}

function loadStatusReasons() {
  send({ action: "getStatusReasons" }).then(function(reasons) {
    if (reasons && reasons.length > 0) {
      STATUS_REASON_VALUES = reasons;
      // Repopulate every closure-code select (inline forms already open + Action tab).
      // R3: preserves sel.value; if the user picked a fallback-only value not in the
      // dynamic list, the select resets to the first option — benign (default is the
      // verified value, which exists in both lists).
      document.querySelectorAll(".alarm-reason-select, #alarm-reason").forEach(function(sel) {
        var cur = sel.value;
        sel.innerHTML = buildStatusReasonOptions(cur || "Alarm(s) Cleared on Access");
      });
    }
  }).catch(function() { /* keep fallback */ });
}

function stateBadge(state, table) {
  const cfg = getStateConfig(table || "incident");
  const dv = displayVal(state);
  const key = String(typeof state === "object" ? state.value : state) || "";
  const label = dv || cfg.labels[key] || key;
  const cls = cfg.classes[key] || "state-new";
  return `<span class="state-badge ${cls}">${esc(label)}</span>`;
}

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STALE_DAYS = 7;
const CRITICAL_STALE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseUpdatedOn(value) {
  const dv = displayVal(value);
  if (!dv) return null;
  const d = new Date(dv);
  return isNaN(d.getTime()) ? null : d;
}

// Auto-build per-table exclusion set from TABLE_STATES labels containing "Closed" or "Cancel"
const CLOSED_STATES = {};
for (const [table, cfg] of Object.entries(TABLE_STATES)) {
  CLOSED_STATES[table] = new Set(
    Object.entries(cfg.labels)
      .filter(([, label]) => /closed|cancel/i.test(label))
      .map(([code]) => code)
  );
}

function isClosedState(state, table) {
  const raw = typeof state === "object" ? String(state.value) : String(state);
  const closed = CLOSED_STATES[table] || CLOSED_STATES.incident;
  return closed.has(raw);
}

function isStale(updatedOn, state, table) {
  if (isClosedState(state, table)) return false;
  const d = parseUpdatedOn(updatedOn);
  if (!d) return false;
  const diffMs = Date.now() - d.getTime();
  return diffMs > STALE_DAYS * MS_PER_DAY;
}

function isCriticalStale(updatedOn, state, table) {
  if (isClosedState(state, table)) return false;
  const d = parseUpdatedOn(updatedOn);
  if (!d) return false;
  const diffMs = Date.now() - d.getTime();
  return diffMs > CRITICAL_STALE_DAYS * MS_PER_DAY;
}

function staleDays(updatedOn) {
  const d = parseUpdatedOn(updatedOn);
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / MS_PER_DAY);
}

// Extract numeric priority from SNOW priority field ("1 - Critical" → 1, "2 - High" → 2, etc.)
function parsePriority(value) {
  const dv = displayVal(value);
  const m = dv.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 99; // unknown priority sorts last
}

// valueVal: like displayVal but prefers .value. For state, display_value is a
// localized label ("New") and the numeric code lives in .value — displayVal()
// would parseInt("New")→NaN→0, so the state sort silently no-ops'd. (Caught by
// the compareTickets characterization test in tests/sort-verify.js.)
function valueVal(v) {
  if (v == null || v === "") return "";
  if (typeof v === "object") return v.value || v.display_value || "";
  return String(v);
}

// Compare two tickets for the List sort. `key` ∈ id/priority/stale/updated/created/state;
// `dir` ∈ asc/desc. All field access via displayVal/valueVal/parseUpdatedOn (the query
// uses sysparm_display_value=all, so fields arrive as {value, display_value} objects —
// raw Date.parse would NaN). Tiebreaks are fixed-direction per the design.
// Byte-identical (minus this preamble) to the reference copy in tests/sort-verify.js.
function compareTickets(a, b, key, dir) {
  const mult = dir === "desc" ? -1 : 1;
  if (key === "id") {
    const ma = (displayVal(a.number) || "").match(/(\d+)$/);
    const mb = (displayVal(b.number) || "").match(/(\d+)$/);
    const na = ma ? parseInt(ma[1], 10) : 0;
    const nb = mb ? parseInt(mb[1], 10) : 0;
    return (na - nb) * mult;
  }
  if (key === "priority") {
    const pa = parsePriority(a.priority), pb = parsePriority(b.priority);
    if (pa !== pb) return (pa - pb) * mult;
    return staleDays(b.sys_updated_on) - staleDays(a.sys_updated_on); // tiebreak: stale desc
  }
  if (key === "stale") {
    const sa = staleDays(a.sys_updated_on), sb = staleDays(b.sys_updated_on);
    if (sa !== sb) return (sa - sb) * mult;
    return parsePriority(a.priority) - parsePriority(b.priority); // tiebreak: priority asc
  }
  if (key === "updated") {
    const ta = parseUpdatedOn(a.sys_updated_on), tb = parseUpdatedOn(b.sys_updated_on);
    const va = ta ? ta.getTime() : 0, vb = tb ? tb.getTime() : 0;
    if (va !== vb) return (va - vb) * mult;
    return cmpIdDesc(a, b); // tiebreak: id desc
  }
  if (key === "created") {
    const ta = parseUpdatedOn(a.sys_created_on), tb = parseUpdatedOn(b.sys_created_on);
    const va = ta ? ta.getTime() : 0, vb = tb ? tb.getTime() : 0;
    if (va !== vb) return (va - vb) * mult;
    return cmpIdDesc(a, b); // tiebreak: id desc
  }
  if (key === "state") {
    const sa = parseInt(valueVal(a.state), 10) || 0;
    const sb = parseInt(valueVal(b.state), 10) || 0;
    if (sa !== sb) return (sa - sb) * mult;
    return parsePriority(a.priority) - parsePriority(b.priority); // tiebreak: priority asc
  }
  return 0;
}
// id-desc tiebreak helper (used by updated/created)
function cmpIdDesc(a, b) {
  const ma = (displayVal(a.number) || "").match(/(\d+)$/);
  const mb = (displayVal(b.number) || "").match(/(\d+)$/);
  const na = ma ? parseInt(ma[1], 10) : 0;
  const nb = mb ? parseInt(mb[1], 10) : 0;
  return nb - na;
}

// Siebel severity rank: OTG(0) > SBI(1) > BI(2) > NBI(3); unknown sorts last
const SBL_SEVERITY_RANK = { "OTG": 0, "SBI": 1, "BI": 2, "NBI": 3 };
function sblSeverityRank(name) {
  const key = (name || "").trim().toUpperCase();
  return SBL_SEVERITY_RANK[key] != null ? SBL_SEVERITY_RANK[key] : 99;
}

function staleBadge(updatedOn, state, table) {
  if (!isStale(updatedOn, state, table)) return "";
  const days = staleDays(updatedOn);
  const critical = isCriticalStale(updatedOn, state, table);
  const cls = critical ? "stale-badge stale-critical" : "stale-badge stale-warn";
  const icon = critical ? "⚠ " : "";
  return `<span class="${cls}">${icon}Stale (${days}d)</span>`;
}

function staleClass(updatedOn, state, table) {
  if (!isStale(updatedOn, state, table)) return "";
  return isCriticalStale(updatedOn, state, table) ? " stale-critical-ticket" : " stale-ticket";
}

function formatField(label, value) {
  const dv = displayVal(value);
  if (!dv) return "";
  return `<div class="ticket-field"><b>${esc(label)}:</b> ${esc(dv)}</div>`;
}

// Render CI fields only (no credentials) — used inline on list cards
function renderCiFields(ci) {
  var h = '';
  if (ci.ciName) h += '<div class="ticket-field"><b>CI Name:</b> ' + esc(ci.ciName) + '</div>';
  if (ci.seId) h += '<div class="ticket-field"><b>SE ID:</b> ' + esc(ci.seId) + '</div>';
  if (ci.ipAddress) h += '<div class="ticket-field"><b>IP:</b> ' + esc(ci.ipAddress) + '</div>';
  if (ci.natIp) h += '<div class="ticket-field"><b>NAT IP:</b> ' + esc(ci.natIp) + '</div>';
  if (ci.connectivity) h += '<div class="ticket-field"><b>Connectivity:</b> ' + esc(ci.connectivity) + '</div>';
  return h;
}

// Render device credentials list (used both inline and lazily)
function renderCredentialsBlock(prefix, credentials) {
  if (!credentials || credentials.length === 0) return '';
  var h = '';
  for (var i = 0; i < credentials.length; i++) {
    var cred = credentials[i];
    var credLabel = (cred.loginType || 'Login') + (cred.accessType ? ' (' + cred.accessType + ')' : '');
    h += '<div style="margin-top:4px;padding:3px 6px;background:var(--card-bg);border:1px solid var(--border);border-radius:4px">';
    h += '<div style="font-size:var(--text-sm);color:var(--text-muted);margin-bottom:2px">' + esc(credLabel) + '</div>';
    if (cred.username) h += '<div><b>User:</b> ' + esc(cred.username) + '</div>';
    if (cred.password) {
      var pwId = prefix + '-pw-' + i + '-' + Math.random().toString(36).slice(2, 6);
      h += '<div><b>Pass:</b> '
        + '<span id="' + pwId + '-mask" class="ci-pw-masked">••••••••</span>'
        + '<span id="' + pwId + '-text" style="display:none">' + esc(cred.password) + '</span>'
        + ' <a class="toggle-pw" data-pw-id="' + pwId + '" style="cursor:pointer;color:var(--primary);font-size:var(--text-sm)">show</a>'
        + '</div>';
    }
    h += '</div>';
  }
  return h;
}

// Render CI Remote Access block (reusable for query & action tabs)
function renderCiBlock(ci, prefix) {
  var h = renderCiFields(ci);
  if (ci.credentials && ci.credentials.length > 0) {
    var credSecId = prefix + '-cred-' + Math.random().toString(36).slice(2, 6);
    h += '<div class="ticket-field" style="margin-top:6px">';
    h += '<a class="toggle-cred" data-cred-id="' + credSecId + '" style="cursor:pointer;color:var(--primary);font-size:var(--text-sm)">&#9654; Device Password (' + ci.credentials.length + ')</a>';
    h += '<div id="' + credSecId + '" style="display:none;margin-top:4px">';
    h += renderCredentialsBlock(prefix, ci.credentials);
    h += '</div></div>';
  }
  return h;
}

// Build SNOW direct-open URL for a ticket number
function snowUrl(ticketNumber) {
  var table = detectTable(ticketNumber);
  return "https://avaya.service-now.com/nav_to.do?uri=" + encodeURIComponent(table + ".do?sysparm_query=number=" + ticketNumber);
}

function ticketLink(ticketNumber) {
  return '<a class="sn-link ticket-num" href="#" data-snow-number="' + esc(ticketNumber) + '" title="Open in ServiceNow">' + esc(ticketNumber) + '</a>';
}

function showLoading(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';
}

function userFacingError(msg) {
  if (msg.includes("Please open a ServiceNow tab") || msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
    return 'Not logged in to ServiceNow. Open the SNOW tab, log in, then retry.';
  }
  return esc(msg);
}

function showError(el, msg) {
  const loginHints = ["Please open a ServiceNow tab", "HTTP 401", "HTTP 403"];
  const isLoginIssue = loginHints.some(h => msg.includes(h));
  if (isLoginIssue) {
    el.innerHTML = '<div class="error">Not logged in to ServiceNow. <a href="https://avaya.service-now.com" target="_blank" style="color:var(--link-color)">Open ServiceNow</a>, log in, then retry.</div>';
  } else {
    el.innerHTML = `<div class="error">${esc(msg)}</div>`;
  }
}

function renderJournalInline(container, journal, maxShow) {
  if (!journal || journal.length === 0) {
    container.innerHTML = '<div class="ticket-field" style="color:var(--text-muted);padding:4px 0">No notes found</div>';
    return;
  }
  var ticket = (container.id || "").replace("notes-inline-", "");
  var visible = journal.slice(0, maxShow);
  var html = '';
  for (var i = 0; i < visible.length; i++) {
    var entry = visible[i];
    var isWorkNote = displayVal(entry.element) === "work_notes";
    var author = displayVal(entry.sys_created_by);
    var created = displayVal(entry.sys_created_on);
    var value = displayVal(entry.value) || "";
    var badge = isWorkNote
      ? '<span class="journal-badge journal-badge-worknote">Work Note</span>'
      : '<span class="journal-badge journal-badge-comment">Comment</span>';
    html += '<div class="journal-entry ' + (isWorkNote ? 'journal-entry-worknote' : 'journal-entry-comment') + '">';
    html += '<div style="margin-bottom:2px">' + badge + ' <span class="journal-meta">' + esc(created) + ' - ' + esc(author) + '</span></div>';
    html += '<div style="color:var(--text);white-space:pre-wrap">' + esc(value) + '</div>';
    html += '</div>';
  }
  if (maxShow < journal.length) {
    var remaining = journal.length - maxShow;
    html += '<div style="text-align:center;padding:4px 0">';
    html += '<a class="view-notes-more" data-ticket="' + esc(ticket) + '" style="cursor:pointer;color:var(--primary);font-size:var(--text-sm)">Load more (' + remaining + ' remaining)</a>';
    html += '</div>';
  } else {
    html += '<div style="text-align:center;padding:8px 0 4px">';
    html += '<button class="copy-notes-md" data-ticket="' + esc(ticket) + '" style="cursor:pointer;font-size:var(--text-sm);padding:4px 12px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);color:var(--text)">Copy Ticket as MD</button>';
    html += '</div>';
  }
  container.innerHTML = html;
}

// Delegated event handler for links (avoids inline onclick which CSP blocks)
document.addEventListener("click", (e) => {
  // --- Take (Infinity preset): assign to self + In Progress ---
  if (e.target.classList.contains("take-link")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    if (!ticket) return;
    const link = e.target;
    const originalText = link.textContent;
    link.classList.add("disabled");
    link.textContent = "Taking...";
    send({ action: "takeTicket", ticketNumber: ticket })
      .then(() => {
        // Replace link with a static "✓ Taken" marker
        const taken = document.createElement("span");
        taken.className = "taken-marker";
        taken.textContent = "✓ Taken";
        link.replaceWith(taken);
        // Refresh this card's state badge to In Progress and show "You" assignee
        const card = taken.closest(".ticket-card");
        if (card) {
          // State badge: In Progress (state 2) is incident-only by design — Infinity alarms
          // are INCs and takeTicket sends state:"2" unconditionally. The class "state-active"
          // matches TABLE_STATES.incident.classes["2"]. If this ever extends to another table,
          // route through getStateConfig/stateBadge instead of hardcoding the class.
          const badge = card.querySelector(".state-badge");
          if (badge) {
            badge.className = "state-badge state-active";
            badge.textContent = "In Progress";
          }
          // Assigned to: find the field line labeled "Assigned to" and append a "You" badge
          const fields = card.querySelectorAll(".ticket-field");
          for (const f of fields) {
            if (/^Assigned to:/i.test(f.textContent.trim())) {
              // Avoid double-appending if already taken
              if (!f.querySelector(".take-you")) {
                const youBadge = document.createElement("span");
                youBadge.className = "take-you";
                youBadge.style.marginLeft = "6px";
                youBadge.textContent = "You";
                f.appendChild(youBadge);
              }
              break;
            }
          }
        }
      })
      .catch((err) => {
        link.classList.remove("disabled");
        link.textContent = originalText;
        link.insertAdjacentHTML("afterend", '<span class="inline-err error" style="margin-left:8px">' + userFacingError(err.message) + '</span>');
        // Clean up the error after a few seconds so retry is clean
        setTimeout(() => {
          const next = link.nextElementSibling;
          if (next && next.classList.contains("inline-err")) next.remove();
        }, 4000);
      });
    return;
  }
  // --- Toggle Device Password section ---
  if (e.target.classList.contains("toggle-cred")) {
    e.preventDefault();
    var credId = e.target.dataset.credId;
    var sec = document.getElementById(credId);
    if (sec.style.display === 'none') {
      sec.style.display = 'block';
      e.target.innerHTML = '&#9660; Device Password (' + sec.children.length + ')';
    } else {
      sec.style.display = 'none';
      e.target.innerHTML = '&#9654; Device Password (' + sec.children.length + ')';
    }
    return;
  }
  // --- Lazy-load device credentials on list cards ---
  if (e.target.classList.contains("load-creds-link")) {
    e.preventDefault();
    var link = e.target;
    var ciSysId = link.dataset.ciSysid;
    var prefix = link.dataset.prefix;
    var container = document.getElementById("creds-" + prefix);
    if (!container) return;
    if (link._loading) return;
    if (link._loaded) {
      if (container.style.display === "none") {
        container.style.display = "block";
        link.innerHTML = "&#9660; Device Password" + (link._count ? " (" + link._count + ")" : "");
      } else {
        container.style.display = "none";
        link.innerHTML = "&#9654; Device Password" + (link._count ? " (" + link._count + ")" : "");
      }
      return;
    }
    link._loading = true;
    container.style.display = "block";
    container.innerHTML = '<div class="loading">Loading credentials...</div>';
    send({ action: "getCredentials", ciSysId: ciSysId })
      .then(function(creds) {
        link._loading = false;
        link._loaded = true;
        link._count = (creds && creds.length) || 0;
        link.innerHTML = "&#9660; Device Password" + (link._count ? " (" + link._count + ")" : "");
        if (!creds || creds.length === 0) {
          container.innerHTML = '<div class="ticket-field" style="color:var(--text-muted)">No active credentials</div>';
        } else {
          container.innerHTML = renderCredentialsBlock(prefix, creds);
        }
      })
      .catch(function(err) {
        link._loading = false;
        container.innerHTML = '<div class="error">' + userFacingError(err.message) + '</div>';
      });
    return;
  }
  // --- Toggle password visibility ---
  if (e.target.classList.contains("toggle-pw")) {
    e.preventDefault();
    var pwId = e.target.dataset.pwId;
    var mask = document.getElementById(pwId + '-mask');
    var text = document.getElementById(pwId + '-text');
    if (mask.style.display !== 'none') {
      mask.style.display = 'none'; text.style.display = 'inline'; e.target.textContent = 'hide';
    } else {
      mask.style.display = 'inline'; text.style.display = 'none'; e.target.textContent = 'show';
    }
    return;
  }
  // --- Open ticket in existing SNOW tab ---
  if (e.target.dataset.snowNumber) {
    e.preventDefault();
    var num = e.target.dataset.snowNumber;
    var url = snowUrl(num);
    chrome.tabs.query({ url: "*://avaya.service-now.com/*" }, function(tabs) {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url: url, active: true });
      } else {
        chrome.tabs.create({ url: url });
      }
    });
    return;
  }
  if (e.target.classList.contains("toggle-link")) {
    e.preventDefault();
    const action = e.target.dataset.action;
    const id = e.target.dataset.id;
    if (action === "expand") {
      document.getElementById(id + "-short").style.display = "none";
      document.getElementById(id + "-full").style.display = "block";
    } else if (action === "collapse") {
      document.getElementById(id + "-full").style.display = "none";
      document.getElementById(id + "-short").style.display = "block";
    }
  }
  // --- Inline View Notes ---
  if (e.target.classList.contains("view-notes-link") || e.target.classList.contains("view-notes-more")) {
    e.preventDefault();
    var isLoadMore = e.target.classList.contains("view-notes-more");
    var ticket = e.target.dataset.ticket;
    if (!ticket) return;
    var notesId = "notes-inline-" + ticket.replace(/[^a-zA-Z0-9]/g, "");
    var container = document.getElementById(notesId);

    // Toggle off (only for the main link, not Load More)
    if (!isLoadMore && container && container.style.display !== "none") {
      container.style.display = "none";
      return;
    }

    // Load More — increase visible count and re-render
    if (isLoadMore && container && container._journalData) {
      var shown = (container._shownCount || 5) + 5;
      container._shownCount = shown;
      renderJournalInline(container, container._journalData, shown);
      return;
    }

    // Mutual exclusion: hide all inline forms in the same ticket card
    var card = e.target.closest(".ticket-card");
    if (card) card.querySelectorAll(".inline-form").forEach(function(f) { f.style.display = "none"; });

    // Create container and fetch — always refetch on each open to surface latest notes
    if (!container) {
      var wrapper = document.createElement("div");
      wrapper.id = notesId;
      wrapper.className = "inline-form";
      wrapper.style.background = "transparent";
      wrapper.style.border = "none";
      wrapper.style.padding = "0";
      wrapper.innerHTML = '<div class="loading">Loading notes...</div>';
      e.target.closest(".action-links-row").insertAdjacentElement("afterend", wrapper);
      container = wrapper;
    } else {
      container.style.display = "block";
      container.innerHTML = '<div class="loading">Loading notes...</div>';
    }

    send({ action: "getTicket", ticketNumber: ticket, includeJournal: true })
      .then(function(data) {
        var journal = (data && data._journal) ? data._journal : [];
        container._journalData = journal;
        container._ticketData = data;
        container._shownCount = 5;
        renderJournalInline(container, journal, 5);
      })
      .catch(function(err) {
        container.innerHTML = '<div class="error">' + userFacingError(err.message) + '</div>';
      });
    return;
  }
  // --- Copy Ticket as MD ---
  if (e.target.classList.contains("copy-notes-md")) {
    e.preventDefault();
    var ticket = e.target.dataset.ticket;
    var notesId = "notes-inline-" + ticket.replace(/[^a-zA-Z0-9]/g, "");
    var container = document.getElementById(notesId);
    if (!container || !container._journalData) return;
    var t = container._ticketData || {};
    var table = detectTable(ticket);
    var cfg = getStateConfig(table);
    var stateVal = typeof t.state === "object" ? t.state.value : t.state;
    var stateLabel = (cfg.labels && cfg.labels[stateVal]) ? cfg.labels[stateVal] : stateVal;
    var md = "# " + ticket + "\n\n";
    md += "- **Description:** " + displayVal(t.short_description) + "\n";
    md += "- **State:** " + stateLabel + "\n";
    md += "- **Priority:** " + displayVal(t.priority) + "\n";
    md += "- **Assigned to:** " + displayVal(t.assigned_to) + "\n";
    md += "- **Assignment group:** " + displayVal(t.assignment_group) + "\n";
    md += "- **Updated:** " + displayVal(t.sys_updated_on) + "\n";
    var desc = displayVal(t.description);
    if (desc) md += "\n## Details\n\n" + desc + "\n";
    md += "\n## Notes\n\n";
    var journal = container._journalData;
    for (var i = 0; i < journal.length; i++) {
      var entry = journal[i];
      var type = displayVal(entry.element) === "work_notes" ? "Work Note" : "Comment";
      var author = displayVal(entry.sys_created_by);
      var created = displayVal(entry.sys_created_on);
      var value = displayVal(entry.value) || "";
      md += "### " + type + " " + created + " - " + author + "\n\n";
      md += value + "\n\n---\n\n";
    }
    var ta = document.createElement("textarea");
    ta.value = md;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); e.target.textContent = "Copied!"; }
    catch(ex) { e.target.textContent = "Copy failed"; }
    document.body.removeChild(ta);
    setTimeout(function() { e.target.textContent = "Copy Ticket as MD"; }, 2000);
    return;
  }
  // --- Inline Add Note ---
  if (e.target.classList.contains("add-note-link")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    if (!ticket) return;
    const formId = "note-inline-" + ticket.replace(/[^a-zA-Z0-9]/g, "");
    let form = document.getElementById(formId);
    // Toggle off if already visible
    if (form && form.style.display !== "none") { form.style.display = "none"; return; }
    // Mutual exclusion: hide all inline forms in the same ticket card
    const card = e.target.closest(".ticket-card");
    if (card) card.querySelectorAll(".inline-form").forEach(function(f) { f.style.display = "none"; });
    if (form) {
      form.querySelectorAll(".inline-status-msg, .inline-err").forEach(function(el) { el.remove(); });
      const textEl = form.querySelector(".inline-note-text");
      if (textEl) textEl.style.borderColor = "";
      if (form._collapseTimer) { clearTimeout(form._collapseTimer); form._collapseTimer = null; }
      form.style.display = "block";
      return;
    }
    var noteOpts = buildNoteTypeOptions('Internal Only');
    var formHtml = '<div id="' + formId + '" class="inline-form inline-form-note">'
      + '<div style="margin-bottom:4px"><label>Work Note Type</label>'
      + '<select class="inline-note-type">' + noteOpts + '</select></div>'
      + '<div class="effort-row" style="margin-bottom:4px">'
      + '<div><label>Effort</label><input class="inline-note-effort effort-input" type="text" placeholder="min"></div>'
      + '<select class="inline-note-effort-unit" style="margin-bottom:0"><option value="minutes">min</option><option value="hours">hr</option></select>'
      + '</div>'
      + '<div style="margin-bottom:4px"><label>Message</label>'
      + '<textarea class="inline-note-text" rows="6" placeholder="Enter note..."></textarea></div>'
      + '<button class="btn btn-primary add-note-exec" data-ticket="' + esc(ticket) + '" data-form="' + formId + '" style="width:100%;padding:5px 8px">Submit</button>'
      + '</div>';
    e.target.parentElement.insertAdjacentHTML("afterend", formHtml);
  }
  if (e.target.classList.contains("add-note-exec")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    const formId = e.target.dataset.form;
    const form = document.getElementById(formId);
    
    // Clear previous status/error messages
    form.querySelectorAll(".inline-status-msg, .inline-err").forEach(function(el) { el.remove(); });
    
    const textEl = form.querySelector(".inline-note-text");
    const text = textEl.value.trim();
    if (!text) { textEl.style.borderColor = "var(--danger)"; return; }
    textEl.style.borderColor = "";
    
    const noteType = form.querySelector(".inline-note-type").value;
    var effortMinutes = null;
    const effortEl = form.querySelector(".inline-note-effort");
    var effortRaw = effortEl.value.trim();
    var effortUnit = form.querySelector(".inline-note-effort-unit").value;
    if (effortRaw) { var v = parseFloat(effortRaw); if (!isNaN(v) && v > 0) effortMinutes = effortUnit === "hours" ? Math.round(v * 60) : Math.round(v); }
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "Submitting...";
    send({ action: "addComment", ticketNumber: ticket, comment: text, isWorkNote: true, noteType, visibility: "internal", effortMinutes })
      .then((data) => {
        btn.disabled = false;
        btn.textContent = "Submit";
        textEl.value = "";
        effortEl.value = "";
        
        var msgHtml = '<div class="inline-status-msg success">Note added</div>';
        if (effortMinutes && data && data.timeResult) {
          if (data.timeResult.error) msgHtml += '<div class="inline-status-msg error" style="margin-top:2px">Time error: ' + esc(data.timeResult.error) + '</div>';
          else { var hrs = Math.floor(effortMinutes / 60); var mins = effortMinutes % 60; msgHtml += '<div class="status-note status-note-success">Effort: ' + (hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + ' min') + ' recorded</div>'; }
        }
        btn.insertAdjacentHTML("afterend", msgHtml);
        if (form._collapseTimer) clearTimeout(form._collapseTimer);
        form._collapseTimer = setTimeout(function() { if (form) form.style.display = "none"; }, 800);
      })
      .catch((err) => { btn.disabled = false; btn.textContent = "Submit"; btn.insertAdjacentHTML("afterend", '<div class="inline-err error" style="margin-top:2px">' + userFacingError(err.message) + '</div>'); });
  }
  // --- Inline Update Status ---
  if (e.target.classList.contains("update-link")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    if (!ticket) return;
    const formId = "update-inline-" + ticket.replace(/[^a-zA-Z0-9]/g, "");
    let form = document.getElementById(formId);
    // Toggle off if already visible
    if (form && form.style.display !== "none") { form.style.display = "none"; return; }
    // Mutual exclusion: hide all inline forms in the same ticket card
    const card = e.target.closest(".ticket-card");
    if (card) card.querySelectorAll(".inline-form").forEach(function(f) { f.style.display = "none"; });
    if (form) {
      form.querySelectorAll(".inline-status-msg, .inline-err").forEach(function(el) { el.remove(); });
      const stateEl = form.querySelector(".inline-state-select");
      if (stateEl) stateEl.style.borderColor = "";
      const followupEl = form.querySelector(".inline-followup");
      if (followupEl) followupEl.style.borderColor = "";
      if (form._collapseTimer) { clearTimeout(form._collapseTimer); form._collapseTimer = null; }
      form.style.display = "block";
      return;
    }
    var iuTable = detectTable(ticket);
    var iuCfg = getStateConfig(iuTable);
    var stateOpts = '<option value="">-- Select --</option>';
    for (var si = 0; si < iuCfg.selectableStates.length; si++) {
      var sv = iuCfg.selectableStates[si];
      stateOpts += '<option value="' + esc(sv) + '">' + esc(iuCfg.labels[sv] || sv) + '</option>';
    }
    var followupHtml = iuCfg.hasFollowUp
      ? '<div class="inline-followup-group" style="display:none;margin-bottom:4px"><label>Follow-up Date & Time</label><input class="inline-followup" type="datetime-local"></div>'
      : '';
    var formHtml = '<div id="' + formId + '" class="inline-form inline-form-update">'
      + '<div style="margin-bottom:4px;display:flex;gap:4px">'
      + '<div style="flex:1"><label>State</label>'
      + '<select class="inline-state-select" data-table="' + esc(iuTable) + '">' + stateOpts + '</select></div>'
      + '<div style="flex:1"><label>Status Reason</label>'
      + '<select class="inline-reason-select"><option value="">Select state first</option></select></div>'
      + '</div>'
      + followupHtml
      + '<div style="margin-bottom:4px"><label>Notes</label>'
      + '<textarea class="inline-update-notes" rows="6" placeholder="Optional notes..."></textarea></div>'
      + '<div class="effort-row" style="margin-bottom:4px">'
      + '<div><label>Effort</label><input class="inline-update-effort effort-input" type="text" placeholder="min"></div>'
      + '<select class="inline-update-effort-unit" style="margin-bottom:0"><option value="minutes">min</option><option value="hours">hr</option></select>'
      + '</div>'
      + '<button class="btn btn-primary update-exec" data-ticket="' + esc(ticket) + '" data-form="' + formId + '" style="width:100%;padding:5px 8px">Update</button>'
      + '</div>';
    e.target.parentElement.insertAdjacentHTML("afterend", formHtml);
  }
  if (e.target.classList.contains("update-exec")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    const formId = e.target.dataset.form;
    const form = document.getElementById(formId);
    
    // Clear previous status/error messages
    form.querySelectorAll(".inline-status-msg, .inline-err").forEach(function(el) { el.remove(); });
    
    const stateEl = form.querySelector(".inline-state-select");
    const state = stateEl.value;
    const ueTable = stateEl.dataset.table || "incident";
    const ueCfg = getStateConfig(ueTable);
    if (!state) { stateEl.style.borderColor = "var(--danger)"; return; }
    stateEl.style.borderColor = "";

    const fields = { state: state };
    const reason = form.querySelector(".inline-reason-select").value;
    if (reason && reason !== "-- None --") fields.u_status_reason = reason;
    if (state === ueCfg.pendingState && ueCfg.hasFollowUp) {
      const followupEl = form.querySelector(".inline-followup");
      if (followupEl && !followupEl.value) { followupEl.style.borderColor = "var(--danger)"; return; }
      if (followupEl) {
        followupEl.style.borderColor = "";
        var fd = new Date(followupEl.value);
        if (isNaN(fd.getTime())) { followupEl.style.borderColor = "var(--danger)"; return; }
        var fp = function(n){ return String(n).padStart(2,'0'); };
        fields.follow_up = fd.getUTCFullYear()+'-'+fp(fd.getUTCMonth()+1)+'-'+fp(fd.getUTCDate())+' '+fp(fd.getUTCHours())+':'+fp(fd.getUTCMinutes())+':00';
      }
    }
    const notesEl = form.querySelector(".inline-update-notes");
    const notes = notesEl.value.trim();
    if (notes) { fields.work_notes = notes; fields.u_private_note = notes; if (state === ueCfg.resolveState) fields.u_resolution_notes = notes; }
    var effortMinutes = null;
    const effortEl = form.querySelector(".inline-update-effort");
    var effortRaw = effortEl.value.trim();
    var effortUnit = form.querySelector(".inline-update-effort-unit").value;
    if (effortRaw) { var v = parseFloat(effortRaw); if (!isNaN(v) && v > 0) effortMinutes = effortUnit === "hours" ? Math.round(v * 60) : Math.round(v); }
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "Updating...";
    send({ action: "updateTicket", ticketNumber: ticket, fields, effortMinutes })
      .then((data) => {
        btn.disabled = false;
        btn.textContent = "Update";
        if (notesEl) notesEl.value = "";
        if (effortEl) effortEl.value = "";
        
        var msgHtml = '<div class="inline-status-msg success" style="font-weight:600">State updated to ' + esc(ueCfg.labels[state] || state) + '</div>';
        if (effortMinutes && data && data.timeResult) {
          if (data.timeResult.error) msgHtml += '<div class="inline-status-msg error" style="margin-top:2px">Time error: ' + esc(data.timeResult.error) + '</div>';
          else { var hrs = Math.floor(effortMinutes / 60); var mins = effortMinutes % 60; msgHtml += '<div class="status-note status-note-success">Effort: ' + (hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + ' min') + ' recorded</div>'; }
        }
        btn.insertAdjacentHTML("afterend", msgHtml);
        if (form._collapseTimer) clearTimeout(form._collapseTimer);
        form._collapseTimer = setTimeout(function() { if (form) form.style.display = "none"; }, 800);
      })
      .catch((err) => { btn.disabled = false; btn.textContent = "Update"; btn.insertAdjacentHTML("afterend", '<div class="inline-err error" style="margin-top:2px">' + userFacingError(err.message) + '</div>'); });
  }
  // --- Inline Alarm Close ---
  if (e.target.classList.contains("alarm-close-link")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    if (!ticket) return;
    const formId = "alarm-inline-" + ticket.replace(/[^a-zA-Z0-9]/g, "");
    let form = document.getElementById(formId);
    // Toggle off if already visible
    if (form && form.style.display !== "none") { form.style.display = "none"; return; }
    // Mutual exclusion: hide all inline forms in the same ticket card
    const card = e.target.closest(".ticket-card");
    if (card) card.querySelectorAll(".inline-form").forEach(function(f) { f.style.display = "none"; });
    if (form) {
      form.querySelectorAll(".inline-status-msg, .inline-err").forEach(function(el) { el.remove(); });
      const noteInput = form.querySelector(".alarm-note-input");
      if (noteInput) noteInput.style.borderColor = "";
      if (form._collapseTimer) { clearTimeout(form._collapseTimer); form._collapseTimer = null; }
      form.style.display = "block";
      return;
    }
    const defaultTmpl = "Investigated alarm, confirmed cleared. Closing ticket.";
    const formHtml = '<div id="' + formId + '" class="inline-form inline-form-alarm">'
      + '<div style="margin-bottom:4px"><label>Note Template</label>'
      + '<select class="alarm-tmpl-select" data-form="' + formId + '">'
      + '<option value="Investigated alarm, confirmed cleared. Closing ticket.">Investigated alarm, confirmed cleared</option>'
      + '<option value="Alarm(s) cleared on access. Verified system restored to normal operation.">Alarms cleared on access</option>'
      + '<option value="False alarm confirmed. No further action required.">False alarm confirmed</option>'
      + '<option value="">Custom</option>'
      + '</select></div>'
      + '<div style="margin-bottom:4px"><label>Close Note</label>'
      + '<textarea class="alarm-note-input" data-form="' + formId + '" rows="6">' + esc(defaultTmpl) + '</textarea></div>'
      + '<div class="effort-row">'
      + '<div><label>Effort</label><input class="alarm-effort-input effort-input" data-form="' + formId + '" type="text" placeholder="min"></div>'
      + '<select class="alarm-effort-unit" style="margin-bottom:0"><option value="minutes">min</option><option value="hours">hr</option></select>'
      + '<button class="btn btn-success alarm-close-exec" data-ticket="' + esc(ticket) + '" data-form="' + formId + '" style="flex:1;padding:5px 8px">Close Alarm</button>'
      + '</div>'
      + '</div>';
    e.target.parentElement.insertAdjacentHTML("afterend", formHtml);
  }
  if (e.target.classList.contains("alarm-close-exec")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    const formId = e.target.dataset.form;
    const form = document.getElementById(formId);
    
    // Clear previous status/error messages
    form.querySelectorAll(".inline-status-msg, .inline-err").forEach(function(el) { el.remove(); });
    
    const noteInput = form ? form.querySelector(".alarm-note-input") : null;
    const effortInput = form ? form.querySelector(".alarm-effort-input") : null;
    const effortUnitEl = form ? form.querySelector(".alarm-effort-unit") : null;
    const note = noteInput ? noteInput.value.trim() : "";
    if (!note) {
      if (noteInput) noteInput.style.borderColor = "var(--danger)";
      return;
    }
    if (noteInput) noteInput.style.borderColor = "";
    
    let effortMinutes = null;
    if (effortInput && effortInput.value.trim()) {
      const val = parseFloat(effortInput.value.trim());
      var effortUnit = effortUnitEl ? effortUnitEl.value : "minutes";
      if (!isNaN(val) && val > 0) effortMinutes = effortUnit === "hours" ? Math.round(val * 60) : Math.round(val);
    }
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "Closing...";
    send({ action: "alarmClose", ticketNumber: ticket, note, effortMinutes })
      .then((data) => {
        btn.disabled = false;
        btn.textContent = "Close Alarm";
        if (effortInput) effortInput.value = "";

        let msgHtml = "";
        if (data.steps && data.steps.length) {
          for (let i = 0; i < data.steps.length; i++) {
            msgHtml += '<div class="step-item step-ok"><span class="step-icon">✓</span><span class="step-label">Step ' + (i + 1) + '/' + esc(String(data.totalSteps || data.steps.length)) + ': ' + esc(data.steps[i].label) + '</span></div>';
          }
        }
        msgHtml += '<div class="inline-status-msg success" style="font-weight:600">Closed successfully</div>';
        if (effortMinutes && data.timeResult) {
          if (data.timeResult.error) {
            msgHtml += '<div class="inline-status-msg error" style="margin-top:2px">Time error: ' + esc(data.timeResult.error) + '</div>';
          } else {
            msgHtml += '<div class="status-note status-note-success">Effort: ' + effortMinutes + ' min recorded</div>';
          }
        }
        const container = btn.parentElement;
        container.insertAdjacentHTML("afterend", msgHtml);
        if (form._collapseTimer) clearTimeout(form._collapseTimer);
        form._collapseTimer = setTimeout(function() { if (form) form.style.display = "none"; }, 800);
      })
      .catch((err) => {
        btn.disabled = false;
        btn.textContent = "Close Alarm";
        const container = btn.parentElement;
        container.insertAdjacentHTML("afterend", '<div class="inline-err error" style="margin-top:2px">' + userFacingError(err.message) + '</div>');
      });
  }
});

// Delegated change handler for inline selects
document.addEventListener("change", (e) => {
  // Alarm template → textarea
  if (e.target.classList.contains("alarm-tmpl-select")) {
    var noteInput = e.target.closest("div[id]").querySelector(".alarm-note-input");
    if (noteInput) noteInput.value = e.target.value;
  }
  // State → status reasons
  if (e.target.classList.contains("inline-state-select")) {
    var form = e.target.closest("div[id]");
    var reasonSelect = form.querySelector(".inline-reason-select");
    var followupGroup = form.querySelector(".inline-followup-group");
    var iuTable = e.target.dataset.table || "incident";
    var iuCfg = getStateConfig(iuTable);
    var reasons = iuCfg.reasons[e.target.value] || [];
    reasonSelect.innerHTML = "";
    if (reasons.length === 0) {
      reasonSelect.innerHTML = '<option value="">-- None --</option>';
    } else {
      for (var i = 0; i < reasons.length; i++) {
        var opt = document.createElement("option");
        opt.value = reasons[i];
        opt.textContent = reasons[i];
        reasonSelect.appendChild(opt);
      }
    }
    if (followupGroup) followupGroup.style.display = (e.target.value === iuCfg.pendingState && iuCfg.hasFollowUp) ? "block" : "none";
  }
});

// --- Query ---
const queryResult = document.getElementById("result");

document.getElementById("btn-query").addEventListener("click", async () => {
  const number = document.getElementById("query-number").value.trim();
  if (!number) return;
  showLoading(queryResult);
  try {
    const ticket = await send({ action: "getTicket", ticketNumber: number, includeJournal: true, includeCi: true });
    if (!ticket) {
      queryResult.innerHTML = `<div class="error">Ticket ${esc(number)} not found</div>`;
      return;
    }
    const qTable = detectTable(number);
    const sc = staleClass(ticket.sys_updated_on, ticket.state, qTable);
    let html = `<div class="ticket-card${sc}">`;
    html += `<div>${ticketLink(displayVal(ticket.number) || number)}${staleBadge(ticket.sys_updated_on, ticket.state, qTable)}</div>`;
    const qSubcls = displayVal(ticket.contact_type);
    const qCfg = getStateConfig(qTable);
    if (qSubcls === "Alarm" && qCfg.supportsAlarmClose) html += `<span class="alarm-badge">Alarm</span>`;
    html += formatField("Description", ticket.short_description);
    const stateRaw = typeof ticket.state === "object" ? ticket.state.value : ticket.state;
    html += `<div class="ticket-field"><b>State:</b> ${stateBadge(ticket.state, qTable)}</div>`;
    html += formatField("Priority", ticket.priority);
    html += formatField("Assigned to", ticket.assigned_to);
    html += formatField("Assignment group", ticket.assignment_group);
    html += formatField("Updated", ticket.sys_updated_on);
    // CI Remote Access info
    if (ticket._ci && !ticket._ci._error) {
      html += `<div class="ticket-field" style="margin-top:8px"><b>Remote Access:</b></div>`;
      html += renderCiBlock(ticket._ci, 'q');
    } else if (ticket.cmdb_ci && displayVal(ticket.cmdb_ci)) {
      const ciError = (ticket._ci && ticket._ci._error) ? ' (' + esc(ticket._ci._error) + ')' : ' (details unavailable)';
      html += `<div class="ticket-field" style="margin-top:8px;color:var(--text-muted)"><b>CI:</b> ${esc(displayVal(ticket.cmdb_ci))}${ciError}</div>`;
    }
    const desc = displayVal(ticket.description);
    if (desc) {
      if (desc.length > 300) {
        const id = "det-" + Math.random().toString(36).slice(2, 8);
        html += `<div class="ticket-field"><b>Details:</b> `;
        html += `<span id="${id}-short">${esc(desc.substring(0, 300))}... <a class="toggle-link" data-action="expand" data-id="${id}">show all</a></span>`;
        html += `<span id="${id}-full" style="display:none">${esc(desc)} <a class="toggle-link" data-action="collapse" data-id="${id}">collapse</a></span>`;
        html += `</div>`;
      } else {
        html += formatField("Details", desc);
      }
    }
    // Inline action links for query results
    html += `<div class="action-links-row">`;
    html += `<a class="view-notes-link" data-ticket="${esc(displayVal(ticket.number) || number)}">View Notes</a>`;
    html += `<a class="add-note-link" data-ticket="${esc(displayVal(ticket.number) || number)}">+ Add Note</a>`;
    html += `<a class="update-link" data-ticket="${esc(displayVal(ticket.number) || number)}">Update Status</a>`;
    if (qSubcls === "Alarm" && qCfg.supportsAlarmClose) html += `<a class="alarm-close-link" data-ticket="${esc(displayVal(ticket.number) || number)}">Close Alarm</a>`;
    html += `</div></div>`;
    queryResult.innerHTML = html;
  } catch (e) {
    showError(queryResult, e.message);
  }
});

document.getElementById("query-number").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-query").click();
});

// --- List ---
const listResult = document.getElementById("list-result");
let listAutoLoaded = false;

const PRESETS = {
  "my-open": "active=true^assigned_to=javascript:gs.getUserID()",
  "my-open-alarms": "active=true^assigned_to=javascript:gs.getUserID()^contact_type=Alarm",
  "my-updated": "assigned_to=javascript:gs.getUserID()^ORDERBYsys_updated_on",
  "my-resolved": "assigned_to=javascript:gs.getUserID()^state=7^resolved_onONLast 7 days@javascript:gs.daysAgoStart(7)@javascript:gs.daysAgoEnd(0)",
  "group-open": "active=true^assignment_group=javascript:gs.getUser().getMyGroups()",
  "p1-p2": "active=true^priorityIN1,2",
  "all-open": "active=true^ORDERBYsys_updated_on",
  "updated-today": "sys_updated_onONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^ORDERBYDESCsys_updated_on",
  "created-today": "sys_created_onONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^ORDERBYDESCsys_created_on",
  "awaiting": "state=4^assigned_to=javascript:gs.getUserID()",
  // Infinity Alarms (Unassigned) — active, New, Avaya Infinity Platform group, unassigned.
  //
  // Two non-obvious encodings, both forced by this instance's ACLs/config:
  //  1. assignment_group.name=<display>  (dot-walk, NOT assignment_group=<sys_id>)
  //     The sys_id form hits an ACL that silently excludes unassigned incidents
  //     from the result set. Verified empirically: sys_id returns 4 (all assigned),
  //     dot-walk returns 5 (including the unassigned one).
  //  2. trailing ^EQ  — this instance silently drops the ISEMPTY condition unless
  //     the query ends with a bare ^EQ terminator. This matches SNOW's own built-in
  //     "Open - Unassigned" module (module bf2c0383c0a801640128cbe631d11c4b),
  //     whose encoded query is `active=true^assigned_toISEMPTY^EQ`. Without ^EQ,
  //     the query returns 0 even though unassigned tickets provably exist.
  "infinity-alarms": "active=true^state=1^assignment_group.name=Avaya Infinity Platform^assigned_toISEMPTY^EQ",
};

// Restore saved List sort selections; default = Case ID desc (new on top)
function restoreListSort() {
  const keySel = document.getElementById("list-sort-key");
  const dirSel = document.getElementById("list-sort-dir");
  if (!keySel || !dirSel) return;
  keySel.value = localStorage.getItem("snow_list_sort_key") || "id";
  dirSel.value = localStorage.getItem("snow_list_sort_dir") || "desc";
  keySel.addEventListener("change", () => localStorage.setItem("snow_list_sort_key", keySel.value));
  dirSel.addEventListener("change", () => localStorage.setItem("snow_list_sort_dir", dirSel.value));
}

document.getElementById("list-preset").addEventListener("change", (e) => {
  const preset = e.target.value;
  if (preset && PRESETS[preset]) {
    document.getElementById("list-query").value = PRESETS[preset];
  }
});

document.getElementById("btn-list").addEventListener("click", async () => {
  const table = document.getElementById("list-table").value;
  let query = document.getElementById("list-query").value.trim();
  const limit = parseInt(document.getElementById("list-limit").value) || 10;
  // Flag for the card-rendering loop: show the Take link only when the Infinity
  // preset is the active filter. Detected by the dropdown selection, not the query
  // string, because the Infinity query is now a plain static string (like every
  // other preset) — there's no marker to intercept.
  let infinityMode = (document.getElementById("list-preset").value === "infinity-alarms");
  showLoading(listResult);
  try {
    const tickets = await send({ action: "listTickets", table, query, limit, includeCi: true });
    // Sort: user-selected key + direction (default Case ID desc). Comparator
    // routes all field access through displayVal/valueVal/parseUpdatedOn so the
    // {value, display_value} objects from sysparm_display_value=all don't NaN.
    const sortKey = document.getElementById("list-sort-key").value;
    const sortDir = document.getElementById("list-sort-dir").value;
    tickets.sort((a, b) => compareTickets(a, b, sortKey, sortDir));
    if (!tickets.length) {
      listResult.innerHTML = '<div class="ticket-field" style="padding:8px">No tickets found</div>';
      return;
    }
    let html = "";
    for (const t of tickets) {
      const lTable = detectTable(displayVal(t.number));
      const sc = staleClass(t.sys_updated_on, t.state, lTable);
      html += `<div class="ticket-card${sc}">`;
      html += `<div>${ticketLink(displayVal(t.number))}${staleBadge(t.sys_updated_on, t.state, lTable)}</div>`;
      const subcls = displayVal(t.contact_type);
      const lCfg = getStateConfig(lTable);
      if (subcls === "Alarm" && lCfg.supportsAlarmClose) html += `<span class="alarm-badge">Alarm</span>`;
      html += formatField("Description", t.short_description);
      const stateRaw = typeof t.state === "object" ? t.state.value : t.state;
      html += `<div class="ticket-field"><b>State:</b> ${stateBadge(t.state, lTable)}</div>`;
      html += formatField("Priority", t.priority);
      html += formatField("Assigned to", t.assigned_to);
      html += formatField("Updated", t.sys_updated_on);
      const ciRef = t.cmdb_ci;
      const ciSysId = (ciRef && typeof ciRef === "object") ? ciRef.value : ciRef;
      if (t._ci && ciSysId) {
        html += `<div class="ticket-field" style="margin-top:6px"><b>Remote Access:</b></div>`;
        html += renderCiFields(t._ci);
        const ciSysIdStr = String(ciSysId);
        const credKey = 'l-' + ciSysIdStr;
        html += `<div class="ticket-field" style="margin-top:4px"><a class="load-creds-link" data-ci-sysid="${esc(ciSysIdStr)}" data-prefix="${esc(credKey)}" style="cursor:pointer;color:var(--primary);font-size:var(--text-sm)">&#9654; Device Password</a></div>`;
        html += `<div class="creds-container" id="creds-${esc(credKey)}" style="display:none;margin-top:4px"></div>`;
      } else if (displayVal(t.cmdb_ci)) {
        html += `<div class="ticket-field" style="color:var(--text-muted)"><b>CI:</b> ${esc(displayVal(t.cmdb_ci))}</div>`;
      }
      const lDesc = displayVal(t.description);
      if (lDesc) {
        if (lDesc.length > 300) {
          const lDetId = "ldet-" + Math.random().toString(36).slice(2, 8);
          html += `<div class="ticket-field"><b>Details:</b> `;
          html += `<span id="${lDetId}-short">${esc(lDesc.substring(0, 300))}... <a class="toggle-link" data-action="expand" data-id="${lDetId}">show all</a></span>`;
          html += `<span id="${lDetId}-full" style="display:none">${esc(lDesc)} <a class="toggle-link" data-action="collapse" data-id="${lDetId}">collapse</a></span>`;
          html += `</div>`;
        } else {
          html += formatField("Details", lDesc);
        }
      }
      html += `<div class="action-links-row">`;
      if (infinityMode) html += `<a class="take-link" data-ticket="${esc(displayVal(t.number))}">Take</a>`;
      html += `<a class="view-notes-link" data-ticket="${esc(displayVal(t.number))}">View Notes</a>`;
      html += `<a class="add-note-link" data-ticket="${esc(displayVal(t.number))}">+ Add Note</a>`;
      html += `<a class="update-link" data-ticket="${esc(displayVal(t.number))}">Update Status</a>`;
      if (displayVal(t.contact_type) === "Alarm" && lCfg.supportsAlarmClose) html += `<a class="alarm-close-link" data-ticket="${esc(displayVal(t.number))}">Close Alarm</a>`;
      html += `</div>`;
      html += `</div>`;
    }
    listResult.innerHTML = html;
  } catch (e) {
    showError(listResult, e.message);
  }
});

// --- Comment ---
const commentResult = document.getElementById("comment-result");

document.getElementById("btn-comment").addEventListener("click", async () => {
  const number = document.getElementById("comment-number").value.trim();
  const text = document.getElementById("comment-text").value.trim();
  if (!number || !text) return;
  const isWorkNote = document.getElementById("comment-type").value === "worknote";
  const noteType = document.getElementById("comment-note-type").value;
  const visibility = document.getElementById("comment-visibility").value;
  const effortRaw = document.getElementById("comment-effort").value.trim();
  const effortUnit = document.getElementById("comment-effort-unit").value;
  if (!number || !text) return;
  showLoading(commentResult);
  try {
    let effortMinutes = null;
    if (effortRaw) {
      const val = parseFloat(effortRaw);
      if (!isNaN(val) && val > 0) {
        effortMinutes = effortUnit === "hours" ? Math.round(val * 60) : Math.round(val);
      }
    }
    const data = await send({ action: "addComment", ticketNumber: number, comment: text, isWorkNote, noteType, visibility, effortMinutes });
    let msg = '<div class="success">Note added successfully</div>';
    if (effortMinutes && data && data.timeResult) {
      if (data.timeResult.error) {
        msg += '<div class="status-note status-note-warning">Time worked error: ' + esc(data.timeResult.error) + '</div>';
      } else {
        var hrs = Math.floor(effortMinutes / 60);
        var mins = effortMinutes % 60;
        var timeStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + ' minutes';
        msg += '<div class="status-note status-note-success">Effort: ' + esc(timeStr) + ' recorded</div>';
      }
    }
    commentResult.innerHTML = msg;
    document.getElementById("comment-text").value = "";
    document.getElementById("comment-effort").value = "";
  } catch (e) {
    showError(commentResult, e.message);
  }
});

// --- Action ---
const actionResult = document.getElementById("action-result");
const actionState = document.getElementById("action-state");
const actionFollowupGroup = document.getElementById("action-followup-group");
const actionStatusReason = document.getElementById("action-status-reason");

var currentTicketState = null;
var currentActionTable = "incident";

// Build state options for the Action tab dropdown based on table config
function buildActionStateOptions(table, allowedStates) {
  var cfg = getStateConfig(table);
  var html = '<option value="">-- Select --</option>';
  for (var i = 0; i < cfg.selectableStates.length; i++) {
    var sv = cfg.selectableStates[i];
    var disabled = allowedStates && allowedStates.length > 0 && allowedStates.indexOf(sv) < 0;
    var hidden = disabled;
    html += '<option value="' + esc(sv) + '"' + (disabled ? ' disabled' : '') + ' style="' + (hidden ? 'display:none' : '') + '">' + esc(cfg.labels[sv] || sv) + '</option>';
  }
  return html;
}

// Fetch current ticket state and update allowed transitions
async function refreshActionState(number) {
  if (!number) return;
  try {
    var ticket = await send({ action: "getTicket", ticketNumber: number, includeCi: true });
    if (!ticket) { currentTicketState = null; currentActionTable = "incident"; document.getElementById("alarm-close-group").style.display = "none"; return; }
    var raw = typeof ticket.state === "object" ? ticket.state.value : ticket.state;
    currentTicketState = String(raw);
    currentActionTable = detectTable(number);
    var cfg = getStateConfig(currentActionTable);
    // Show/hide alarm close section based on contact_type and table support
    var contactType = displayVal(ticket.contact_type);
    var alarmGroup = document.getElementById("alarm-close-group");
    var isAlarm = contactType === "Alarm" && cfg.supportsAlarmClose && currentTicketState !== "7" && currentTicketState !== "8";
    alarmGroup.style.display = isAlarm ? "block" : "none";
    // Pre-fill template into note
    if (isAlarm) {
      var tmpl = document.getElementById("alarm-template");
      document.getElementById("alarm-note").value = tmpl.value;
    }
    // Rebuild state dropdown based on table config and allowed transitions
    var allowed = cfg.transitions[currentTicketState] || [];
    actionState.innerHTML = buildActionStateOptions(currentActionTable, allowed);
    // Show/hide follow-up date group based on table config
    actionFollowupGroup.style.display = cfg.hasFollowUp ? "" : "none";
    if (cfg.hasFollowUp) {
      var fl = document.getElementById("action-followup");
      if (fl) fl.required = false;
    }
    // Show current state info
    var stateLabel = cfg.labels[currentTicketState] || currentTicketState;
    var stateHtml = '<div class="current-state-info">Current state: ' + esc(stateLabel) + (isAlarm ? ' &mdash; <span style="color:var(--success);font-weight:500">Alarm INC detected</span>' : '') + '</div>';
    // CI Remote Access info
    if (ticket._ci && !ticket._ci._error) {
      stateHtml += '<div class="ticket-field" style="margin-top:8px"><b>Remote Access:</b></div>';
      stateHtml += renderCiBlock(ticket._ci, 'a');
    } else if (ticket.cmdb_ci && displayVal(ticket.cmdb_ci)) {
      var ciErr = (ticket._ci && ticket._ci._error) ? ' (' + esc(ticket._ci._error) + ')' : ' (details unavailable)';
      stateHtml += '<div class="ticket-field" style="margin-top:8px;color:var(--text-muted)"><b>CI:</b> ' + esc(displayVal(ticket.cmdb_ci)) + ciErr + '</div>';
    }
    actionResult.innerHTML = stateHtml;
  } catch (e) {
    currentTicketState = null;
    currentActionTable = "incident";
    document.getElementById("alarm-close-group").style.display = "none";
  }
}

document.getElementById("action-number").addEventListener("change", function() {
  refreshActionState(this.value.trim());
});
document.getElementById("action-number").addEventListener("keydown", function(e) {
  if (e.key === "Enter") refreshActionState(this.value.trim());
});

document.getElementById("alarm-template").addEventListener("change", function() {
  document.getElementById("alarm-note").value = this.value;
});

document.getElementById("btn-alarm-close").addEventListener("click", async () => {
  const number = document.getElementById("action-number").value.trim();
  if (!number) return;
  const note = document.getElementById("alarm-note").value.trim();
  if (!note) {
    showError(actionResult, "Enter a close note");
    return;
  }
  const btn = document.getElementById("btn-alarm-close");
  btn.disabled = true;
  showLoading(actionResult);
  // Parse effort time
  let effortMinutes = null;
  const effortRaw = document.getElementById("alarm-effort").value.trim();
  const effortUnit = document.getElementById("alarm-effort-unit").value;
  if (effortRaw) {
    const val = parseFloat(effortRaw);
    if (!isNaN(val) && val > 0) {
      effortMinutes = effortUnit === "hours" ? Math.round(val * 60) : Math.round(val);
    }
  }
  try {
    const data = await send({ action: "alarmClose", ticketNumber: number, note, effortMinutes });
    // Show step-by-step progress
    let html = "";
    for (let i = 0; i < data.steps.length; i++) {
      html += '<div class="step-item step-ok"><span class="step-icon">✓</span><span class="step-label">Step ' + (i + 1) + '/' + data.totalSteps + ': ' + esc(data.steps[i].label) + '</span></div>';
    }
    html += '<div class="success">Alarm ticket closed successfully</div>';
    if (effortMinutes && data.timeResult) {
      if (data.timeResult.error) {
        html += '<div class="status-note status-note-warning">Time worked error: ' + esc(data.timeResult.error) + '</div>';
      } else {
        var hrs = Math.floor(effortMinutes / 60);
        var mins = effortMinutes % 60;
        var timeStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + ' minutes';
        html += '<div class="status-note status-note-success">Effort: ' + esc(timeStr) + ' recorded</div>';
      }
    }
    actionResult.innerHTML = html;
    // Refresh state and hide alarm section (ticket is now closed)
    await refreshActionState(number);
    document.getElementById("alarm-effort").value = "";
  } catch (e) {
    showError(actionResult, e.message);
  }
  btn.disabled = false;
});

actionState.addEventListener("change", function() {
  var aCfg = getStateConfig(currentActionTable);
  // Show/hide follow-up date for pending state
  actionFollowupGroup.style.display = (actionState.value === aCfg.pendingState && aCfg.hasFollowUp) ? "" : "none";
  // Update status reason options based on state
  actionStatusReason.innerHTML = "";
  var reasons = aCfg.reasons[actionState.value] || [];
  if (reasons.length === 0) {
    actionStatusReason.innerHTML = '<option value="">-- None --</option>';
  } else {
    for (var i = 0; i < reasons.length; i++) {
      var opt = document.createElement("option");
      opt.value = reasons[i];
      opt.textContent = reasons[i];
      actionStatusReason.appendChild(opt);
    }
  }
});

document.getElementById("btn-update").addEventListener("click", async () => {
  const number = document.getElementById("action-number").value.trim();
  if (!number) return;
  const state = document.getElementById("action-state").value;
  if (!state) {
    showError(actionResult, "Select a state");
    return;
  }
  var uCfg = getStateConfig(currentActionTable);
  // Validate state transition
  if (currentTicketState) {
    var allowed = uCfg.transitions[currentTicketState] || [];
    if (allowed.length > 0 && allowed.indexOf(state) < 0) {
      var fromLabel = uCfg.labels[currentTicketState] || currentTicketState;
      var toLabel = uCfg.labels[state] || state;
      showError(actionResult, "Cannot change from " + fromLabel + " to " + toLabel);
      return;
    }
  }
  const fields = { state };
  const statusReason = document.getElementById("action-status-reason").value;
  if (statusReason && statusReason !== "-- None --") fields.u_status_reason = statusReason;
  if (state === uCfg.pendingState && uCfg.hasFollowUp) {
    const followup = document.getElementById("action-followup").value;
    if (!followup) {
      showError(actionResult, "Follow-up date is required for Pending state");
      return;
    }
    var fd = new Date(followup);
    if (isNaN(fd.getTime())) {
      showError(actionResult, "Invalid follow-up date");
      return;
    }
    var fp = function(n){ return String(n).padStart(2,'0'); };
    fields.follow_up = fd.getUTCFullYear()+'-'+fp(fd.getUTCMonth()+1)+'-'+fp(fd.getUTCDate())+' '+fp(fd.getUTCHours())+':'+fp(fd.getUTCMinutes())+':00';
  }
  const resolutionNote = document.getElementById("action-resolution").value.trim();
  if (resolutionNote) {
    fields.work_notes = resolutionNote;
    fields.u_private_note = resolutionNote;
    if (state === uCfg.resolveState) fields.u_resolution_notes = resolutionNote;
  }
  // Parse effort time (only when there's a note)
  let effortMinutes = null;
  const effortRaw = document.getElementById("action-effort").value.trim();
  const effortUnit = document.getElementById("action-effort-unit").value;
  if (effortRaw) {
    const val = parseFloat(effortRaw);
    if (!isNaN(val) && val > 0) {
      effortMinutes = effortUnit === "hours" ? Math.round(val * 60) : Math.round(val);
    }
  }
  showLoading(actionResult);
  try {
    const data = await send({ action: "updateTicket", ticketNumber: number, fields, effortMinutes });
    let msg = '<div class="success">State updated' + (resolutionNote ? ' with note' : '') + '</div>';
    if (effortMinutes && data && data.timeResult) {
      if (data.timeResult.error) {
        msg += '<div class="status-note status-note-warning">Time worked error: ' + esc(data.timeResult.error) + '</div>';
      } else {
        var hrs = Math.floor(effortMinutes / 60);
        var mins = effortMinutes % 60;
        var timeStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + ' minutes';
        msg += '<div class="status-note status-note-success">Effort: ' + esc(timeStr) + ' recorded</div>';
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

// --- Load note types from SNOW ---
loadNoteTypes();
// --- Restore saved List sort selection (default: Case ID desc) ---
restoreListSort();
// --- Load closure-code options from SNOW (fallback: single verified value) ---
loadStatusReasons();

// --- Auto-load My Open Tickets on startup (List is default tab) ---
listAutoLoaded = true;
document.getElementById("list-preset").value = "my-open";
document.getElementById("list-query").value = PRESETS["my-open"];
document.getElementById("btn-list").click();

// --- Siebel Note ---
const siebelResult = document.getElementById("siebel-result");

document.getElementById("btn-siebel-create").addEventListener("click", async () => {
  const input = document.getElementById("siebel-sr").value.trim();
  if (!input) { showError(siebelResult, "Enter an SR number or Activity ID"); return; }

  const btn = document.getElementById("btn-siebel-create");
  btn.disabled = true;
  btn.textContent = "Working...";
  siebelResult.innerHTML = '<div class="loading">Initializing...</div>';

  try {
    const data = await send({
      action: "siebelCreateActivity",
      srNumber: input
    });

    let html = "";
    if (data.success) {
      var isActivity = /^1-[A-Z0-9]+$/i.test(input) && /[A-Z]/i.test(input);
      var entityLabel = isActivity ? "Activity" : "SR";
      html += '<div class="success">Opened ' + entityLabel + ' ' + esc(input) + ' in Siebel. Fill in the details and save.</div>';
    } else {
      html += '<div class="error">' + esc(data.error || "Failed") + '</div>';
    }
    if (data.steps && data.steps.length > 0) {
      html += '<div class="step-progress">';
      for (const step of data.steps) {
        const cls = step.ok ? 'step-ok' : 'step-fail';
        const icon = step.ok ? '✓' : '✗';
        html += '<div class="step-item ' + cls + '"><span class="step-icon">' + icon + '</span><span class="step-label">' + esc(step.label) + '</span></div>';
      }
      html += '</div>';
    }
    siebelResult.innerHTML = html;
  } catch (e) {
    showError(siebelResult, e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Add a Note in Siebel";
  }
});

// --- Siebel Backlog ---
const sblResults = document.getElementById("siebel-backlog-results");
const sblUsernameInput = document.getElementById("sbl-username");

document.getElementById("btn-siebel-backlog").addEventListener("click", async () => {
  const userName = sblUsernameInput.value.trim();
  if (!userName) {
    sblResults.innerHTML = '<div class="error">Enter your Siebel username</div>';
    return;
  }

  const btn = document.getElementById("btn-siebel-backlog");
  btn.disabled = true;
  btn.textContent = "Loading...";
  sblResults.innerHTML = '<div class="sbl-loading">Fetching backlog from OCD...</div>';

  try {
    const resp = await send({ action: "fetchOcdBacklog", userName: userName });
    if (!resp.items || resp.items.length === 0) {
      sblResults.innerHTML = '<div class="sbl-empty">No SR/SRA items in your backlog</div>';
      return;
    }

    // Sort: severity (OTG→SBI→BI→NBI), then stale days descending
    resp.items.sort((a, b) => {
      const sa = sblSeverityRank(a.activity_severity_name);
      const sb = sblSeverityRank(b.activity_severity_name);
      if (sa !== sb) return sa - sb;
      const ua = parseInt(a.updated_time) || 0;
      const ub = parseInt(b.updated_time) || 0;
      return ua - ub; // smaller timestamp = older = more stale → first
    });

    let html = '<div class="result-box">';
    html += '<div class="ticket-field" style="margin-bottom:8px;color:var(--text-muted)">' + esc(resp.items.length) + ' items for ' + esc(userName) + '</div>';
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
  const updatedMs = updatedSec * 1000;
  const updatedAgo = updatedSec ? timeAgo(updatedMs) : "";
  const desc = esc(item.activity_description || "");
  const truncatedDesc = desc.length > 120 ? desc.substring(0, 120) + "..." : desc;
  const noteText = esc(item.last_status_note || "");
  const truncatedNote = noteText.length > 80 ? noteText.substring(0, 80) + "..." : noteText;

  const isClosed = /closed|resolved|cancelled|cancel/i.test(item.activity_status_name || "");
  let staleCls = "";
  let staleBadgeHtml = "";
  if (!isClosed && updatedMs) {
    const daysSinceUpdate = (Date.now() - updatedMs) / MS_PER_DAY;
    if (daysSinceUpdate >= CRITICAL_STALE_DAYS) {
      staleCls = " sbl-stale-critical";
      staleBadgeHtml = ' <span class="sbl-badge-stale sbl-stale-critical">Stale ' + Math.floor(daysSinceUpdate) + 'd</span>';
    } else if (daysSinceUpdate >= STALE_DAYS) {
      staleCls = " sbl-stale";
      staleBadgeHtml = ' <span class="sbl-badge-stale sbl-stale-warn">Stale ' + Math.floor(daysSinceUpdate) + 'd</span>';
    }
  }

  let html = '<div class="sbl-card' + staleCls + '">';
  html += '<div><a href="#" class="sbl-open-link sbl-num" data-siebel-id="' + esc(item.activity_number) + '" title="Open in Siebel">' + esc(item.activity_number) + '</a>';
  html += ' <span class="sbl-badge sbl-badge-type">' + esc(item._type) + '</span>';
  html += ' <span class="sbl-badge sbl-badge-status ' + statusClass + '">' + esc(item.activity_status_name) + '</span>';
  html += ' <span class="sbl-badge sbl-badge-severity">' + esc(item.activity_severity_name) + '</span>';
  html += staleBadgeHtml;
  html += '</div>';
  html += '<div class="sbl-field">' + truncatedDesc + '</div>';
  html += '<div class="sbl-field"><b>Customer:</b> ' + esc(item.customer_name) + '</div>';
  html += '<div class="sbl-field"><b>Skill:</b> ' + esc(item.skill_name) + '</div>';
  html += '<div class="sbl-meta">Hours: ' + esc(item.hours) + ' | Age: ' + esc(item.age) + ' | Updated: ' + updatedAgo + '</div>';
  if (noteText) {
    html += '<div class="sbl-note-preview" title="Click to expand">' + truncatedNote + '</div>';
  }
  if (item._type === "SRA" && item.parent_activity_number) {
    html += '<div class="sbl-parent">Parent SR: <a href="#" class="sbl-open-link" data-siebel-id="' + esc(item.parent_activity_number) + '" title="Open SR in Siebel">' + esc(item.parent_activity_number) + '</a></div>';
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

// Delegated click handlers for Siebel backlog cards
document.addEventListener("click", async (e) => {
  // --- Open SR/Activity in Siebel ---
  const openLink = e.target.closest(".sbl-open-link");
  if (openLink) {
    e.preventDefault();
    const siebelId = openLink.dataset.siebelId;
    if (!siebelId) return;
    const origText = openLink.textContent;
    openLink.textContent = "Opening...";
    openLink.style.pointerEvents = "none";
    try {
      await send({ action: "openSiebel", siebelId: siebelId });
      openLink.textContent = origText;
    } catch (err) {
      openLink.textContent = origText;
      openLink.insertAdjacentHTML("afterend", '<span style="color:var(--danger);font-size:var(--text-sm);margin-left:4px">' + esc(err.message) + '</span>');
    }
    openLink.style.pointerEvents = "";
    return;
  }

  const addNoteLink = e.target.closest(".sbl-add-note-link");
  if (addNoteLink) {
    const activityId = addNoteLink.dataset.sblId;
    const card = addNoteLink.closest(".sbl-card");
    const actionsDiv = card.querySelector(".sbl-actions");
    addNoteLink.style.display = "none";
    actionsDiv.insertAdjacentHTML("beforeend", '<span class="sbl-note-status" style="color:var(--navy);font-size:var(--text-sm)">Opening in Siebel...</span>');

    try {
      const data = await send({ action: "siebelCreateActivity", srNumber: activityId });
      const status = actionsDiv.querySelector(".sbl-note-status");
      if (data.success) {
        status.textContent = "Opened in Siebel";
        status.style.color = "var(--success)";
      } else {
        status.textContent = data.error || "Failed";
        status.style.color = "var(--danger)";
      }
    } catch (err) {
      const status = actionsDiv.querySelector(".sbl-note-status");
      status.textContent = err.message;
      status.style.color = "var(--danger)";
    }
    setTimeout(() => {
      addNoteLink.style.display = "";
      const status = actionsDiv.querySelector(".sbl-note-status");
      if (status) status.remove();
    }, 3000);
    return;
  }

  const notePreview = e.target.closest(".sbl-note-preview");
  if (notePreview) {
    notePreview.classList.toggle("expanded");
    return;
  }

  const retryBtn = e.target.closest("#sbl-retry");
  if (retryBtn) {
    document.getElementById("btn-siebel-backlog").click();
    return;
  }
});
