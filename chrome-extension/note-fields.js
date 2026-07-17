(function(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.buildCommentFields = api.buildCommentFields;
    root.TABLE_MAP = api.TABLE_MAP;
    root.detectTable = api.detectTable;
    root.displayVal = api.displayVal;
    root.TABLE_STATES = api.TABLE_STATES;
    root.getStateConfig = api.getStateConfig;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {

  const TABLE_MAP = {
    INC: "incident", CHG: "change_request", TAS: "task",
    RIT: "sc_req_item", REQ: "sc_request", PRB: "problem",
    KB0: "kb_knowledge", STY: "rm_story", SCT: "sc_task",
  };

  function detectTable(ticketNumber) {
    const prefix = (ticketNumber || "").slice(0, 3).toUpperCase();
    return TABLE_MAP[prefix] || "incident";
  }

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

  function formatEffort(effortMinutes) {
    if (!effortMinutes) return null;

    const hours = Math.floor(effortMinutes / 60);
    const minutes = effortMinutes % 60;
    return "1970-01-01 " + String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0") + ":00";
  }

  function buildCommentFields(msg) {
    const isPublic = msg.visibility === "public";
    const fields = {};

    // All notes go through work_notes — comments field is ACL-restricted on this instance.
    // Visibility is controlled by u_wn_public + u_public_note / u_private_note.
    fields.work_notes = msg.comment;
    if (isPublic) {
      fields.u_public_note = msg.comment;
    } else {
      fields.u_private_note = msg.comment;
    }

    if (msg.noteType) fields.u_wn_type = msg.noteType;
    fields.u_wn_public = isPublic;

    const effort = formatEffort(msg.effortMinutes);
    if (effort) fields.u_wn_effort = effort;

    return fields;
  }

  // --- Per-table state configuration ---
  // Each key is a ServiceNow table name; entries define state labels, CSS classes,
  // selectable states, allowed transitions, status reasons, alarm chains, etc.
  //
  // workStartState is the state to set when a ticket is "taken" (started) — it's the
  // in-progress / implement state for each table and is consumed by background.js's
  // takeTicket flow. Mirrors the SNOW "Work in Progress" / "Implement" states.
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
      workStartState: "2",
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
      workStartState: "-1",
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
      workStartState: "102",
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
      workStartState: "2",
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
      workStartState: null,  // sc_request has no in-progress state (only -5 Pending, 4/5/6 Closed) — Take sends no state change
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
      workStartState: "2",
      pendingState: "-5",
      hasFollowUp: false,
    },
    // change_task mirrors task's state model (same labels/classes/transitions).
    // Verification against a live sys_choice probe for change_task is still pending —
    // if the probe reveals a divergence, update this block to match. The inline-error
    // fallback in the Take action surfaces any transition mismatch at runtime.
    change_task: {
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
      workStartState: "2",
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
      workStartState: "2",
      pendingState: "-5",
      hasFollowUp: false,
    },
  };

  function getStateConfig(table) {
    return TABLE_STATES[table] || TABLE_STATES.incident;
  }

  return { buildCommentFields, TABLE_MAP, detectTable, displayVal, TABLE_STATES, getStateConfig };
});
