// Sort verification test
function displayVal(v) {
  if (v == null || v === "") return "";
  if (typeof v === "object") return v.display_value || v.value || "";
  return String(v);
}

function parsePriority(value) {
  const dv = displayVal(value);
  const m = dv.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}

const SBL_SEVERITY_RANK = { "OTG": 0, "SBI": 1, "BI": 2, "NBI": 3 };
function sblSeverityRank(name) {
  const key = (name || "").trim().toUpperCase();
  return SBL_SEVERITY_RANK[key] != null ? SBL_SEVERITY_RANK[key] : 99;
}

function staleDays(v) {
  const dv = displayVal(v);
  if (!dv) return 0;
  const d = new Date(dv);
  return isNaN(d.getTime()) ? 0 : Math.floor((Date.now() - d.getTime()) / 86400000);
}

// --- parsePriority tests ---
console.log("=== parsePriority ===");
const priTests = [
  ["1 - Critical", 1],
  ["2 - High", 2],
  ["3 - Moderate", 3],
  ["4 - Low", 4],
  [{ value: "2", display_value: "2 - High" }, 2],
  ["", 99],
  [null, 99],
];
let pass = 0, fail = 0;
for (const [input, expected] of priTests) {
  const got = parsePriority(input);
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(input), "=>", got, "(expected", expected + ")");
}

// --- sblSeverityRank tests ---
console.log("\n=== sblSeverityRank ===");
const sevTests = [
  ["OTG", 0], ["SBI", 1], ["BI", 2], ["NBI", 3],
  ["otg", 0], ["Sbi", 1],
  ["xyz", 99], ["", 99], [null, 99],
];
for (const [input, expected] of sevTests) {
  const got = sblSeverityRank(input);
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(input), "=>", got, "(expected", expected + ")");
}

// --- SNOW List sort integration ---
console.log("\n=== SNOW List Sort ===");
const tickets = [
  { num: "INC001", priority: "3 - Moderate", sys_updated_on: "2026-05-10" },
  { num: "INC002", priority: "1 - Critical", sys_updated_on: "2026-05-27" },
  { num: "INC003", priority: "1 - Critical", sys_updated_on: "2026-05-15" },
  { num: "INC004", priority: "2 - High",     sys_updated_on: "2026-05-20" },
  { num: "INC005", priority: "2 - High",     sys_updated_on: "2026-05-01" },
];
tickets.sort((a, b) => {
  const pa = parsePriority(a.priority), pb = parsePriority(b.priority);
  if (pa !== pb) return pa - pb;
  return staleDays(b.sys_updated_on) - staleDays(a.sys_updated_on);
});
const expectedSnow = ["INC003", "INC002", "INC005", "INC004", "INC001"];
const gotSnow = tickets.map(t => t.num);
const snowOk = JSON.stringify(gotSnow) === JSON.stringify(expectedSnow);
if (snowOk) pass++; else fail++;
console.log(snowOk ? "PASS" : "FAIL", "order:", gotSnow.join(" > "));
tickets.forEach(t => console.log("  ", t.num, t.priority, "stale:", staleDays(t.sys_updated_on) + "d"));

// --- Siebel Backlog sort integration ---
console.log("\n=== Siebel Backlog Sort ===");
const now = Math.floor(Date.now() / 1000);
const items = [
  { num: "SR001", sev: "NBI", updated_time: String(now - 86400 * 3) },
  { num: "SR002", sev: "OTG", updated_time: String(now - 86400 * 1) },
  { num: "SR003", sev: "OTG", updated_time: String(now - 86400 * 10) },
  { num: "SR004", sev: "SBI", updated_time: String(now - 86400 * 5) },
  { num: "SR005", sev: "BI",  updated_time: String(now - 86400 * 20) },
];
items.sort((a, b) => {
  const sa = sblSeverityRank(a.sev), sb = sblSeverityRank(b.sev);
  if (sa !== sb) return sa - sb;
  return (parseInt(a.updated_time) || 0) - (parseInt(b.updated_time) || 0);
});
const expectedSbl = ["SR003", "SR002", "SR004", "SR005", "SR001"];
const gotSbl = items.map(i => i.num);
const sblOk = JSON.stringify(gotSbl) === JSON.stringify(expectedSbl);
if (sblOk) pass++; else fail++;
console.log(sblOk ? "PASS" : "FAIL", "order:", gotSbl.join(" > "));
items.forEach(i => {
  const days = Math.floor((now - parseInt(i.updated_time)) / 86400);
  console.log("  ", i.num, i.sev, "stale:", days + "d");
});

