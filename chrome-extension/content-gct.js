// content-gct.js — Siebel CRM JavaScript API automation
// Injected into GCT tab's MAIN world by background.js
// Uses Siebel's JavaScript API (theApplication(), BusComp, InvokeMethod)
// and Siebel OpenUI API (SiebelApp.S_App) for internal navigation.

(function () {
  "use strict";

  // --- Dialog suppression ---
  // Siebel business rules can show window.alert() during page load (e.g.,
  // "Account Critical Notes"). These block Siebel's async JS initialization,
  // causing SBL-UIF-00335 errors. Override alert/confirm to capture messages
  // without blocking. Installed once at injection time, persists for the
  // entire workflow since subsequent navigation is AJAX-based (no page reload).
  var _origAlert = window.alert;
  var _origConfirm = window.confirm;
  window._siebelDialogs = [];
  window.alert = function (msg) {
    window._siebelDialogs.push({ type: "alert", message: String(msg), time: Date.now() });
  };
  window.confirm = function (msg) {
    window._siebelDialogs.push({ type: "confirm", message: String(msg), time: Date.now() });
    return true;
  };

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // --- Siebel JS API helpers ---

  function getApp() {
    var app = theApplication();
    if (!app) throw new Error("Siebel application not available");
    return app;
  }

  // Exports
  window._siebel = {

    // Step 1: Navigate to Service → All Service Requests
    // (Navigation is handled by background.js via chrome.tabs.update)
    // This is a no-op — we're already on the right view after nav
    navigateToServiceRequests: function () {
      var app = getApp();
      var viewName = app.ActiveViewName();
      if (!viewName || viewName.indexOf("Service Request") === -1) {
        throw new Error("Not on a Service Request view. Current view: " + viewName);
      }
      return Promise.resolve({ ok: true, view: viewName });
    },

    // Step 2: Query SR by number
    // Uses document.execCommand('insertText') to type into the query row.
    // Siebel's Presentation Renderer ignores direct value assignments and
    // API SetSearchSpec calls, but properly processes input events from
    // execCommand — the same browser path as real keyboard input.
    // Note: Siebel's PR renders the query row asynchronously after NewQuery,
    // so we delay before looking for the input element.
    querySR: function (srNumber) {
      return new Promise(function (resolve, reject) {
        var app, applet, bc;
        try {
          app = getApp();
          applet = app.FindApplet("Service Request List Applet");
          if (!applet) throw new Error("Could not find Service Request List Applet");
          bc = applet.BusComp();
          if (!bc) throw new Error("Could not access Service Request business component");
        } catch (e) {
          reject(e);
          return;
        }

        // Enter query mode
        try {
          bc.InvokeMethod("ClearToQuery");
          applet.InvokeMethod("NewQuery");
        } catch (e) {
          reject(new Error("Failed to enter query mode: " + e.message));
          return;
        }

        // Wait for Siebel PR to render the query row (async DOM update)
        setTimeout(function () {
          try {
            var srInput = document.querySelector('input[name="SR_Number"]:not([readonly])');
            if (!srInput) {
              reject(new Error("Could not find SR Number query input"));
              return;
            }

            // Type the SR number via execCommand — Siebel's PR processes this
            srInput.focus();
            srInput.select();
            var typed = document.execCommand("insertText", false, srNumber);
            if (!typed) {
              reject(new Error("Failed to type SR number into query field"));
              return;
            }

            // Execute the query
            applet.InvokeMethod("ExecuteQuery");

            // Check for Siebel errors after query
            if (app.GetErrorCount() > 0) {
              var qerr = app.GetErrorMsg(0) || "Unknown query error";
              reject(new Error("Query failed: " + qerr));
              return;
            }

            if (bc.InvokeMethod("FirstRecord")) {
              var foundSR = bc.GetFieldValue("SR Number");
              if (!foundSR) {
                reject(new Error("SR " + srNumber + " not found"));
                return;
              }
              // Get RowId from URL — Siebel puts the selected record's
              // RowId in SWERowId0 after query, but BC GetFieldValue("Id")
              // returns empty in list views.
              var urlParams = new URLSearchParams(window.location.search);
              var rowId = urlParams.get("SWERowId0") || "";
              resolve({ ok: true, srNumber: String(foundSR), rowId: rowId });
            } else {
              reject(new Error("SR " + srNumber + " not found. Check the number and try again."));
            }
          } catch (e) {
            reject(new Error("Query failed: " + e.message));
          }
        }, 500);
      });
    },

    // Step 3: Drill into SR detail
    // Uses Siebel's internal GotoView API (SiebelApp.S_App.GotoView)
    // instead of URL-based navigation. Benefits:
    //   - No page reload (AJAX-based), so gctInjected flag stays valid
    //   - Proper state management (no SBL-UIF-00335 errors)
    //   - Preserves current record context (selected SR carries over)
    //   - Dialog suppression (installed above) catches Critical Notes alerts
    drillIntoSR: function () {
      return new Promise(function (resolve, reject) {
        try {
          if (typeof SiebelApp === "undefined" || !SiebelApp.S_App || !SiebelApp.S_App.GotoView) {
            reject(new Error("SiebelApp.S_App.GotoView not available"));
            return;
          }

          SiebelApp.S_App.GotoView("Service Request Detail View");

          // Poll for view readiness (GotoView is async AJAX)
          var attempts = 0;
          var maxAttempts = 30; // 15 seconds at 500ms intervals
          var pollInterval = setInterval(function () {
            attempts++;
            try {
              var view = SiebelApp.S_App.GetActiveView();
              if (view && view.GetName() === "Service Request Detail View") {
                clearInterval(pollInterval);
                resolve({ ok: true });
              }
            } catch (e) { /* keep polling */ }
            if (attempts >= maxAttempts) {
              clearInterval(pollInterval);
              reject(new Error("Detail view not ready after 15s"));
            }
          }, 500);
        } catch (e) {
          reject(new Error("Drill-in failed: " + e.message));
        }
      });
    },

    // Step 4: Navigate to Activities tab
    // Activities tab is part of Service Request Detail View — verify it loaded
    navigateActivities: function () {
      var app = getApp();
      try {
        var activityApplet = app.FindApplet("Activity List Applet With Navigation");
        if (!activityApplet) {
          throw new Error("Could not find Activity List Applet");
        }
        return Promise.resolve({ ok: true });
      } catch (e) {
        throw new Error("Activities tab not loaded: " + e.message);
      }
    },

    // Step 5: Create new activity record
    createNewActivity: function () {
      return new Promise(function (resolve, reject) {
        try {
          var app = getApp();
          var applet = app.FindApplet("Activity List Applet With Navigation");
          if (!applet) {
            reject(new Error("Could not find Activity List Applet"));
            return;
          }

          var bc = applet.BusComp();
          if (!bc) {
            reject(new Error("Could not access Activity business component"));
            return;
          }

          bc.InvokeMethod("NewRecord", 1); // NewAfter = 1
          resolve({ ok: true });
        } catch (e) {
          reject(new Error("Failed to create activity: " + e.message));
        }
      });
    },

    // Step 6: Fill the activity form
    // Uses the Activity List Applet's BC (the Activity Form Applet doesn't
    // exist in this view configuration — the list applet's BC shares the
    // same underlying data and SetFieldValue works through it).
    fillActivityForm: function (params) {
      return new Promise(function (resolve, reject) {
        try {
          var app = getApp();
          // Activity Form Applet doesn't exist in Service Request Detail View.
          // Use the list applet's BC which shares the same underlying data.
          var applet = app.FindApplet("Activity Form Applet");
          if (!applet) {
            applet = app.FindApplet("Activity List Applet With Navigation");
          }
          if (!applet) {
            reject(new Error("Could not find Activity applet"));
            return;
          }

          var bc = applet.BusComp();
          if (!bc) {
            reject(new Error("Could not access Activity business component"));
            return;
          }

          // Set field values using Siebel API
          if (params.type) {
            bc.InvokeMethod("SetFieldValue", "Activity Type", params.type);
          }
          if (params.comments) {
            bc.InvokeMethod("SetFieldValue", "Comments", params.comments);
          }
          if (params.status) {
            bc.InvokeMethod("SetFieldValue", "Status", params.status);
          }

          resolve({ ok: true });
        } catch (e) {
          reject(new Error("Failed to fill activity form: " + e.message));
        }
      });
    },

    // Step 7: Log time in the Time applet
    // Uses "Activity Daily Hour Applet" — the actual applet name in
    // Service Request Detail View (not "Action Time Applet").
    logTime: function (minutes) {
      return new Promise(function (resolve, reject) {
        try {
          var app = getApp();

          // Primary: Activity Daily Hour Applet (verified in live GCT)
          var timeApplet = app.FindApplet("Activity Daily Hour Applet");
          if (!timeApplet) {
            timeApplet = app.FindApplet("Action Time Applet");
          }
          if (!timeApplet) {
            timeApplet = app.FindApplet("Time Applet");
          }
          if (!timeApplet) {
            reject(new Error("Could not find Time Applet"));
            return;
          }

          var bc = timeApplet.BusComp();
          if (!bc) {
            reject(new Error("Could not access Time business component"));
            return;
          }

          bc.InvokeMethod("NewRecord", 1); // NewAfter
          bc.InvokeMethod("SetFieldValue", "Minutes", String(minutes));

          resolve({ ok: true });
        } catch (e) {
          reject(new Error("Failed to log time: " + e.message));
        }
      });
    },

    // Step 8: Save the record
    // Uses the Activity List Applet's BC (same as fillActivityForm).
    save: function () {
      return new Promise(function (resolve, reject) {
        try {
          var app = getApp();
          // Use Activity List Applet's BC (Activity Form Applet may not exist)
          var applet = app.FindApplet("Activity Form Applet");
          if (!applet) {
            applet = app.FindApplet("Activity List Applet With Navigation");
          }
          if (!applet) {
            reject(new Error("Could not find Activity applet"));
            return;
          }

          var bc = applet.BusComp();
          if (!bc) {
            reject(new Error("Could not access Activity business component"));
            return;
          }

          bc.InvokeMethod("WriteRecord");

          // Check for Siebel errors
          if (app.GetErrorCount() > 0) {
            var errText = app.GetErrorMsg(0) || "Unknown Siebel error";
            reject(new Error("Save failed: " + errText));
            return;
          }

          resolve({ ok: true });
        } catch (e) {
          reject(new Error("Save failed: " + e.message));
        }
      });
    }
  };
})();
