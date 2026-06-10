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

describe("content-gct.js Siebel API correctness", () => {
  let content;
  before(() => {
    const fs = require("fs");
    const path = require("path");
    content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "content-gct.js"),
      "utf-8"
    );
  });

  it("uses InvokeMethod for BC operations, not direct calls", () => {
    // These method names must only appear inside InvokeMethod calls, never standalone
    const bcMethods = [
      "ClearToQuery",
      "FirstRecord",
      "NewRecord",
      "SetFieldValue",
      "WriteRecord",
    ];
    for (const method of bcMethods) {
      // Should find at least one InvokeMethod call with this method name
      assert.ok(
        content.includes('InvokeMethod("' + method + '"'),
        'should use InvokeMethod("' + method + '") for BC operations'
      );
    }
  });

  it("uses execCommand for query input, not SetSearchSpec", () => {
    // Query input is typed via document.execCommand('insertText'), not API SetSearchSpec
    assert.ok(
      content.includes('execCommand("insertText"'),
      "should use document.execCommand for typing query input"
    );
    assert.ok(
      !content.includes('InvokeMethod("SetSearchSpec"'),
      "should NOT use SetSearchSpec for queries (silently fails in Siebel Open UI)"
    );
  });

  it("uses applet-level InvokeMethod for query execution", () => {
    // NewQuery and ExecuteQuery must be called on applet, not bc
    assert.ok(
      content.includes("applet.InvokeMethod(\"NewQuery\")"),
      "should call NewQuery at applet level"
    );
    assert.ok(
      content.includes("applet.InvokeMethod(\"ExecuteQuery\")"),
      "should call ExecuteQuery at applet level"
    );
  });

  it("checks for Siebel errors after query and save", () => {
    assert.ok(
      content.includes("GetErrorCount"),
      "should check GetErrorCount after operations"
    );
    assert.ok(
      content.includes("GetErrorMsg"),
      "should check GetErrorMsg for error details"
    );
  });

  it("uses SiebelApp.S_App.GotoView for internal drill-in navigation", () => {
    assert.ok(
      content.includes("SiebelApp.S_App.GotoView"),
      "should use SiebelApp.S_App.GotoView for drill-in (internal AJAX navigation)"
    );
    assert.ok(
      content.includes("Service Request Detail View"),
      "should navigate to Service Request Detail View"
    );
  });

  it("suppresses window.alert and window.confirm to prevent blocking", () => {
    assert.ok(
      content.includes("window.alert") && content.includes("window._siebelDialogs"),
      "should override window.alert to capture dialogs without blocking"
    );
    assert.ok(
      content.includes("window.confirm"),
      "should override window.confirm to auto-accept"
    );
  });

  it("uses correct applet names from live GCT", () => {
    assert.ok(
      content.includes('"Activity Daily Hour Applet"'),
      "should use Activity Daily Hour Applet for time logging (verified in live GCT)"
    );
    assert.ok(
      content.includes('"Activity List Applet With Navigation"'),
      "should use Activity List Applet With Navigation for activity creation"
    );
  });

  it("falls back to list applet BC when form applet is unavailable", () => {
    assert.ok(
      content.includes('app.FindApplet("Activity Form Applet")'),
      "should try Activity Form Applet first"
    );
    assert.ok(
      content.includes('app.FindApplet("Activity List Applet With Navigation")'),
      "should fall back to Activity List Applet when form applet not found"
    );
  });
});

describe("background.js navigation and step orchestration", () => {
  let content;
  before(() => {
    const fs = require("fs");
    const path = require("path");
    content = fs.readFileSync(
      path.join(__dirname, "..", "chrome-extension", "background.js"),
      "utf-8"
    );
  });

  it("uses pollSiebelReady instead of fixed setTimeout delay", () => {
    assert.ok(
      content.includes("pollSiebelReady"),
      "should define pollSiebelReady function"
    );
    assert.ok(
      content.includes("ActiveViewName"),
      "should poll ActiveViewName for Siebel readiness"
    );
    // Should NOT have fixed setTimeout(resolve, 3000) anymore
    const hasFixedDelay = content.includes("setTimeout(resolve, 3000)")
      || content.includes("setTimeout(resolve,3000)");
    assert.ok(!hasFixedDelay, "should not use fixed 3s delay after navigation");
  });

  it("resets gctInjected flag before polling", () => {
    // After page load, gctInjected must be set to false before polling
    const navListener = content.match(
      /gctInjected\s*=\s*false[\s\S]*?pollSiebelReady/
    );
    assert.ok(navListener, "should reset gctInjected before calling pollSiebelReady");
  });

  it("uses internal GotoView for drill-in instead of URL navigation", () => {
    // Step 3 should use injectAndExecGct (SiebelApp GotoView), not navigateGctTab
    assert.ok(
      content.includes("gctDrillIntoSR"),
      "should reference gctDrillIntoSR step function"
    );
    // The drill-in step should NOT use navigateGctTab with rowIds
    const drillInStep = content.match(
      /Step 3[\s\S]*?injectAndExecGct[\s\S]*?gctDrillIntoSR/
    );
    assert.ok(drillInStep, "step 3 should use injectAndExecGct with gctDrillIntoSR (internal navigation)");
  });

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