// --- Local copies of helpers used by compareTickets (test is self-contained) ---
// displayVal/parsePriority/staleDays already defined above (lines 2-25).
function parseUpdatedOn(value) {
  const dv = displayVal(value);
  if (!dv) return null;
  const d = new Date(dv);
  return isNaN(d.getTime()) ? null : d;
}
// valueVal: like displayVal but prefers .value. For state, display_value is a
// localized label ("New") and the numeric code lives in .value — displayVal()
// would parseInt("New")→NaN→0. (Caught by the compareTickets characterization test.)
function valueVal(v) {
  if (v == null || v === "") return "";
  if (typeof v === "object") return v.value || v.display_value || "";
  return String(v);
}
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
// id-desc tiebreak helper (used by updated/created) — byte-identical to panel.js copy
function cmpIdDesc(a, b) {
  const ma = (displayVal(a.number) || "").match(/(\d+)$/);
  const mb = (displayVal(b.number) || "").match(/(\d+)$/);
  const na = ma ? parseInt(ma[1], 10) : 0;
  const nb = mb ? parseInt(mb[1], 10) : 0;
  return nb - na;
}

// --- compareTickets tests ---
console.log("\n=== compareTickets ===");
const ctTickets = [
  { number: "INC0010", priority: "3 - Moderate", sys_updated_on: "2026-05-10", sys_created_on: "2026-04-01", state: { value: "1", display_value: "New" } },
  { number: "INC0002", priority: "1 - Critical", sys_updated_on: "2026-05-27", sys_created_on: "2026-05-20", state: { value: "2", display_value: "In Progress" } },
  { number: "INC0007", priority: "1 - Critical", sys_updated_on: "2026-05-15", sys_created_on: "2026-05-01", state: { value: "7", display_value: "Closed" } },
];
function sortedNums(key, dir) {
  return ctTickets.slice().sort((a, b) => compareTickets(a, b, key, dir)).map(t => displayVal(t.number));
}
const ctCases = [
  ["id asc",      ["INC0002", "INC0007", "INC0010"], sortedNums("id", "asc")],
  ["id desc",     ["INC0010", "INC0007", "INC0002"], sortedNums("id", "desc")],
  ["priority asc (P1s first, INC0002 newer-stale than INC0007)", ["INC0007", "INC0002", "INC0010"], sortedNums("priority", "asc")],
  ["priority desc", ["INC0010", "INC0007", "INC0002"], sortedNums("priority", "desc")],
  ["stale asc (INC0002 least stale)", ["INC0002", "INC0007", "INC0010"], sortedNums("stale", "asc")],
  ["stale desc (INC0010 stalest)", ["INC0010", "INC0007", "INC0002"], sortedNums("stale", "desc")],
  ["updated asc (oldest first)", ["INC0010", "INC0007", "INC0002"], sortedNums("updated", "asc")],
  ["updated desc (newest first)", ["INC0002", "INC0007", "INC0010"], sortedNums("updated", "desc")],
  ["created asc (oldest first)", ["INC0010", "INC0007", "INC0002"], sortedNums("created", "asc")],
  ["created desc (newest first)", ["INC0002", "INC0007", "INC0010"], sortedNums("created", "desc")],
  ["state asc (1 before 2 before 7)", ["INC0010", "INC0002", "INC0007"], sortedNums("state", "asc")],
  ["state desc", ["INC0007", "INC0002", "INC0010"], sortedNums("state", "desc")],
];
for (const [label, expected, got] of ctCases) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(ok ? "PASS" : "FAIL", label, "=>", got.join(", "), ok ? "" : "(expected " + expected.join(", ") + ")");
}

console.log("\n=== Results: " + pass + " passed, " + fail + " failed ===");
process.exit(fail > 0 ? 1 : 0);
