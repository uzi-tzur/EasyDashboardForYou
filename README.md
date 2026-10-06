<p align="center"><img src="assets/logo.png" alt="EasyDashboardForYou" width="320"></p>

# EasyDashboardForYou

Turn any spreadsheet into a filterable, sortable, editable dashboard, then export it back.

**Live app:** https://uzi-tzur.github.io/EasyDashboardForYou/

## Run it

Use the live app above, or run it locally. You can double-click `index.html` to open it, or serve the folder (recommended, because Google Sheets import needs it):

```bash
python -m http.server 8765
```

Then open http://localhost:8765. There is no build step and nothing to install. Excel support loads SheetJS from a CDN.

## How it works

1. **Import** your data in one of these ways:
   - an Excel / CSV file (you can also drag and drop it onto the page),
   - a Google Sheet link (the sheet must be shared as *Anyone with the link can view*; the tab in the link's `gid` is the one imported),
   - cells pasted from Excel or Google Sheets.
2. **Field mapping** (also opens when you import or click *Start from scratch*). It has three tabs:
   - **Fields**: the columns of your dashboard. Rename them, choose how each is shown (*Text, Long text, Number, Date, Label, Tags, Status*), switch on a **Filter** or **Chart**, drag to reorder, remove fields you don't need (restorable until you save), or **Add field**.
   - **Values & colours**: for each Status or Label field, one line per value. Type to rename it, click the dot to change its colour, drag to reorder, add new values, or delete one (you choose what its rows become).
   - **Summary cards**: cards that count rows where a field contains a value, plus which field colours the bar at the left of each row.

   The app pre-fills a best guess for every imported column. Nothing changes in your data until you click *Build dashboard* / *Save changes*.

   **Start from scratch** creates an empty dashboard (for example a student list with Name, Major, Year, GPA and Status) that you fill in with *Add row*.
3. **Use the dashboard**:
   - Summary cards show each count with its share of the visible records. Click a card to show only those rows.
   - Breakdown charts show how records split by a field. Click a bar to filter by that value.
   - Status values are coloured by meaning: green for done or approved, amber for pending or in review, red for blocked or failed, blue for in progress, grey otherwise.
   - Use the filter dropdowns above the table. Values within a field are OR, filters across fields are AND. Active filters appear as chips you can remove one at a time.
   - Search, and click column headers to sort.
   - **Click any cell to edit it.** Status and Badge cells open a dropdown of all values, including a “+ New value…” option. Enter saves, Esc cancels, Tab moves to the next cell.
   - Add rows or delete them (deleting can be undone).
   - Click the title to rename it.

   Changes are saved automatically in your browser.
4. **Export**:
   - CSV or Excel (.xlsx).
   - **Google Sheets (sign in)**: signs in with Google and writes the data straight into a new spreadsheet. Later exports can replace the data in that same spreadsheet. This needs a one-time setup (see below).
   - **Copy for Google Sheets (paste)**: copies the data so you can paste it into a new sheet with Ctrl+V. This needs no setup.
   - **Print / Save as PDF**: prints the dashboard without the toolbar.
   - Export includes either the visible rows only or all rows.
   - Export uses the dashboard field names, so you can re-import the file later and it maps itself automatically.

## Google Sheets export setup

Google requires each app to have its own OAuth **Client ID**. A Client ID is a public identifier, not a secret. You set it up once:

1. In the [Google Cloud Console](https://console.cloud.google.com/projectcreate), create a project.
2. Enable the [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com).
3. Configure the [OAuth consent screen](https://console.cloud.google.com/auth/overview) as *External*. Then either add the people who will use it as **test users**, or publish the app. The only scope it uses is `drive.file`, which is not a sensitive scope.
4. Under [Clients](https://console.cloud.google.com/auth/clients), create an OAuth client of type **Web application**. Add these **Authorized JavaScript origins**:
   - `https://uzi-tzur.github.io`
   - `http://localhost:8765` (for local use)
5. Put the Client ID in `js/config.js` (`googleClientId`) so everyone using the site gets it. Alternatively, paste it into the export dialog, which saves it in that browser only.

**Privacy:** the app asks only for the `drive.file` permission. It can create spreadsheets and edit the ones it created, but it cannot see anything else in your Drive. The sign-in token stays in memory and is never stored.

## Several dashboards

Keep as many dashboards as you like. Use **My dashboards** (next to the dashboard title) to:
- switch between dashboards,
- create a **New blank dashboard**,
- **Duplicate** the current one (same fields, colours, filters and cards, with or without its rows),
- open **Demo templates**: Release Tracking, Student Records, Project Tasks, Sales Pipeline and Inventory, each usable with sample data or empty,
- **Delete** the current dashboard (you can undo right after).

Importing a different spreadsheet creates a new dashboard. Re-importing the same sheet (same columns) refreshes the current dashboard's data.

## Templates

*Export → Save template* writes the mapping (fields, types, filters, cards, title) to a `.json` file. *Import → Load template* creates a new dashboard from it; then import data and its columns are matched by name.

`samples/` contains the Release Tracking example as a CSV plus its template.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout and dialogs |
| `css/styles.css` | Styling (light + dark mode) |
| `js/app.js` | Import, mapping, rendering, editing, export |
| `js/google-sheets.js` | Google sign-in and direct Sheets export |
| `js/config.js` | Settings (Google Client ID) |
| `js/demos.js` | Demo templates (Release Tracking, Student Records, Project Tasks, Sales Pipeline, Inventory) |

---

Created by Uzi Tzur. All rights reserved. Contact: 214.354.0604
