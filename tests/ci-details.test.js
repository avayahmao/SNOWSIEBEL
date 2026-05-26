// tests/ci-details.test.js
// Unit tests for CI detail extraction fallback logic

const assert = require("assert");

// Simulate the displayVal helper from panel.js/background.js
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

// Simulate getCiDetailsInPage result construction
function extractCiDetails(result) {
  if (!result) return null;
  var name = displayVal(result.name) || "";
  var ip = displayVal(result.ip_address) || "";
  var seId = displayVal(result.u_se_id) || displayVal(result.serial_number) || displayVal(result.asset_tag) || "";
  return { ciName: name, seId: seId, ipAddress: ip };
}

describe("CI detail extraction", () => {
  it("extracts all fields when present", () => {
    const result = {
      name: { display_value: "Router-A", value: "router_a" },
      ip_address: { display_value: "192.168.1.1", value: "192.168.1.1" },
      u_se_id: { display_value: "SE-12345", value: "SE-12345" },
      serial_number: { display_value: "SN-999", value: "SN-999" },
      asset_tag: { display_value: "AT-001", value: "AT-001" },
    };
    const ci = extractCiDetails(result);
    assert.strictEqual(ci.ciName, "Router-A");
    assert.strictEqual(ci.seId, "SE-12345"); // u_se_id wins
    assert.strictEqual(ci.ipAddress, "192.168.1.1");
  });

  it("falls back to serial_number when u_se_id is missing", () => {
    const result = {
      name: "Switch-B",
      ip_address: "10.0.0.2",
      serial_number: "SN-888",
      asset_tag: "AT-002",
    };
    const ci = extractCiDetails(result);
    assert.strictEqual(ci.seId, "SN-888");
  });

  it("falls back to asset_tag when u_se_id and serial_number are missing", () => {
    const result = {
      name: "Firewall-C",
      ip_address: "172.16.0.1",
      asset_tag: "AT-003",
    };
    const ci = extractCiDetails(result);
    assert.strictEqual(ci.seId, "AT-003");
  });

  it("returns empty seId when all ID fields are missing", () => {
    const result = {
      name: "Server-D",
      ip_address: "10.1.1.1",
    };
    const ci = extractCiDetails(result);
    assert.strictEqual(ci.seId, "");
    assert.strictEqual(ci.ciName, "Server-D");
    assert.strictEqual(ci.ipAddress, "10.1.1.1");
  });

  it("handles null result", () => {
    const ci = extractCiDetails(null);
    assert.strictEqual(ci, null);
  });

  it("handles object display_value correctly", () => {
    const result = {
      name: { display_value: "AP-01", value: "ap_01" },
      u_se_id: "",
      serial_number: "",
      asset_tag: { display_value: "TAG-55", value: "tag55" },
    };
    const ci = extractCiDetails(result);
    assert.strictEqual(ci.seId, "TAG-55");
  });
});
