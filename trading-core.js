const positive = value => Number.isFinite(value) && value > 0;
const typeKey = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export function isPlan(plan) {
  return Boolean(plan && typeof plan.instrument === 'string' && plan.instrument.trim() &&
    plan.instrument.length <= 70 && [plan.stop, plan.entry, plan.target].every(positive) &&
    plan.stop < plan.entry && plan.entry < plan.target);
}

export function checkEntry(plan, quote) {
  if (!isPlan(plan)) return { buy: false, reason: 'Save an entry, stop and target first.' };
  if (!positive(quote)) return { buy: false, reason: 'Check a fresh broker quote against your saved plan.' };
  if (quote <= plan.stop) return { buy: false, reason: 'Price is at or below your stop. The setup is invalid.' };
  if (quote >= plan.target) return { buy: false, reason: 'Price is at or above your target. The planned move has already happened.' };
  if (quote > plan.entry) return { buy: false, reason: 'Price is above your entry. Wait for your level.' };
  return { buy: true, reason: 'Price is at or below entry and above your stop. Check size and margin before deciding.' };
}

export function sizeTrade(plan, {equity, percent, point, step, minimum, units}) {
  if (!isPlan(plan)) throw Error('Save valid levels first.');
  if (![equity, percent, point, step, minimum].every(positive) || percent > 100 ||
      (units !== null && !positive(units))) throw Error('Enter positive numbers and a risk limit up to 100%.');
  const budget = equity * percent / 100;
  const unitRisk = (plan.entry - plan.stop) * point;
  const raw = budget / unitRisk;
  if (![budget, unitRisk, raw, raw / step].every(positive)) throw Error('Check the scale of the broker inputs.');
  const increments = Math.floor(raw / step);
  if (!Number.isSafeInteger(increments)) throw Error('Check the order size increment.');
  const maxUnits = Number((increments * step).toPrecision(15));
  const minimumFits = maxUnits >= minimum;
  const plannedLoss = units === null ? null : units * unitRisk;
  const validSize = units === null || (units >= minimum &&
    Math.abs(units / step - Math.round(units / step)) < 1e-8);
  return {budget, maxUnits, minimumFits, plannedLoss, validSize, overBudget: plannedLoss > budget + 1e-10};
}

function parseRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell); cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = []; cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw Error('The CSV ends inside a quoted field.');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function readNumber(raw) {
  let value = String(raw ?? '').trim();
  if (/^\(.*\)$/.test(value)) value = '-' + value.slice(1, -1);
  value = value.replace(/[£$€]/g, '').trim();
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) value = value.replaceAll(',', '');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value))
    ? Number(value) : null;
}

export function parseTradingCsv(source) {
  const rows = parseRows(source.replace(/^\uFEFF/, ''));
  const headers = (rows.shift() ?? []).map(typeKey);
  const col = (...names) => names.map(name => headers.indexOf(typeKey(name))).find(index => index >= 0) ?? -1;
  const action = col('record type', 'action', 'type');
  const status = col('position status');
  const balanceColumn = col('account balance (account currency)', 'account balance', 'account balance (GBP)');
  const result = col('total result (account currency)', 'result (GBP)', 'p/l (GBP)', 'result', 'profit/loss', 'realised p/l', 'realized p/l');
  const currencyColumn = col('account currency', 'currency (result)', 'currency');
  const instrument = col('instrument', 'name', 'ticker', 'symbol');
  const units = col('units', 'quantity', 'no. of shares');
  const closedDate = col('date closed (UTC)');
  const date = col('as of', 'time', 'date', 'created on', 'execution time');
  if (!headers.length || (action < 0 && status < 0 && balanceColumn < 0)) throw Error('Choose a Trading 212 history CSV or an explicitly labelled snapshot CSV.');
  const closed = [], open = [];
  let balance = null;
  let balanceSeen = false;
  let balanceConflict = false;
  let malformed = 0;
  let explicitOpen = false;
  for (const row of rows) {
    if (row.length !== headers.length) { malformed++; continue; }
    const kind = typeKey(row[action]);
    const positionStatus = typeKey(row[status]);
    const recordDate = row[date]?.trim() || '';
    const curr = row[currencyColumn]?.trim().toUpperCase();
    const fallback = headers[result]?.endsWith('gbp') ? 'GBP' : '';
    const currency = /^[A-Z]{3}$/.test(curr ?? '') ? curr : fallback;
    const name = row[instrument]?.trim();
    if (['closedposition','closedpositions','positionclosed','closeposition'].includes(kind) || positionStatus === 'closed') {
      closed.push({instrument:name || 'Unknown instrument', date:row[closedDate]?.trim() || recordDate, currency, result:readNumber(row[result])});
    }
    if (['openposition','openpositions','positionopen'].includes(kind) || positionStatus === 'open') {
      explicitOpen = true;
      if (name) open.push({instrument:name, units:row[units]?.trim() || '—', date:recordDate});
      else malformed++;
    }
    if (['accountsnapshot','balancesnapshot','accountbalance'].includes(kind) || (action < 0 && status < 0 && rows.length === 1)) {
      balanceSeen = true;
      const value = readNumber(row[balanceColumn]);
      const balanceCurrency = /^[A-Z]{3}$/.test(curr ?? '') ? curr : headers[balanceColumn]?.endsWith('gbp') ? 'GBP' : '';
      if (value === null || !balanceCurrency) continue;
      if (!balance) balance = {value, currency:balanceCurrency, date:recordDate};
      else if (value !== balance.value || balanceCurrency !== balance.currency || recordDate !== balance.date) balanceConflict = true;
    }
  }
  closed.sort((a, b) => a.date.localeCompare(b.date));
  return {records:rows.length, closed, open, explicitOpen, balance:balanceConflict ? null : balance, balanceSeen, balanceConflict, malformed};
}
