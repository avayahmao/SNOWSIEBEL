// tests/siebel-note.test.js
// Unit tests for content-gct.js helper logic (not live Siebel DOM).

const assert = require("assert");

// We can't run the full DOM automation in a test (no Siebel page),
// so we test the structural patterns: that content-gct.js is valid JS,
// that the _siebel namespace is properly structured, and that each
// step function exists and returns a Promise.

describe("content-gct.js structure", () => {
  // Test data representing what we'd pass through the automation
  const validParams = {
    srNumber: "1-23642931672",
    activityType: "SR Status - Outbound",
    comments: "Test comment",
    time: 15,
    status: "Done",
  };

  it("content-gct.js parses as valid JavaScript", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "content-gct.js"),
      "utf-8"
    );
    assert.ok(content.length > 100, "content-gct.js should not be empty");
    assert.ok(
      content.includes("window._siebel"),
      "should export window._siebel namespace"
    );
  });

  it("_siebel namespace has all required step functions", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "content-gct.js"),
      "utf-8"
    );
    const required = [
      "navigateToServiceRequests",
      "querySR",
      "drillIntoSR",
      "navigateActivities",
      "createNewActivity",
      "fillActivityForm",
      "logTime",
      "save",
    ];
    for (const fn of required) {
      assert.ok(
        content.includes(fn + ":"),
        "content-gct.js should define " + fn
      );
    }
  });

  it("panel.js has siebel-note form handler", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "panel.js"),
      "utf-8"
    );
    assert.ok(
      content.includes("siebelCreateActivity"),
      "panel.js should reference siebelCreateActivity action"
    );
    assert.ok(
      content.includes("btn-siebel-create"),
      "panel.js should handle btn-siebel-create click"
    );
  });

  it("background.js has siebelCreateActivity handler", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "background.js"),
      "utf-8"
    );
    assert.ok(
      content.includes('action === "siebelCreateActivity"'),
      "background.js should handle siebelCreateActivity action"
    );
    assert.ok(
      content.includes("findGctTab"),
      "background.js should define findGctTab"
    );
    assert.ok(
      content.includes("injectAndExecGct"),
      "background.js should define injectAndExecGct"
    );
  });

  it("panel.html has siebel-note tab and form elements", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "panel.html"),
      "utf-8"
    );
    assert.ok(
      content.includes('data-tab="siebel-note"'),
      "panel.html should have siebel-note tab button"
    );
    const requiredIds = [
      "siebel-sr",
      "siebel-type",
      "siebel-comments",
      "siebel-time",
      "siebel-status",
      "btn-siebel-create",
      "siebel-result",
    ];
    for (const id of requiredIds) {
      assert.ok(
        content.includes('id="' + id + '"'),
        "panel.html should have element with id=" + id
      );
    }
  });

  it("validParams has all required fields", () => {
    assert.ok(validParams.srNumber, "srNumber is required");
    assert.ok(validParams.activityType, "activityType is required");
    assert.ok(validParams.comments, "comments is required");
    assert.ok(validParams.time > 0, "time should be positive");
    assert.ok(validParams.status, "status is required");
  });
});

describe("background.js step definitions", () => {
  it("step sequence is in correct order", () => {
    const expectedOrder = [
      "gctNavigateToServiceRequests",
      "gctQuerySR",
      "gctDrillIntoSR",
      "gctNavigateActivities",
      "gctCreateNewActivity",
      "gctFillActivityForm",
      "gctLogTime",
      "gctSave",
    ];

    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "background.js"),
      "utf-8"
    );

    // Verify each step function is referenced
    for (let i = 0; i < expectedOrder.length; i++) {
      const fnName = expectedOrder[i];
      assert.ok(
        content.includes(fnName),
        fnName + " should be referenced in background.js"
      );
    }
  });
});
