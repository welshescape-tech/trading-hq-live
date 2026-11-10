import {isPlan, checkEntry, sizeTrade, parseTradingCsv} from './trading-core.js';

const byId = id => document.getElementById(id);
const markets = {
  gold: {name:'Gold', symbol:'XAUUSD'},
  wti: {name:'WTI crude oil', symbol:'WTICOUSD'},
  silver: {name:'Silver', symbol:'XAGUSD'}
};
const planKey = 'tradinghq-commodity-plans-v1';
const localTime = new Intl.DateTimeFormat('en-GB', {timeStyle:'short', timeZone:'Europe/London'});
const number = new Intl.NumberFormat('en-GB', {maximumSignificantDigits:12});
const money = (value, currency = 'GBP') => new Intl.NumberFormat('en-GB', {style:'currency', currency}).format(value);
const positive = value => Number.isFinite(value) && value > 0;
let selected = 'gold';
let interval = '15';
let quote = null;
let quoteTime = null;
let plans = {};
let currentImport = null;
let importRequest = 0;

function validatePlans(data) {
  if (data?.format !== planKey || !data.plans || typeof data.plans !== 'object' || Array.isArray(data.plans)) {
    throw Error('Choose a Trading HQ plan file.');
  }
  const entries = Object.entries(data.plans);
  if (entries.some(([market, plan]) => !Object.hasOwn(markets, market) || !isPlan(plan))) {
    throw Error('This file contains invalid levels.');
  }
  return Object.fromEntries(entries);
}

try {
  const saved = localStorage.getItem(planKey);
  if (saved) plans = validatePlans(JSON.parse(saved));
} catch {
  byId('level-status').textContent = 'Saved levels could not be loaded in this browser.';
}

function persistPlans(next) {
  localStorage.setItem(planKey, JSON.stringify({format:planKey, plans:next}));
  plans = next;
}

