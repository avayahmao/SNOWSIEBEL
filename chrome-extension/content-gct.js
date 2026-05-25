// content-gct.js — Siebel CRM Headless JS API automation
// Injected into GCT tab's MAIN world by background.js
//
// Uses ONLY Siebel's headless Business Component API:
//   - bc.SetFieldValue() / bc.GetFieldValue() for field operations
//   - bc.InvokeMethod("WriteRecord") for persistence
//   - applet.InvokeMethod("NewRecord") for record creation (BC-level silently fails)
//   - applet.InvokeMethod("NewQuery"/"ExecuteQuery") for queries
//   - SiebelApp.S_App.GotoView() for AJAX navigation
//
// Field setting: PM API (LeaveField) primary, BC SetFieldValue fallback.
//   PM triggers Siebel's full event pipeline; BC bypasses it.
// Query: DOM execCommand for SR # input (GCT PR ignores SetFieldValue in query mode).
// No DOM for field setting. No OnCtrlBlur.

(function () {
  "use strict";

  // --- Dialog suppression ---
  // Siebel business rules fire window.alert() during page load (e.g.,
  // "Account Critical Notes"). These block Siebel's async JS initialization,
  // causing SBL-UIF-00335 errors. Override alert/confirm to capture messages
  // without blocking. Installed once at injection time, persists for the
  // entire workflow since subsequent navigation is AJAX-based (no page reload).
  window._siebelDialogs = [];
  window.alert = function (msg) {
    window._siebelDialogs.push({ type: "alert", message: String(msg), time: Date.now() });
  };
  window.confirm = function (msg) {
    window._siebelDialogs.push({ type: "confirm", message: String(msg), time: Date.now() });
    return true;
  };

  // --- Helpers ---

  function getApp() {
    var app = theApplication();
    if (!app) throw new Error("Siebel application not available");
    return app;
  }

  function getSiebelApp() {
    if (typeof SiebelApp === "undefined" || !SiebelApp.S_App) {
      throw new Error("SiebelApp.S_App not available");
    }
    return SiebelApp.S_App;
  }

  // Generic applet finder — tries an array of known names, returns first match
  function findApplet(names) {
    var app = getApp();
    for (var i = 0; i < names.length; i++) {
      var applet = app.FindApplet(names[i]);
      if (applet) return applet;
    }
    return null;
  }

  function findActivitiesApplet() {
    return findApplet([
      "Activity List Applet With Navigation",
      "Activities List Applet",
      "Activity List Applet"
    ]);
  }

  // Find the activity form/note applet.
  // On Avaya GCT, the custom applet is "AVAYA SR Activity Note" (not the
  // standard Siebel "Activity - ... Form Applet" pattern).
  // Must use view.GetAppletMap() — theApplication().FindApplet() doesn't find it.
  function findFormApplet() {
    try {
      var view = getSiebelApp().GetActiveView();
      var appletMap = view.GetAppletMap();
      // Try Avaya custom applet (dynamic name: "AVAYA SR Activity ...")
      for (var key in appletMap) {
        if (/^AVAYA SR Activity/.test(key)) return appletMap[key];
      }
      // Fallback: standard Siebel form applet pattern
      for (var key2 in appletMap) {
        if (/Activity - .* Form Applet/.test(key2)) return appletMap[key2];
      }
    } catch (e) { /* view or appletMap not available */ }
    var app = getApp();
    return app.FindApplet("Activity Form Applet") || null;
  }

  function findTimeApplet() {
    return findApplet([
      "Activity Daily Hour Applet",
      "Time List Applet",
      "Action Time Applet"
    ]);
  }

  // Centralized Siebel error check — throws if errors exist
  function checkErrors(app, operationName) {
    if (app.GetErrorCount() > 0) {
      var errText = app.GetErrorMsg(0) || "Unknown Siebel error";
      throw new Error(operationName + ": " + errText);
    }
  }

  // Get BC from applet with validation
  function getBusComp(applet, label) {
    var bc = applet.BusComp();
    if (!bc) throw new Error("Could not access " + (label || "business component"));
    return bc;
  }

  // Safe SetFieldValue — returns true if set succeeded, false otherwise
  function safeSetField(bc, fieldName, value) {
    try {
      bc.SetFieldValue(fieldName, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Safe GetFieldValue — returns value or empty string
  function safeGetField(bc, fieldName) {
    try {
      return bc.GetFieldValue(fieldName);
    } catch (e) {
      return "";
    }
  }

  // Try SetFieldValue on multiple candidate field names, return the one that worked
  function setFieldByNameList(bc, names, value) {
    for (var i = 0; i < names.length; i++) {
      if (safeSetField(bc, names[i], value)) {
        var readback = safeGetField(bc, names[i]);
        if (readback === value) return { ok: true, field: names[i] };
      }
    }
    return { ok: false };
  }

  // Set field via PM API (LeaveField).
  // PM goes through Siebel's full event pipeline (PreSetFieldValue etc.),
  // which BC SetFieldValue bypasses — causing server scripts to override values.
  function setFieldViaPM(pm, controlName, value) {
    try {
      var control = pm.ExecuteMethod("GetControl", controlName);
      if (!control) return false;
      pm.ExecuteMethod("LeaveField", control, value, false);
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- Exports ---

  window._siebel = {

    // Step 1: Verify we're on a Service Request view
    navigateToServiceRequests: function () {
      var app = getApp();
      var viewName = app.ActiveViewName();
      if (!viewName || viewName.indexOf("Service Request") === -1) {
        throw new Error("Not on a Service Request view. Current view: " + viewName);
      }
      return Promise.resolve({ ok: true, view: viewName });
    },

    // Step 2: Query SR by number
    // Uses DOM execCommand to type into the query row — this is the ONLY
    // reliable approach on GCT. Siebel's Presentation Renderer ignores
    // bc.SetFieldValue() and SetSearchSpec in query mode; only input events
    // from execCommand (same browser path as real keyboard input) are processed.
    querySR: function (srNumber) {
      return new Promise(function (resolve, reject) {
        try {
          console.log("[GCT] querySR start: " + srNumber);
          var app = getApp();
          var applet = app.FindApplet("Service Request List Applet");
          if (!applet) throw new Error("Could not find Service Request List Applet");
          var bc = getBusComp(applet, "Service Request BC");
          console.log("[GCT] Applet + BC obtained, view: " + app.ActiveViewName());

          // Delay 2s before entering query mode — pollSiebelReady only checks
          // JS model readiness, but the applet DOM may still be rendering.
          setTimeout(function () {
            try {
              bc.InvokeMethod("ClearToQuery");
              applet.InvokeMethod("NewQuery");
              console.log("[GCT] ClearToQuery + NewQuery done, polling for input...");
            } catch (e) {
              console.error("[GCT] Failed to enter query mode: " + e.message);
              reject(new Error("Failed to enter query mode: " + e.message));
              return;
            }

            // Poll for the SR_Number input to appear
            var pollAttempts = 0;
            var maxPollAttempts = 20; // 10s at 500ms
            var inputPoll = setInterval(function () {
              pollAttempts++;
              var srInput = document.querySelector('input[name="SR_Number"]:not([readonly])');
              if (!srInput && pollAttempts < maxPollAttempts) return;
              clearInterval(inputPoll);

              try {
                if (!srInput) {
                  // Diagnostic: scan for ANY SR-related inputs
                  var all = document.querySelectorAll('input');
                  console.error("[GCT] No SR_Number input after " + (pollAttempts * 500) + "ms. Total inputs: " + all.length);
                  for (var d = 0; d < all.length; d++) {
                    if (all[d].name && /sr/i.test(all[d].name)) {
                      console.log("[GCT]   Found: name='" + all[d].name + "' readonly=" + all[d].readOnly);
                    }
                  }
                  reject(new Error("Could not find SR Number query input"));
                  return;
                }
                console.log("[GCT] Found SR input after " + (pollAttempts * 500) + "ms");

                srInput.focus();
                srInput.select();
                var typed = document.execCommand("insertText", false, srNumber);
                console.log("[GCT] execCommand returned: " + typed + ", value: '" + srInput.value + "'");

                if (!typed) {
                  reject(new Error("Failed to type SR number into query field"));
                  return;
                }

                applet.InvokeMethod("ExecuteQuery");
                checkErrors(app, "Query");

                if (bc.InvokeMethod("FirstRecord")) {
                  var foundSR = bc.GetFieldValue("SR Number");
                  console.log("[GCT] Found SR: '" + foundSR + "' (wanted: '" + srNumber + "')");
                  if (!foundSR) {
                    reject(new Error("SR " + srNumber + " not found"));
                    return;
                  }
                  var rowId = safeGetField(bc, "Id");
                  if (!rowId) {
                    var urlParams = new URLSearchParams(window.location.search);
                    rowId = urlParams.get("SWERowId0") || "";
                  }
                  resolve({ ok: true, srNumber: String(foundSR), rowId: rowId });
                } else {
                  reject(new Error("SR " + srNumber + " not found. Check the number and try again."));
                }
              } catch (e) {
                console.error("[GCT] Query error: " + e.message);
                reject(new Error("Query failed: " + e.message));
              }
            }, 500);
          }, 2000); // 2s initial delay for DOM readiness
        } catch (e) {
          reject(new Error("Query failed: " + e.message));
        }
      });
    },

    // Step 3: Drill into SR detail view
    // Uses SiebelApp.S_App.GotoView (AJAX, no page reload).
    // Two-phase polling: 1) view name match → 2) Activity applet available.
    drillIntoSR: function () {
      return new Promise(function (resolve, reject) {
        try {
          var sApp = getSiebelApp();
          sApp.GotoView("Service Request Detail View");

          var attempts = 0;
          var maxAttempts = 40; // 20s at 500ms
          var viewReady = false;
          var poll = setInterval(function () {
            attempts++;
            try {
              if (!viewReady) {
                var view = sApp.GetActiveView();
                if (view && view.GetName() === "Service Request Detail View") {
                  viewReady = true;
                }
              } else {
                var applet = findActivitiesApplet();
                if (applet) {
                  clearInterval(poll);
                  resolve({ ok: true });
                }
              }
            } catch (e) { /* keep polling */ }
            if (attempts >= maxAttempts) {
              clearInterval(poll);
              reject(new Error(viewReady
                ? "Detail view loaded but applets not ready after 20s"
                : "Detail view not ready after 20s"));
            }
          }, 500);
        } catch (e) {
          reject(new Error("Drill-in failed: " + e.message));
        }
      });
    },

    // Step 4: Verify Activities applet is loaded
    navigateActivities: function () {
      var applet = findActivitiesApplet();
      if (!applet) throw new Error("Could not find Activities applet");
      return Promise.resolve({ ok: true });
    },

    // Step 5: Create new activity record
    // MUST use applet.InvokeMethod("NewRecord") — BC-level NewRecord silently fails.
    createNewActivity: function () {
      return new Promise(function (resolve, reject) {
        try {
          var applet = findActivitiesApplet();
          if (!applet) {
            reject(new Error("Could not find Activities applet"));
            return;
          }
          applet.InvokeMethod("NewRecord");
          resolve({ ok: true });
        } catch (e) {
          reject(new Error("Failed to create activity: " + e.message));
        }
      });
    },

    // Step 6: Fill the activity form
    // Three strategies in order: PM API → DOM execCommand → BC SetFieldValue.
    // PM goes through Siebel's event pipeline but may fail on some applets.
    // DOM execCommand simulates real keyboard input (proven on GCT).
    // BC SetFieldValue is last resort (server scripts may override during WriteRecord).
    fillActivityForm: function (params) {
      return new Promise(function (resolve, reject) {
        // Poll for the form applet to appear (loads async after NewRecord).
        // The form applet has PM with Description/Status controls.
        // Without it, querySelector finds the wrong textarea (SR description).
        var pollCount = 0;
        var maxPoll = 6; // 3s at 500ms (AVAYA SR Activity Note loads fast)
        console.log("[GCT] fillActivityForm: polling for form applet...");
        // Log ALL applets in the view so we can find the right name
        try {
          var view = getSiebelApp().GetActiveView();
          var appletMap = view.GetAppletMap();
          console.log("[GCT] All applets in view:");
          for (var aKey in appletMap) {
            console.log("[GCT]   '" + aKey + "'");
          }
        } catch (e) { console.log("[GCT] Could not enumerate applets: " + e.message); }
        var formPoll = setInterval(function () {
          try {
          pollCount++;
          var applet = findFormApplet();
          if (!applet && pollCount < maxPoll) return;
          clearInterval(formPoll);

          if (!applet) {
            applet = findActivitiesApplet();
            console.warn("[GCT] Form applet not found after " + (pollCount * 500) + "ms, using list applet");
          } else {
            var appName = "unknown";
            try { appName = applet.Name(); } catch (e) { appName = "(Name() failed)"; }
            console.log("[GCT] Form applet found after " + (pollCount * 500) + "ms: " + appName);
          }

        try {
          if (!applet) throw new Error("Could not find Activity applet");
          // AVAYA applet from view map has GetPModel() but NOT BusComp().
          // Get BC from the list applet instead.
          var listApplet = findActivitiesApplet();
          var bc = listApplet ? getBusComp(listApplet, "Activity BC") : null;
          var pm;
          try { pm = applet.GetPModel(); } catch (e) { pm = null; }

          var results = {};
          var appNameSafe = "unknown";
          try { appNameSafe = applet.Name(); } catch (e) { appNameSafe = "(no Name method)"; }
          console.log("[GCT] fillActivityForm: applet=" + appNameSafe + ", pm=" + !!pm);

          // --- Comments (activity note text) ---
          // In Siebel Activity, "Comments" and "Description" are separate fields.
          // The user's input should go to "Comments".
          if (params.comments) {
            console.log("[GCT] params.comments length: " + params.comments.length);
            // Try multiple PM control names: Comments first, then Description
            var commentControls = ["Comments", "Description", "Comment", "Activity Comments"];
            var commentSet = false;
            if (pm) {
              for (var ci = 0; ci < commentControls.length; ci++) {
                var ok = setFieldViaPM(pm, commentControls[ci], params.comments);
                console.log("[GCT] PM control '" + commentControls[ci] + "': " + ok);
                if (ok) { results.comments = { ok: true, method: "pm", control: commentControls[ci] }; commentSet = true; break; }
              }
            }
            // DOM fallback: try Comments textarea, then Description textarea
            if (!commentSet) {
              var domSelectors = [
                'textarea[aria-label="Comments"]:not([readonly])',
                'textarea[aria-label="Comment"]:not([readonly])',
                'textarea[aria-label="Description"]:not([readonly])'
              ];
              for (var di = 0; di < domSelectors.length; di++) {
                var el = document.querySelector(domSelectors[di]);
                console.log("[GCT] DOM '" + domSelectors[di] + "': " + !!el + (el ? " value_len=" + el.value.length : ""));
                if (el) {
                  el.focus(); el.select();
                  var typed = document.execCommand("insertText", false, params.comments);
                  if (typed) { results.comments = { ok: true, method: "dom", selector: domSelectors[di] }; commentSet = true; break; }
                }
              }
            }
            // BC fallback: try Comments, then Description
            if (!commentSet) {
              var bcFields = ["Comments", "Description", "Comment"];
              for (var bi = 0; bi < bcFields.length; bi++) {
                if (safeSetField(bc, bcFields[bi], params.comments)) {
                  console.log("[GCT] BC field '" + bcFields[bi] + "' set OK");
                  results.comments = { ok: true, method: "bc", field: bcFields[bi] }; commentSet = true; break;
                }
              }
            }
            if (!commentSet) results.comments = { ok: false };
          }

          // --- Status ---
          if (params.status) {
            var statusOk = pm && setFieldViaPM(pm, "Status", params.status);
            console.log("[GCT] Status PM result: " + statusOk);
            if (statusOk) {
              results.status = { ok: true, method: "pm" };
            } else {
              var statusEl = document.querySelector('[aria-label="Status"]');
              console.log("[GCT] Status DOM element: " + !!statusEl + (statusEl ? " tag=" + statusEl.tagName : ""));
              if (statusEl) {
                try {
                  statusEl.focus();
                  statusEl.value = params.status;
                  statusEl.dispatchEvent(new Event("change", { bubbles: true }));
                  results.status = { ok: true, method: "dom" };
                } catch (e) {
                  console.error("[GCT] Status DOM error: " + e.message);
                }
              }
              if (!results.status) {
                safeSetField(bc, "Status", params.status);
                results.status = { ok: true, method: "bc" };
                console.log("[GCT] Status fell through to BC");
              }
            }
          }
          console.log("[GCT] fillActivityForm results: " + JSON.stringify(results));

          resolve({ ok: true, fields: results });
        } catch (e) {
          reject(new Error("Failed to fill activity form: " + e.message));
        }
          } catch (pollErr) {
            clearInterval(formPoll);
            console.error("[GCT] formPoll crash: " + pollErr.message, pollErr);
            reject(new Error("fillActivityForm poll crashed: " + pollErr.message));
          }
        }, 500); // formPoll interval
      });
    },

    // Step 7: Uncheck "Send Update Email"
    // Confirmed via MCP probe:
    //   PM control: "AVAYA Send Update Mail" (uiType: JCheckBox)
    //   BC field:   "AVAYA_Send Status Update Email Flag"
    //   Display:    "*Send Update Email"
    // Strategy: DOM checkbox click first (real keystroke path that Siebel scripts
    // whitelist), then PM LeaveField, then BC SetFieldValue as fallback.
    uncheckSendEmail: function () {
      return new Promise(function (resolve) {
        // Wait 500ms for Siebel to settle after Status PM update.
        // Status change can re-render or reset the Send Update Email checkbox.
        setTimeout(function () {
        try {
          // Strategy 1: DOM — click the actual checkbox if checked.
          // The display label is "*Send Update Email" (asterisk indicates required).
          try {
            var domSelectors = [
              'input[type="checkbox"][aria-label="*Send Update Email"]',
              'input[type="checkbox"][aria-label="Send Update Email"]',
              'input[type="checkbox"][aria-label*="Send Update"]'
            ];
            for (var s = 0; s < domSelectors.length; s++) {
              var cb = document.querySelector(domSelectors[s]);
              if (cb) {
                console.log("[GCT] Found Send Update Email checkbox via " + domSelectors[s] + ", checked=" + cb.checked);
                if (cb.checked) {
                  // Fire full event sequence so Siebel's PR registers the change
                  cb.focus();
                  cb.click();
                  cb.dispatchEvent(new Event("change", { bubbles: true }));
                  cb.dispatchEvent(new Event("input", { bubbles: true }));
                  cb.blur();
                  cb.dispatchEvent(new FocusEvent("blur", { bubbles: true }));

                  // Also set BC field directly to align state
                  try {
                    var listApplet = findActivitiesApplet();
                    if (listApplet) {
                      var bcSync = listApplet.BusComp();
                      if (bcSync) {
                        safeSetField(bcSync, "AVAYA_Send Status Update Email Flag", "N");
                        console.log("[GCT] BC sync after DOM click: '" + safeGetField(bcSync, "AVAYA_Send Status Update Email Flag") + "'");
                      }
                    }
                  } catch (e) { /* sync best-effort */ }

                  setTimeout(function () {
                    if (cb.checked) {
                      console.warn("[GCT] Checkbox re-checked after click, clicking again");
                      cb.click();
                      cb.dispatchEvent(new Event("change", { bubbles: true }));
                      cb.blur();
                    }
                    console.log("[GCT] Final checkbox state: checked=" + cb.checked);
                    resolve({ ok: true, method: "dom-click", selector: domSelectors[s], finalChecked: cb.checked });
                  }, 200);
                  return;
                } else {
                  resolve({ ok: true, method: "dom-check", alreadyUnchecked: true });
                  return;
                }
              }
            }
          } catch (e) { console.error("[GCT] DOM checkbox error: " + e.message); }

          // Strategy 2: PM API on AVAYA SR Activity Status - Outbound applet
          try {
            var formApplet = findFormApplet();
            if (formApplet) {
              var pm = formApplet.GetPModel();
              if (pm) {
                var ctrl = pm.ExecuteMethod("GetControl", "AVAYA Send Update Mail");
                if (ctrl) {
                  pm.ExecuteMethod("LeaveField", ctrl, "N", false);
                  console.log("[GCT] PM LeaveField on AVAYA Send Update Mail set to N");
                  resolve({ ok: true, method: "pm", control: "AVAYA Send Update Mail" });
                  return;
                }
              }
            }
          } catch (e) { console.error("[GCT] PM error: " + e.message); }

          // Strategy 3: BC SetFieldValue — known Avaya field name
          try {
            var listApplet = findActivitiesApplet();
            if (listApplet) {
              var bc = listApplet.BusComp();
              if (bc) {
                var fieldName = "AVAYA_Send Status Update Email Flag";
                var currentVal = safeGetField(bc, fieldName);
                console.log("[GCT] BC '" + fieldName + "' before set: '" + currentVal + "'");
                if (safeSetField(bc, fieldName, "N")) {
                  var readback = safeGetField(bc, fieldName);
                  console.log("[GCT] BC '" + fieldName + "' after set: '" + readback + "'");
                  resolve({ ok: true, method: "bc", field: fieldName, value: readback });
                  return;
                }
              }
            }
          } catch (e) { console.error("[GCT] BC error: " + e.message); }

          resolve({ ok: true, warning: "Send Email checkbox not found via any method" });
        } catch (e) {
          resolve({ ok: true, warning: "Could not uncheck Send Email: " + e.message });
        }
        }, 500); // 500ms settle delay
      });
    },

    // Step 8: Save the record — BC WriteRecord
    // Returns the saved Activity Id so it can be used for post-save EAI update.
    save: function () {
      return new Promise(function (resolve, reject) {
        try {
          var app = getApp();
          var applet = findActivitiesApplet();
          if (!applet) throw new Error("Could not find Activity applet");
          var bc = getBusComp(applet, "Activity BC");

          bc.InvokeMethod("WriteRecord");
          checkErrors(app, "Save");

          var activityId = safeGetField(bc, "Id");
          var verification = {};
          var desc = safeGetField(bc, "Description");
          if (desc) verification.description = desc.substring(0, 50);
          var status = safeGetField(bc, "Status");
          if (status) verification.status = status;

          resolve({ ok: true, activityId: activityId, verification: verification });
        } catch (e) {
          reject(new Error("Save failed: " + e.message));
        }
      });
    },

    // Step 8c: Set Comment field server-side via EAI Siebel Adapter Upsert.
    // Siebel server-side scripts clear the Comment field when set through the
    // applet/PM/BC layer during WriteRecord. EAI Siebel Adapter bypasses those
    // applet-level scripts and updates the field directly via integration object.
    setCommentViaEAI: function (activityId, commentText) {
      return new Promise(function (resolve) {
        try {
          if (!activityId) {
            resolve({ ok: false, error: "No activity Id provided" });
            return;
          }
          var sApp = getSiebelApp();
          var svc = sApp.GetService("EAI Siebel Adapter");
          if (!svc) {
            resolve({ ok: false, error: "EAI Siebel Adapter not available" });
            return;
          }

          // Build SiebelMessage hierarchy: Action Interface > ListOfAction > Action
          var msg = sApp.NewPropertySet();
          msg.SetType("SiebelMessage");
          msg.SetProperty("MessageType", "Integration Object");
          msg.SetProperty("IntObjectName", "Action Interface");
          msg.SetProperty("IntObjectFormat", "Siebel Hierarchical");

          var actionList = sApp.NewPropertySet();
          actionList.SetType("ListOfAction Interface");

          var action = sApp.NewPropertySet();
          action.SetType("Action");
          action.SetProperty("Id", activityId);
          action.SetProperty("Comment", commentText);

          actionList.AddChild(action);
          msg.AddChild(actionList);

          var input = sApp.NewPropertySet();
          input.AddChild(msg);

          var result = svc.InvokeMethod("Upsert", input);
          console.log("[GCT] EAI Upsert returned: " + !!result);
          resolve({ ok: true, method: "eai-upsert", activityId: activityId });
        } catch (e) {
          console.error("[GCT] EAI Upsert error: " + e.message);
          resolve({ ok: false, error: e.message });
        }
      });
    },

    // Step 9: Log time — Headless BC API (best-effort)
    // Never rejects — if time logging fails, the activity record still exists.
    logTime: function (minutes) {
      return new Promise(function (resolve) {
        try {
          var app = getApp();

          var timeApplet = findTimeApplet();
          if (!timeApplet) {
            resolve({ ok: true, warning: "Time applet not found, time not logged" });
            return;
          }

          var bc;
          try { bc = timeApplet.BusComp(); } catch (e) { bc = null; }
          if (!bc) {
            resolve({ ok: true, warning: "Time BC not accessible, time not logged" });
            return;
          }

          // Requery time BC to refresh context after parent activity save
          bc.InvokeMethod("ClearToQuery");
          timeApplet.InvokeMethod("ExecuteQuery");

          // Create new time record via applet (same reason as Activity NewRecord).
          // The row is created empty — the user types the minutes in Siebel.
          timeApplet.InvokeMethod("NewRecord");

          // If a numeric value is provided, also write it. Otherwise leave blank.
          if (minutes !== "" && minutes != null) {
            setFieldByNameList(bc,
              ["AVAYA Reported Time Minutes", "Minutes", "Time"],
              String(minutes)
            );
            bc.InvokeMethod("WriteRecord");
            checkErrors(app, "Time save");
          }

          resolve({ ok: true, timeMinutes: minutes });
        } catch (e) {
          // Best-effort: don't fail the workflow
          resolve({ ok: true, warning: "Time logging failed: " + e.message });
        }
      });
    }
  };
})();
