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

const { resolveTable } = require("../chrome-extension/note-fields.js");

test("resolveTable prefers sys_class_name.value when present", () => {
  const t = { number: "TASK0010001", sys_class_name: { value: "change_task", display_value: "Change Task" } };
  assert.equal(resolveTable(t), "change_task");
});

test("resolveTable handles sys_class_name as a string", () => {
  const t = { number: "TASK0010001", sys_class_name: "change_task" };
  assert.equal(resolveTable(t), "change_task");
});

test("resolveTable falls back to detectTable(number) when sys_class_name absent", () => {
  const t = { number: "INC0010001" };
  assert.equal(resolveTable(t), "incident");
});

test("resolveTable falls back to detectTable when sys_class_name.value is empty", () => {
  const t = { number: "PRB0010001", sys_class_name: { value: "", display_value: "" } };
  assert.equal(resolveTable(t), "problem");
});

test("resolveTable handles null ticket gracefully (defaults to incident)", () => {
  assert.equal(resolveTable(null), "incident");
});

test("resolveTable handles undefined ticket gracefully", () => {
  assert.equal(resolveTable(undefined), "incident");
});
