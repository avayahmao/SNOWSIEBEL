# List Tab — View Notes Feature

## Problem
The List tab shows ticket cards but provides no way to view work notes / comments without switching to the Query tab and re-searching the ticket.

## Design

### UI Interaction
- Add a **"View Notes"** link in each ticket card's action links row (before "+ Add Note").
- Click → loading spinner → fetch journal → render work notes + comments (initially 5 entries).
- Click again → collapse (toggle).
- Mutually exclusive with other inline forms (Add Note / Update Status / Close Alarm).
- "Load more" button at the bottom loads 5 more entries at a time until all are shown.
- Reuse existing `.journal-entry` / `.journal-badge` CSS from Query tab.

### Data Flow
1. Click "View Notes" → panel.js sends `{ action: "getJournal", ticketNumber }`.
2. background.js new `getJournal` handler:
   - `detectTable()` → get table name
   - `getTicketInPage(table, ticketNumber)` → get sys_id
   - `getJournalInPage(sysId, table)` → fetch 20 journal entries
   - Return journal array to panel.
3. panel.js stores full 20-entry array in memory, renders first 5.
4. "Load more" is pure frontend pagination — no additional API calls.

### Why a new `getJournal` action (not reuse `getTicket`)
List scenario only needs journal data, not full ticket details or CI info. Lighter weight.

### File Changes
- **background.js** — New `getJournal` message handler (~10 lines).
- **panel.js** — New "View Notes" click handler, journal rendering, "Load more" logic (~60 lines).
- **panel.html** — No changes (links and journal area are JS-generated; CSS already exists).
- **No changes to:** manifest.json, content-snow.js, note-fields.js.
