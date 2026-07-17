const test = require("node:test");
const assert = require("node:assert/strict");

// note-fields.js is a UMD module — require() works directly.
const { TABLE_STATES, getStateConfig } = require("../chrome-extension/note-fields.js");

test("TABLE_STATES.incident.workStartState is '2'", () => {
  assert.equal(TABLE_STATES.incident.workStartState, "2");
});

test("TABLE_STATES.problem.workStartState is '102'", () => {
  assert.equal(TABLE_STATES.problem.workStartState, "102");
});

test("TABLE_STATES.change_request.workStartState is '-1'", () => {
  assert.equal(TABLE_STATES.change_request.workStartState, "-1");
});

test("TABLE_STATES.task.workStartState is '2'", () => {
  assert.equal(TABLE_STATES.task.workStartState, "2");
});

test("TABLE_STATES.change_task exists and has workStartState", () => {
  assert.ok(TABLE_STATES.change_task, "change_task entry must exist");
  assert.equal(TABLE_STATES.change_task.workStartState, "2");
});

test("getStateConfig falls back to incident for unknown table", () => {
  const cfg = getStateConfig("nonexistent_table");
  assert.equal(cfg, TABLE_STATES.incident);
});

test("getStateConfig returns the right entry for change_task", () => {
  const cfg = getStateConfig("change_task");
  assert.equal(cfg, TABLE_STATES.change_task);
});

test("TABLE_STATES.sc_request.workStartState is null (no in-progress state)", () => {
  assert.equal(TABLE_STATES.sc_request.workStartState, null);
});
