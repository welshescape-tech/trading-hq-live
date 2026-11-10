# Trading HQ

Mobile workspace for Gold, WTI crude oil and Silver. GitHub Pages serves the repository root on `main`. The private Sites deployment serves the same workspace files from `dist/`.

## Start on your phone

1. Open Markets and pick a chart. Match the instrument in Trading 212.
2. Open Account and import your History → Export CSV.
3. Save your entry, stop and target. Enter the broker's buy quote, then check risk and size.

Plans stay in this browser. Setup includes plan download and import for moving between hosts. The original tools use browser-local keys on the existing GitHub Pages address. On that same address, `workflow.html` can still read them. CSV imports stay in the current tab. No broker login details are needed.

## Repository upgrade order

| Priority | Exact paths in GitHub | Action |
| --- | --- | --- |
| P0 | `index.html`, `styles.css`, `app.js`, `workflow.html` | Merge after checking the phone layout and the original tools. Keep Pages on `main / (root)`. |
| P0 | `trading-core.js` | Check a fresh Trading 212 export against the closed-position history. Verify any explicit snapshot fields against the broker. |
| P1 | Proposed `services/quotes.js`, existing `app.js` | Add a licensed server-side quote feed with explicit symbols, timestamps and stale-data handling. |
| P2 | Proposed `services/alerts.js`, `services/news.js` | Add a separately hosted scheduler, push delivery and a licensed news feed. |

## CSV support

Standard Trading 212 CFD history contains closed activity. The importer recognises both spaced and underscored record types and displays results using the currency reported by the file. The history importer does not infer a cash balance from transactions or reconstruct holdings from orders.

For a separately prepared snapshot CSV, use `Record Type,Instrument,Units,Account Balance,Account Currency,As Of`. Use one `ACCOUNT_SNAPSHOT` row for balance and one `OPEN_POSITION` row per reported position. Include the currency and snapshot time. These rows are optional and remain file snapshots. The official Trading 212 public API supports Invest and Stocks ISA accounts.

TradingView charts may be delayed or unavailable. Buy or Wait uses a manual broker quote, expires the check after two minutes, and compares it to a saved long setup. Size estimates use broker inputs and exclude costs, gaps and margin. The site does not send orders or run background alerts.
