/* Direct export to Google Sheets via Google Identity Services (OAuth token model).
 *
 * Uses the `drive.file` scope: the app can only see/edit spreadsheets it created itself,
 * never the rest of the user's Drive.
 */
window.GoogleSheets = (() => {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://sheets.googleapis.com/v4/spreadsheets';
  let token = null; // { value, expires }
  let gisPromise = null;

  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = resolve;
        s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in (offline or blocked?).')); };
        document.head.append(s);
      });
    }
    return gisPromise;
  }

  async function getToken(clientId, { forcePrompt = false } = {}) {
    if (!forcePrompt && token && token.expires > Date.now() + 60_000) return token.value;
    await loadGis();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: resp => {
          if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
          if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
            reject(new Error('Permission to create spreadsheets was not granted.'));
            return;
          }
          token = { value: resp.access_token, expires: Date.now() + (resp.expires_in || 3600) * 1000 };
          resolve(token.value);
        },
        error_callback: err => reject(new Error(err?.type === 'popup_closed' ? 'Sign-in window was closed.' : (err?.message || 'Sign-in failed.')))
      });
      client.requestAccessToken({ prompt: forcePrompt ? 'consent' : '' });
    });
  }

  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || `Google Sheets API error (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // aoa: [[header…], [row…]…]; numeric: boolean per column → write numbers as numbers.
  function toRowData(aoa, numeric) {
    return aoa.map((row, r) => ({
      values: row.map((v, c) => {
        const s = String(v ?? '');
        const n = Number(s.replace(/,/g, ''));
        const value = r > 0 && numeric[c] && s.trim() !== '' && Number.isFinite(n) ? { numberValue: n } : { stringValue: s };
        return r === 0
          ? { userEnteredValue: value, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } } }
          : { userEnteredValue: value };
      })
    }));
  }

  const finishingRequests = (sheetId, cols) => [
    { setBasicFilter: { filter: { range: { sheetId } } } },
    { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: cols } } }
  ];

  async function create(title, aoa, numeric) {
    const cols = Math.max(1, aoa[0].length);
    const sheet = await call('POST', API, {
      properties: { title },
      sheets: [{
        properties: { title: 'Data', gridProperties: { frozenRowCount: 1, rowCount: Math.max(aoa.length, 100), columnCount: cols } },
        data: [{ startRow: 0, startColumn: 0, rowData: toRowData(aoa, numeric) }]
      }]
    });
    const sheetId = sheet.sheets[0].properties.sheetId;
    await call('POST', `${API}/${sheet.spreadsheetId}:batchUpdate`, { requests: finishingRequests(sheetId, cols) });
    return { spreadsheetId: sheet.spreadsheetId, sheetId, url: sheet.spreadsheetUrl, title };
  }

  async function update(target, aoa, numeric) {
    const cols = Math.max(1, aoa[0].length);
    const { sheetId } = target;
    await call('POST', `${API}/${target.spreadsheetId}:batchUpdate`, {
      requests: [
        { updateCells: { range: { sheetId }, fields: 'userEnteredValue,userEnteredFormat' } },
        { updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1, rowCount: Math.max(aoa.length, 100), columnCount: Math.max(cols, 26) } },
          fields: 'gridProperties(frozenRowCount,rowCount,columnCount)'
        } },
        { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: toRowData(aoa, numeric), fields: 'userEnteredValue,userEnteredFormat' } },
        ...finishingRequests(sheetId, cols)
      ]
    });
    return target;
  }

  /**
   * Export rows to Google Sheets. Signs in if needed.
   * target: existing { spreadsheetId, sheetId, url, title } to overwrite, or null to create a new spreadsheet.
   * Returns the spreadsheet target ({ spreadsheetId, sheetId, url, title, recreated? }).
   */
  async function exportTable({ clientId, title, aoa, numeric, target }) {
    if (!clientId) throw new Error('Google Client ID is not set up yet.');
    await getToken(clientId);
    const run = async () => {
      if (!target) return create(title, aoa, numeric);
      try {
        return await update(target, aoa, numeric);
      } catch (err) {
        // spreadsheet deleted / no longer accessible → create a fresh one
        if (err.status === 404 || err.status === 403) return { ...(await create(title, aoa, numeric)), recreated: true };
        throw err;
      }
    };
    try {
      return await run();
    } catch (err) {
      if (err.status !== 401) throw err;
      await getToken(clientId, { forcePrompt: true }); // token revoked or expired
      return run();
    }
  }

  function signOut() {
    if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.value, () => {});
    token = null;
  }

  // Load the sign-in script ahead of the click, so the popup opens within the user gesture.
  const preload = () => loadGis().catch(() => {});

  return { exportTable, signOut, preload, isSignedIn:() => !!token && token.expires > Date.now() };
})();