function showPage() {
  const hash = location.hash.slice(1);
  const page = ['markets', 'account', 'setup'].includes(hash) ? hash : 'markets';
  document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== page; });
  document.querySelectorAll('.nav a').forEach(link => {
    if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (page === 'markets' && !byId('market-chart').hasAttribute('src')) showChart();
  if (hash) window.scrollTo(0, 0);
}

function showChart() {
  const {name, symbol} = markets[selected];
  byId('market-name').textContent = name;
  byId('full-chart').href = 'https://www.tradingview.com/symbols/' + symbol + '/?exchange=OANDA';
  const frame = byId('market-chart');
  frame.title = 'TradingView ' + name + ' chart';
  const options = new URLSearchParams({symbol:'OANDA:' + symbol, interval, theme:'dark', hidesidetoolbar:'1', symboledit:'0', timezone:'Europe/London', withdateranges:'0'});
  frame.src = 'https://s.tradingview.com/widgetembed/?' + options;
}

function showDecision() {
  const plan = plans[selected];
  const stale = quoteTime && Date.now() - quoteTime.getTime() >= 120000;
  const result = checkEntry(plan, stale ? null : quote);
  const tag = byId('decision-tag');
  tag.textContent = result.buy ? 'BUY SETUP' : 'WAIT';
  tag.classList.toggle('good', result.buy);
  byId('decision-reason').textContent = result.reason;
  byId('quote-status').textContent = quoteTime
    ? (stale ? 'Refresh this quote · ' : 'Manually checked · ') + localTime.format(quoteTime) + ' UK'
    : 'Manual check. The chart does not supply this number.';
}

function resetRisk(clearContract = false) {
  byId('risk-result').textContent = 'Save a plan and enter the broker’s contract details to check size.';
  if (clearContract) ['point','step','minimum','units'].forEach(id => { byId(id).value = ''; });
}

function showPlan() {
  const plan = plans[selected];
  ['instrument','entry','stop','target'].forEach(id => { byId(id).value = plan?.[id] ?? ''; });
  byId('quote').value = '';
  quote = null;
  quoteTime = null;
  showDecision();
  resetRisk(true);
}

document.querySelectorAll('[data-market]').forEach(button => {
  button.onclick = () => {
    if (selected === button.dataset.market) return;
    selected = button.dataset.market;
    document.querySelectorAll('[data-market]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    byId('level-status').textContent = 'Long setup. Levels are saved in this browser.';
    showPlan();
    showChart();
  };
});
document.querySelectorAll('[data-interval]').forEach(button => {
  button.onclick = () => {
    if (interval === button.dataset.interval) return;
    interval = button.dataset.interval;
    document.querySelectorAll('[data-interval]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    showChart();
  };
});
byId('levels-form').onsubmit = event => {
  event.preventDefault();
  const next = {instrument:byId('instrument').value.trim(), entry:byId('entry').valueAsNumber, stop:byId('stop').valueAsNumber, target:byId('target').valueAsNumber};
  if (!isPlan(next)) {
    byId('level-status').textContent = 'For a buy setup, enter positive levels with stop below entry and target above it.';
    return;
  }
  const instrumentChanged = next.instrument !== plans[selected]?.instrument;
  try {
    persistPlans({...plans, [selected]:next});
    showDecision();
    resetRisk(instrumentChanged);
    if (instrumentChanged) {
      quote = null; quoteTime = null; byId('quote').value = ''; showDecision();
    }
    byId('level-status').textContent = 'Saved for ' + markets[selected].name + ' on this browser.';
  } catch {
    byId('level-status').textContent = 'This browser blocked saving. Check your storage settings.';
  }
};
byId('price-form').onsubmit = event => {
  event.preventDefault();
  const value = byId('quote').valueAsNumber;
  if (!positive(value)) {
    byId('quote-status').textContent = 'Enter a positive broker buy quote.';
    return;
  }
  quote = value;
  quoteTime = new Date();
  showDecision();
};
byId('quote').oninput = () => { quote = null; quoteTime = null; showDecision(); };
setInterval(() => { if (quoteTime) showDecision(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) showDecision(); });

byId('risk-form').oninput = () => resetRisk();
byId('risk-form').onsubmit = event => {
  event.preventDefault();
  const val = id => byId(id).valueAsNumber;
  try {
    const size = sizeTrade(plans[selected], {equity:val('equity'), percent:val('risk'), point:val('point'), step:val('step'), minimum:val('minimum'), units:byId('units').value === '' ? null : val('units')});
    const max = size.minimumFits ? 'Max size ' + number.format(size.maxUnits) + ' units.' : 'The broker minimum exceeds your limit.';
    let result = 'Risk budget ' + money(size.budget) + '. ' + max;
    if (size.plannedLoss !== null) {
      result += ' Planned loss at stop ' + money(size.plannedLoss) + '.';
      if (!size.validSize) result += ' Size fails the minimum or increment check.';
      if (size.overBudget) result += ' Above your risk budget.';
    }
    byId('risk-result').textContent = result;
  } catch (error) { byId('risk-result').textContent = error.message; }
};

function drawRecords(id, records, describe, empty) {
  const element = byId(id);
  element.replaceChildren();
  if (!records.length) {
    if (empty) { const p = document.createElement('p'); p.textContent = empty; element.append(p); }
    return;
  }
  const list = document.createElement('ul');
  list.className = 'record-list';
  records.forEach(record => {
    const item = document.createElement('li');
    const title = document.createElement('b');
    const detail = document.createElement('small');
    title.textContent = record.instrument;
    detail.textContent = describe(record);
    item.append(title, detail);
    list.append(item);
  });
  element.append(list);
}
function drawJournal() {
  const query = byId('journal-filter').value.trim().toLowerCase();
  const matches = (currentImport?.closed ?? []).filter(record => record.instrument.toLowerCase().includes(query));
  byId('closed-summary').textContent = matches.length > 50 ? '· latest 50 of ' + matches.length : '· ' + matches.length;
  drawRecords('journal-list', matches.slice(-50).reverse(), record =>
    [record.date, record.result === null ? 'P&L absent' : record.currency ? money(record.result, record.currency) : number.format(record.result) + ' (currency absent)'].filter(Boolean).join(' · '),
    'No matching closed positions.');
}
function showAccount() {
  const balance = currentImport?.balance;
  byId('account-balance').textContent = balance ? money(balance.value, balance.currency) : '—';
  byId('balance-note').textContent = balance ? (balance.date ? 'CSV as of ' + balance.date : 'CSV snapshot · date absent') :
    currentImport?.balanceConflict ? 'Multiple snapshots in this file. Choose one snapshot.' : 'Available when explicitly included in the file.';
  const open = currentImport?.open ?? [];
  byId('account-open').textContent = open.length || '—';
  byId('open-note').textContent = open.length ? 'Reported rows from this file.' : currentImport?.explicitOpen ?
    'Open rows found without a usable instrument.' : 'Check Trading 212. History does not show current positions.';
  byId('account-closed').textContent = currentImport ? String(currentImport.closed.length) : '—';
  byId('use-balance').hidden = !(balance?.currency === 'GBP' && balance.value > 0);
  byId('import-journal').hidden = !currentImport?.closed.length;
  drawRecords('open-list', open.slice(0,50), record => [record.units + ' units', record.date].filter(Boolean).join(' · '));
  if (open.length > 50) {
    const note = document.createElement('p'); note.textContent = 'Showing 50 of ' + open.length + ' reported rows.'; byId('open-list').append(note);
  }
  drawJournal();
}

byId('csv-file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  const request = ++importRequest;
  byId('csv-status').textContent = 'Reading file…';
  try {
    if (file.size > 20 * 1024 * 1024) throw Error('Choose a CSV under 20 MB.');
    const parsed = parseTradingCsv(await file.text());
    if (request !== importRequest) return;
    currentImport = parsed;
    byId('journal-filter').value = '';
    byId('csv-status').textContent = file.name + ' · ' + parsed.records + ' rows read' +
      (parsed.malformed ? ' · ' + parsed.malformed + ' incomplete rows skipped or omitted from the snapshot.' : '.');
  } catch (error) {
    if (request !== importRequest) return;
    currentImport = null;
    byId('csv-status').textContent = error.message;
  }
  showAccount();
};
byId('clear-csv').onclick = () => {
  importRequest++;
  currentImport = null;
  byId('csv-file').value = '';
  byId('csv-status').textContent = 'Import cleared.';
  showAccount();
};
byId('journal-filter').oninput = drawJournal;
byId('use-balance').onclick = () => {
  byId('equity').value = currentImport.balance.value;
  resetRisk();
  byId('risk-result').textContent = 'Copied the CSV balance. Check current equity in Trading 212 before sizing.';
  location.hash = 'markets';
  byId('risk-panel').open = true;
  requestAnimationFrame(() => byId('equity').focus());
};

byId('export-plans').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({format:planKey, plans}, null, 2)], {type:'application/json'}));
  const link = document.createElement('a');
  link.href = url; link.download = 'trading-hq-plans.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
byId('import-plans').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 65536) throw Error('Choose a Trading HQ plan file under 64 KB.');
    const next = validatePlans(JSON.parse(await file.text()));
    if (Object.keys(plans).length && !window.confirm('Replace the plans saved in this browser?')) return;
    persistPlans(next);
    showPlan();
    byId('transfer-status').textContent = 'Plans imported.';
  } catch (error) {
    byId('transfer-status').textContent = error instanceof SyntaxError ? 'Choose a valid Trading HQ plan file.' : error.message;
  } finally { event.target.value = ''; }
};

window.addEventListener('hashchange', showPage);
showPlan();
showPage();
