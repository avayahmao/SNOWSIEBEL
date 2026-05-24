// content-gct.js — Siebel CRM DOM automation
// Injected into GCT tab's MAIN world by background.js

(function () {
  "use strict";

  // --- Frame navigation ---
  // Siebel uses nested frames. Navigate to the content frame.
  function getSiebelDoc() {
    // Try _sweclient frame first (most common)
    var frames = document.querySelectorAll('frame[name="_sweclient"], iframe[name="_sweclient"]');
    for (var i = 0; i < frames.length; i++) {
      try {
        var doc = frames[i].contentDocument || frames[i].contentWindow.document;
        if (doc && doc.body) return doc;
      } catch (e) { /* cross-origin, skip */ }
    }
    // Fallback: search all frames for Siebel content
    var allFrames = document.querySelectorAll("frame, iframe");
    for (var j = 0; j < allFrames.length; j++) {
      try {
        var d = allFrames[j].contentDocument || allFrames[j].contentWindow.document;
        if (d && d.querySelector('[id*="s_"]')) return d;
      } catch (e) { /* skip */ }
    }
    return document;
  }

  // --- Wait helper ---
  function waitFor(testFn, timeout) {
    timeout = timeout || 30000;
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      function poll() {
        try {
          var result = testFn();
          if (result) return resolve(result);
        } catch (e) { /* keep polling */ }
        if (Date.now() - start > timeout) {
          return reject(new Error("Timeout waiting for element after " + (timeout / 1000) + "s"));
        }
        setTimeout(poll, 500);
      }
      poll();
    });
  }

  // --- Click helper with wait ---
  function clickAndPause(el) {
    if (!el) throw new Error("Element not found");
    el.click();
    return new Promise(function (resolve) { setTimeout(resolve, 1500); });
  }

  // --- Find button/link by visible text ---
  function findByText(doc, text, tag) {
    if (!doc) doc = getSiebelDoc();
    var els = doc.querySelectorAll(tag || "a, button, span, div");
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || "").trim();
      if (t === text || t.indexOf(text) === 0) return els[i];
    }
    return null;
  }

  // Exports
  window._siebel = {

    // Step 1: Navigate to Service → All Service Requests
    navigateToServiceRequests: function () {
      var doc = getSiebelDoc();

      // Click "Service" in the navigation bar (top-level tab)
      return waitFor(function () {
        return findByText(doc, "Service");
      }).then(function (serviceTab) {
        return clickAndPause(serviceTab);
      }).then(function () {
        // Click "All Service Requests" link
        return waitFor(function () {
          return findByText(getSiebelDoc(), "All Service Requests");
        });
      }).then(function (link) {
        return clickAndPause(link);
      }).then(function () {
        // Wait for SR List Applet to load
        return waitFor(function () {
          var d = getSiebelDoc();
          return d.querySelector('[id*="Service_Request"]') || findByText(d, "SR #") || findByText(d, "Service Request #");
        });
      });
    },

    // Step 2: Query SR number
    querySR: function (srNumber) {
      var doc = getSiebelDoc();

      // Click "Query" button to enter query mode
      return waitFor(function () {
        var menuBtn = findByText(doc, "Query") || doc.querySelector('a[title*="Query"], button[title*="Query"]');
        return menuBtn;
      }).then(function (queryBtn) {
        return clickAndPause(queryBtn);
      }).then(function () {
        // Find SR# field in the list applet
        return waitFor(function () {
          var d = getSiebelDoc();
          var srField = d.querySelector('input[id*="SR"], input[id*="s_"]') ||
                        findByText(d, "SR #");
          return srField;
        });
      }).then(function (srField) {
        // If it's a readonly textbox in a grid, click the parent cell first
        if (srField.readOnly || srField.tagName === "SPAN") {
          var cell = srField.closest("td, div[role='gridcell']");
          if (cell) cell.click();
          // Now find the actual input that appears
          return waitFor(function () {
            var d = getSiebelDoc();
            return d.querySelector('input:not([readonly])[id*="s_"]') ||
                   d.querySelector('input[type="text"]:not([readonly])');
          });
        }
        return srField;
      }).then(function (input) {
        // Clear and enter SR number
        input.value = "";
        input.value = srNumber;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }).then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 500); });
      }).then(function () {
        var d = getSiebelDoc();
        var goBtn = findByText(d, "Go") || d.querySelector('a[id*="go"], button[id*="go"]');
        if (goBtn) {
          return clickAndPause(goBtn);
        }
        // If no Go button, try keyboard Enter
        d.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return new Promise(function (resolve) { setTimeout(resolve, 2000); });
      });
    },

    // Step 3: Drill into SR
    drillIntoSR: function () {
      return waitFor(function () {
        var doc = getSiebelDoc();
        // SR hyperlink in the first data row
        var links = doc.querySelectorAll("a");
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute("href") || "";
          var text = (links[i].textContent || "").trim();
          if (text.match(/^\d+-\d+/) || href.indexOf("SR") > -1) {
            return links[i];
          }
        }
        // Fallback: first cell in first data row matching SR pattern
        var cells = doc.querySelectorAll("td[role='gridcell'], div[role='gridcell']");
        for (var j = 0; j < cells.length; j++) {
          var cellText = (cells[j].textContent || "").trim();
          if (cellText.match(/^\d+-\d+/)) {
            return cells[j];
          }
        }
        return null;
      }).then(function (link) {
        if (!link) throw new Error("SR hyperlink not found in results");
        return clickAndPause(link);
      }).then(function () {
        return waitFor(function () {
          var d = getSiebelDoc();
          return findByText(d, "Activities") || findByText(d, "Service Request") ||
                 d.querySelector('[id*="Activity"]');
        });
      });
    },

    // Step 4: Navigate to Activities tab
    navigateActivities: function () {
      return waitFor(function () {
        return findByText(getSiebelDoc(), "Activities");
      }).then(function (tab) {
        return clickAndPause(tab);
      }).then(function () {
        return waitFor(function () {
          var d = getSiebelDoc();
          return findByText(d, "Activity") || d.querySelector('[id*="Activity"]');
        });
      });
    },

    // Step 5: Click "New" in Activity List Applet
    createNewActivity: function () {
      return waitFor(function () {
        var doc = getSiebelDoc();
        var buttons = doc.querySelectorAll("a, button, input[type='button']");
        for (var i = 0; i < buttons.length; i++) {
          var text = (buttons[i].textContent || buttons[i].value || "").trim();
          if (text === "New") return buttons[i];
        }
        return null;
      }).then(function (newBtn) {
        if (!newBtn) throw new Error("New Activity button not found");
        return clickAndPause(newBtn);
      });
    },

    // Step 6: Fill the activity form
    fillActivityForm: function (params) {
      function getFormDoc() {
        return getSiebelDoc();
      }

      function setSelectByText(doc, text) {
        var selects = doc.querySelectorAll("select");
        for (var i = 0; i < selects.length; i++) {
          var opts = selects[i].options;
          for (var j = 0; j < opts.length; j++) {
            if (opts[j].text.trim() === text || opts[j].text.trim().indexOf(text) === 0) {
              selects[i].value = opts[j].value;
              selects[i].dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      }

      function setTextarea(doc, text) {
        var textareas = doc.querySelectorAll("textarea");
        for (var i = 0; i < textareas.length; i++) {
          if (textareas[i].offsetParent !== null) {
            textareas[i].value = text;
            textareas[i].dispatchEvent(new Event("input", { bubbles: true }));
            textareas[i].dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        var editables = doc.querySelectorAll('[contenteditable="true"]');
        for (var j = 0; j < editables.length; j++) {
          editables[j].textContent = text;
          return true;
        }
        return false;
      }

      return waitFor(function () {
        var d = getFormDoc();
        return d.querySelector("textarea, select, input") ? d : null;
      }).then(function (doc) {
        if (params.type) setSelectByText(doc, params.type);
        if (params.status) setSelectByText(doc, params.status);
        if (params.comments) setTextarea(doc, params.comments);
        return new Promise(function (resolve) { setTimeout(resolve, 500); });
      });
    },

    // Step 7: Log time in Time List Applet
    logTime: function (minutes) {
      function findTimeNewBtn(doc) {
        var buttons = doc.querySelectorAll("a, button, input[type='button']");
        var found = [];
        for (var i = 0; i < buttons.length; i++) {
          if ((buttons[i].textContent || buttons[i].value || "").trim() === "New") {
            found.push(buttons[i]);
          }
        }
        return found.length >= 2 ? found[1] : found[0] || null;
      }

      return new Promise(function (resolve) { setTimeout(resolve, 500); })
        .then(function () {
          var doc = getSiebelDoc();
          var timeNewBtn = findTimeNewBtn(doc);
          if (!timeNewBtn) throw new Error("Time applet New button not found");
          return clickAndPause(timeNewBtn);
        }).then(function () {
          return waitFor(function () {
            var doc = getSiebelDoc();
            var labels = doc.querySelectorAll("span, label, td");
            for (var i = 0; i < labels.length; i++) {
              if ((labels[i].textContent || "").trim() === "Minutes") {
                var row = labels[i].closest("tr, div");
                if (row) {
                  var calcField = row.querySelector('input[type="text"], span[id*="Minutes"]');
                  if (calcField) return calcField;
                }
              }
            }
            return doc.querySelector('input[type="text"]:not([readonly])');
          });
        }).then(function (minutesField) {
          if (!minutesField) throw new Error("Minutes field not found");
          minutesField.click();
          minutesField.focus();
          return new Promise(function (resolve) { setTimeout(resolve, 300); });
        }).then(function () {
          var doc = getSiebelDoc();
          var activeEl = doc.activeElement;
          if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
            activeEl.value = String(minutes);
            activeEl.dispatchEvent(new Event("input", { bubbles: true }));
            activeEl.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            throw new Error("Could not set minutes value — active element is not an input field");
          }
        });
    },

    // Step 8: Save (Ctrl+S)
    save: function () {
      return new Promise(function (resolve) { setTimeout(resolve, 500); })
        .then(function () {
          var doc = getSiebelDoc();
          var eventInit = { key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true };
          doc.dispatchEvent(new KeyboardEvent("keydown", eventInit));
          if (doc.body) {
            doc.body.dispatchEvent(new KeyboardEvent("keydown", eventInit));
          }
          return new Promise(function (resolve) { setTimeout(resolve, 3000); });
        }).then(function () {
          // Check for error dialogs after save
          var doc = getSiebelDoc();
          // Look for Siebel error/alert dialogs — avoid false positives on generic class names
          var errors = doc.querySelectorAll('[class*="siebel-error"], [class*="sieb-error"], [class*="SWEAlert"], [id*="s_evt"], [class*="jqierror"]');
          for (var i = 0; i < errors.length; i++) {
            if (errors[i].offsetParent !== null) {
              var errText = (errors[i].textContent || "").trim();
              if (errText) throw new Error("Save error: " + errText);
            }
          }
        });
    }
  };
})();
