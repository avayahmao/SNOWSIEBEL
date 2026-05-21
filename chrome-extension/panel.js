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

const STATE_LABELS = { "-5": "Pending", 1: "New", 2: "In Progress", 3: "Awaiting Problem", 4: "Service Restored", 5: "Assigned", 6: "Resolved", 7: "Closed", 8: "Cancelled" };
const STATE_CLASS = { "-5": "state-active", 1: "state-new", 2: "state-active", 3: "state-active", 4: "state-resolved", 5: "state-active", 6: "state-resolved", 7: "state-closed", 8: "state-closed" };

function displayVal(value) {
  if (value == null || value === "") return "";
  if (typeof value === "object") {
    const dv = value.display_value;
    if (dv != null && dv !== "") return displayVal(dv);
    const v = value.value;
    if (v != null && v !== "") return displayVal(v);
    return "";
  }
  return String(value);
}

function stateBadge(state) {
  const dv = displayVal(state);
  const key = (typeof state === "object" ? state.value : state) || "";
  const label = dv || STATE_LABELS[key] || key;
  const cls = STATE_CLASS[key] || "state-new";
  return `<span class="state-badge ${cls}">${esc(label)}</span>`;
}

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatField(label, value) {
  const dv = displayVal(value);
  if (!dv) return "";
  return `<div class="ticket-field"><b>${esc(label)}:</b> ${esc(dv)}</div>`;
}

function showLoading(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';
}

function showError(el, msg) {
  el.innerHTML = `<div class="error">${esc(msg)}</div>`;
}

// Delegated event handler for links (avoids inline onclick which CSP blocks)
document.addEventListener("click", (e) => {
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
  if (e.target.classList.contains("jump-link")) {
    e.preventDefault();
    const target = e.target.dataset.target;
    const ticket = e.target.dataset.ticket;
    if (target === "comment") {
      document.getElementById("comment-number").value = ticket;
      switchTab("comment");
    } else if (target === "action") {
      document.getElementById("action-number").value = ticket;
      switchTab("action");
      refreshActionState(ticket);
    }
  }
});

// --- Query ---
const queryResult = document.getElementById("result");

