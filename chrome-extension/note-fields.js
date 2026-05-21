(function(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.buildCommentFields = api.buildCommentFields;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
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

  return { buildCommentFields };
});
