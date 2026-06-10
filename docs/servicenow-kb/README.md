# ServiceNow Knowledge Base

Source: [ServiceNow/ServiceNowDocs](https://github.com/ServiceNow/ServiceNowDocs) — Australia release branch.
For AI/agent consumption; no images. Human-readable docs at https://www.servicenow.com/docs.

## Files

### REST API
| File | Source | Description |
|------|--------|-------------|
| `c_TableAPI.md` | `api-reference/rest-apis/` | **Table REST API** — Full reference for `/api/now/table/` endpoints (GET, POST, PUT, PATCH, DELETE). Query parameters, response formats, error codes, sysparms. |
| `rest-api-general.md` | `api-reference/rest-apis/api-rest.md` | REST API overview — authentication methods, request/response format, headers |
| `rest-api-overview.md` | `api-reference/api-implementation.md` | API implementation guide — endpoints, versioning, content negotiation |
| `rest-api-reference.md` | `api-reference/api-implementation-reference.md` | API reference summary — available REST APIs by product |
| `rest-api-explorer.md` | `api-reference/rest-api-explorer/` | REST API Explorer — testing and discovering APIs, OAuth setup |

### Incident Management
| File | Source | Description |
|------|--------|-------------|
| `incident-management.md` | `incident-management/c_IncidentManagement.md` | Incident management overview — concepts, roles, process |
| `incident-state-model.md` | `incident-management/c_IncidentManagementStateModel.md` | **Incident state model** — states, transitions, lifecycle |
| `incident-data-model.md` | `incident-management/incident-mangmt-data-model.md` | Incident table schema — fields, relationships |
| `incident-configuration.md` | `incident-management/incident-configuration.md` | Configuring incident forms, fields, properties |
| `incident-process.md` | `incident-management/incident-management-process.md` | Incident management process flow |
| `incident-work-on.md` | `incident-management/work-on-incidents.md` | Working on incidents — assignments, communications |
| `incident-resolve-close.md` | `incident-management/resolve-and-close-an-incident.md` | Resolving and closing incidents — resolution notes, closures |
| `incident-task-state-sync.md` | `incident-management/inci-inci-task-state-sync.md` | State sync between incidents and incident tasks |

### Change Management
| File | Source | Description |
|------|--------|-------------|
| `change-management.md` | `change-management/c_ITILChangeManagement.md` | Change management overview |
| `change-state-model.md` | `change-management/c_ChangeStateModel.md` | **Change state model** — states, transitions, lifecycle |
| `change-data-model.md` | `change-management/change-data-model.md` | Change table schema |
| `change-states.md` | `change-management/normal-standard-emergency-states.md` | Change types and their state flows |

### Problem Management
| File | Source | Description |
|------|--------|-------------|
| `problem-state-model.md` | `problem-management/map-problem-state.md` | **Problem state model** — states and transitions |

## Key References for This Project

The SNOW Ticket Manager Chrome extension primarily uses:
- **Table REST API** (`c_TableAPI.md`) — All CRUD operations on incident, change_request, problem, etc.
- **Incident state model** (`incident-state-model.md`) — Valid state transitions for the Action tab
- **Change state model** (`change-state-model.md`) — Valid state transitions for change records
- **Problem state model** (`problem-state-model.md`) — Valid state transitions for problem records

## State Codes Quick Reference

### Incident States
```
1 = New
2 = In Progress
3 = On Hold (Awaiting Problem / Awaiting User Info / Awaiting Vendor)
4 = Service Restored
5 = Awaiting Problem
6 = Resolved
7 = Closed
-5 = Pending (custom)
```

### Change States
```
-5 = Pending
1 = New / Open / Draft
2 = Assess / Review
3 = Authorize / Approve
4 = Scheduled / Implement
5 = Review / Post Implementation Review
6 = Closed / Complete
7 = Cancelled / Aborted
```

### Problem States
```
1 = New / Draft
2 = Assess / Under Investigation
3 = Root Cause Known
4 = Fix in Progress
5 = Resolved / Fixed
6 = Closed
7 = Cancelled
```