document.getElementById("btn-query").addEventListener("click", async () => {
  const number = document.getElementById("query-number").value.trim();
  if (!number) return;
  showLoading(queryResult);
  try {
    const ticket = await send({ action: "getTicket", ticketNumber: number, includeJournal: true });
    if (!ticket) {
      queryResult.innerHTML = `<div class="error">Ticket ${esc(number)} not found</div>`;
      return;
    }
    let html = `<div class="ticket-card">`;
    html += `<div class="ticket-num">${esc(displayVal(ticket.number) || number)}</div>`;
    const qSubcls = displayVal(ticket.contact_type);
    if (qSubcls === "Alarm") html += `<span style="display:inline-block;background:#ede7f6;color:#4527a0;padding:1px 7px;border-radius:3px;font-size:10px;font-weight:600;margin:2px 0 3px">Alarm</span>`;
    html += formatField("Description", ticket.short_description);
    const stateRaw = typeof ticket.state === "object" ? ticket.state.value : ticket.state;
    html += `<div class="ticket-field"><b>State:</b> ${stateBadge(ticket.state)} <span style="color:#999;font-size:10px">(${esc(stateRaw)})</span></div>`;
    html += formatField("Priority", ticket.priority);
    html += formatField("Assigned to", ticket.assigned_to);
    html += formatField("Assignment group", ticket.assignment_group);
    html += formatField("Updated", ticket.sys_updated_on);
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
    // Journal entries (work notes + comments)
    const journal = ticket._journal;
    if (journal && journal.length > 0) {
      html += `<div class="ticket-field" style="margin-top:6px"><b>Activity:</b></div>`;
      for (const entry of journal) {
        const isWorkNote = displayVal(entry.element) === "work_notes";
        const author = displayVal(entry.sys_created_by) || displayVal(entry.sys_created_by);
        const created = displayVal(entry.sys_created_on);
        const value = displayVal(entry.value) || "";
        const badge = isWorkNote
          ? '<span style="background:#fff3e0;color:#e65100;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600">Work Note</span>'
          : '<span style="background:#e3f2fd;color:#1565c0;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600">Comment</span>';
        html += `<div style="margin-top:4px;padding:4px 6px;background:#fafafa;border-left:3px solid ${isWorkNote ? '#e65100' : '#1565c0'};font-size:11px">`;
        html += `<div style="margin-bottom:2px">${badge} <span style="color:#999">${esc(created)} - ${esc(author)}</span></div>`;
        html += `<div style="color:#333;white-space:pre-wrap">${esc(value)}</div>`;
        html += `</div>`;
      }
    }
    html += `</div>`;
    // Jump links for query results
    html += `<div style="margin-top:4px;font-size:11px">`;
    html += `<a class="jump-link" data-target="comment" data-ticket="${esc(displayVal(ticket.number) || number)}" style="color:#293e6b;cursor:pointer;margin-right:12px">+ Add Note</a>`;
    html += `<a class="jump-link" data-target="action" data-ticket="${esc(displayVal(ticket.number) || number)}" style="color:#293e6b;cursor:pointer">Update Status</a>`;
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
  "my-updated": "assigned_to=javascript:gs.getUserID()^ORDERBYDESCsys_updated_on",
  "my-resolved": "assigned_to=javascript:gs.getUserID()^state=7^resolved_onONLast 7 days@javascript:gs.daysAgoStart(7)@javascript:gs.daysAgoEnd(0)",
  "group-open": "active=true^assignment_group=javascript:gs.getUser().getMyGroups()",
  "p1-p2": "active=true^priorityIN1,2",
  "all-open": "active=true^ORDERBYDESCsys_updated_on",
  "updated-today": "sys_updated_onONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^ORDERBYDESCsys_updated_on",
  "created-today": "sys_created_onONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)^ORDERBYDESCsys_created_on",
  "awaiting": "state=4^assigned_to=javascript:gs.getUserID()",
};

document.getElementById("list-preset").addEventListener("change", (e) => {
  const preset = e.target.value;
  if (preset && PRESETS[preset]) {
    document.getElementById("list-query").value = PRESETS[preset];
  }
});

document.getElementById("btn-list").addEventListener("click", async () => {
  const table = document.getElementById("list-table").value;
  const query = document.getElementById("list-query").value.trim();
  const limit = parseInt(document.getElementById("list-limit").value) || 10;
  showLoading(listResult);
  try {
    const tickets = await send({ action: "listTickets", table, query, limit });
    if (!tickets.length) {
      listResult.innerHTML = '<div class="ticket-field" style="padding:8px">No tickets found</div>';
      return;
    }
    let html = "";
    for (const t of tickets) {
      html += `<div class="ticket-card">`;
      html += `<div class="ticket-num">${esc(displayVal(t.number))}</div>`;
      const subcls = displayVal(t.contact_type);
      if (subcls === "Alarm") html += `<span style="display:inline-block;background:#ede7f6;color:#4527a0;padding:1px 7px;border-radius:3px;font-size:10px;font-weight:600;margin:2px 0 3px">Alarm</span>`;
      html += formatField("Description", t.short_description);
      const stateRaw = typeof t.state === "object" ? t.state.value : t.state;
      html += `<div class="ticket-field"><b>State:</b> ${stateBadge(t.state)} <span style="color:#999;font-size:10px">(${esc(stateRaw)})</span></div>`;
      html += formatField("Priority", t.priority);
      html += formatField("Assigned to", t.assigned_to);
      html += formatField("Updated", t.sys_updated_on);
      html += `<div style="margin-top:4px;font-size:11px">`;
      html += `<a class="jump-link" data-target="comment" data-ticket="${esc(displayVal(t.number))}" style="color:#293e6b;cursor:pointer;margin-right:12px">+ Add Note</a>`;
      html += `<a class="jump-link" data-target="action" data-ticket="${esc(displayVal(t.number))}" style="color:#293e6b;cursor:pointer">Update Status</a>`;
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
        msg += '<div style="color:#e65100;font-size:11px;margin-top:4px">Time worked error: ' + esc(data.timeResult.error) + '</div>';
      } else {
        var hrs = Math.floor(effortMinutes / 60);
        var mins = effortMinutes % 60;
        var timeStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + ' minutes';
        msg += '<div style="font-size:11px;margin-top:4px;color:#2e7d32">Effort: ' + esc(timeStr) + ' recorded</div>';
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

const STATUS_REASONS = {
  "2": ["-- None --", "Escalation to Product House", "Dispatch", "Escalated to Vendor/Partner"],
  "-5": ["Additional Information from Client", "Approval from Client to Proceed", "Awaiting Change Request", "Client Action Required", "Client Hold", "Manager Intervention", "Remote Access to Equipment", "Success Confirmation from Client", "Support Contact Hold", "Third Party Vendor Action Required"],
  "4": ["-- None --"],
  "6": ["-- None --", "Customer or Third Party Action", "Repaired", "Replaced", "Patch / Upgrade", "Alarm(s) Cleared on Access", "Change Request"],
  "7": ["-- None --", "Repaired", "Replaced", "Patch / Upgrade", "Customer or Third Party Action", "Alarm(s) Cleared on Access", "Change Request"],
  "8": ["-- None --", "Customer/Location Inactive", "Duplicate Incident", "Ignore Alarm", "Test Alarm", "Customer Cancelled", "Created Change Request Instead", "Ticket Created in Error", "No Longer Required"],
};

// Allowed state transitions
const ALLOWED_TRANSITIONS = {
  "1": ["2", "5"],           // New → In Progress, Assigned
  "2": ["-5", "4", "6", "8"], // In Progress → Pending, Service Restored, Resolved, Cancelled
  "-5": ["2", "4", "6", "8"], // Pending → In Progress, Service Restored, Resolved, Cancelled
  "4": ["2", "-5", "6", "8"], // Service Restored → In Progress, Pending, Resolved, Cancelled
  "5": ["2", "-5", "4", "6", "8"], // Assigned → In Progress, Pending, Service Restored, Resolved, Cancelled
};

var currentTicketState = null;

// Fetch current ticket state and update allowed transitions
async function refreshActionState(number) {
  if (!number) return;
  try {
    var ticket = await send({ action: "getTicket", ticketNumber: number });
    if (!ticket) { currentTicketState = null; return; }
    var raw = typeof ticket.state === "object" ? ticket.state.value : ticket.state;
    currentTicketState = String(raw);
    // Update state dropdown to only show allowed transitions
    var allowed = ALLOWED_TRANSITIONS[currentTicketState] || [];
    var options = actionState.querySelectorAll("option");
    for (var i = 0; i < options.length; i++) {
      var val = options[i].value;
      if (!val) {
        options[i].disabled = false;
        continue;
      }
      options[i].disabled = allowed.length > 0 && allowed.indexOf(val) < 0;
      options[i].style.display = allowed.length > 0 && allowed.indexOf(val) < 0 ? "none" : "";
    }
    // Show current state info
    var stateLabel = STATE_LABELS[currentTicketState] || currentTicketState;
    actionResult.innerHTML = '<div style="color:#666;font-size:11px">Current state: ' + esc(stateLabel) + '</div>';
  } catch (e) {
    currentTicketState = null;
  }
}

document.getElementById("action-number").addEventListener("change", function() {
  refreshActionState(this.value.trim());
});
document.getElementById("action-number").addEventListener("keydown", function(e) {
  if (e.key === "Enter") refreshActionState(this.value.trim());
});

actionState.addEventListener("change", function() {
  // Show/hide follow-up date for Pending
  actionFollowupGroup.style.display = actionState.value === "-5" ? "" : "none";
  // Update status reason options based on state
  actionStatusReason.innerHTML = "";
  var reasons = STATUS_REASONS[actionState.value] || [];
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
      effortMinutes = effortUnit === "hours" ? Math.round(val * 60) : Math.round(val);
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

// --- Auto-load My Open Tickets on startup (List is default tab) ---
listAutoLoaded = true;
document.getElementById("list-preset").value = "my-open";
document.getElementById("list-query").value = PRESETS["my-open"];
document.getElementById("btn-list").click();
