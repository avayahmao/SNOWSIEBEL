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

  return { buildCommentFields, TABLE_MAP, detectTable, displayVal };
});
