/*
 * Dashboard configuration.
 *
 * LIVE SYNC — the dashboard reads every tab of the Google Sheet below on load
 * and again every `refreshMinutes`. For this to work the file must be a NATIVE
 * Google Sheet (not an .xlsx stored in Drive) shared as
 * "Anyone with the link → Viewer". See README.md → "Live sync setup".
 *
 * You can also override the sheet without editing this file:
 *   https://<you>.github.io/beyond-appliances/?sheet=<SHEET_ID>
 *   https://<you>.github.io/beyond-appliances/?source=snapshot   (force bundled data)
 */
window.DASHBOARD_CONFIG = {
  sheetId: '1GDtwOmny7nG1QyAj1yOs45FAneOBKjal',

  // Tab names in the Google Sheet (case-sensitive, must match exactly).
  tabs: {
    master: 'SKU_Master',
    sales: 'Sales',
    locations: 'Locations',
    age: 'Age',
    spends: 'Spends',
  },

  // How often to re-pull the sheet while the page is open.
  refreshMinutes: 5,

  // 'auto'     → try the live sheet, fall back to the bundled snapshot if it fails
  // 'live'     → live sheet only (show an error if it fails)
  // 'snapshot' → bundled CSVs in /data only
  source: 'auto',

  snapshotPath: 'data/',
};
