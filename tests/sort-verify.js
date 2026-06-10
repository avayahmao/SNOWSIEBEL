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

console.log("\n=== Results: " + pass + " passed, " + fail + " failed ===");
process.exit(fail > 0 ? 1 : 0);
