# EasyDashboardForYou

Turn any spreadsheet into a filterable, sortable, editable dashboard, then export it back.

## Run it

You can double-click `index.html` to open it, or serve the folder (recommended, because Google Sheets import needs it):

```bash
python -m http.server 8765
```

Then open http://localhost:8765. There is no build step and nothing to install. Excel support loads SheetJS from a CDN.

## How it works

1. **Import** your data in one of these ways:
   - an Excel / CSV file (you can also drag and drop it onto the page),
   - a Google Sheet link (the sheet must be shared as *Anyone with the link can view*; the tab in the link's `gid` is the one imported),
   - cells pasted from Excel or Google Sheets.
2. **Field mapping**: for each source column, choose:
   - whether to show it,
   - its display name and column order,
   - how it is displayed: *Text, Long text, Number, Date, Badge, Tags (comma-separated pills), Status*,
   - whether it gets a filter.

   In the same dialog you also set the dashboard title, the field that colours the row bar, and the **summary cards** (each card counts the visible rows where a field contains a value). The app pre-fills a best guess for every column.
3. **Use the dashboard**:
   - Click filter chips to filter (values within a field are OR, filters across fields are AND).
   - Search, and click column headers to sort.
   - **Click any cell to edit it.** Enter saves, Esc cancels, Tab moves to the next cell.
   - Add rows or delete them (deleting can be undone).
   - Click the title to rename it.

   Changes are saved automatically in your browser.
4. **Export**:
   - CSV, Excel (.xlsx), or **Copy for Google Sheets** (copies the data so you can paste it into a new sheet with Ctrl+V).
   - Export includes either the visible rows only or all rows.
   - Export uses the dashboard field names, so you can re-import the file later and it maps itself automatically.

## Templates

*Export → Save template* writes the mapping (fields, types, filters, cards, title) to a `.json` file. *Import → Load template* applies it to a new data set, and columns are matched by name.

`samples/` contains the Release Tracking example as a CSV plus its template. *Import → Load sample* loads it in one click.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout and dialogs |
| `css/styles.css` | Styling (light + dark mode) |
| `js/app.js` | Import, mapping, rendering, editing, export |
| `js/sample.js` | Built-in Release Tracking sample |
