import { SURVEY, QUESTIONS, SEGMENTS, summarize, filterResponses, wideRows, pickRows, contactRows, toCsv } from '/shared/report.js';

const main = document.getElementById('main');
const statusEl = document.getElementById('status');
const TOKEN_KEY = 'tucker-survey-admin-token';

let responses = [];
let contacts = [];
const filters = {};

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const token = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };

async function fetchAll(kind) {
  const items = [];
  for (let offset = 0; ; offset += 200) {
    const res = await fetch(`/admin/api/entries?kind=${kind}&offset=${offset}&limit=200`, { headers: { authorization: `Bearer ${token()}` } });
    if (res.status === 401) throw Object.assign(new Error('unauthorized'), { auth: true });
    if (!res.ok) throw new Error(`Loading ${kind} failed (${res.status})`);
    const page = await res.json();
    items.push(...page.items);
    if (offset + 200 >= page.count || page.items.length === 0) return items;
  }
}

async function loadData() {
  statusEl.textContent = 'Loading…';
  try {
    [responses, contacts] = await Promise.all([fetchAll('resp'), fetchAll('contact')]);
    responses.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    statusEl.textContent = `Loaded ${new Date().toLocaleTimeString()}`;
    renderReport();
  } catch (err) {
    statusEl.textContent = '';
    if (err.auth) { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } renderLogin('That token was not accepted.'); }
    else main.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'error' }, err.message), h('button', { class: 'btn btn-primary', onclick: loadData }, 'Retry')));
  }
}

function renderLogin(message) {
  const input = h('input', { class: 'input', type: 'password', id: 'tok', autocomplete: 'current-password', required: true });
  main.replaceChildren(h('form', { class: 'card', style: 'max-width:420px;margin:40px auto', onsubmit: (e) => {
    e.preventDefault();
    try { sessionStorage.setItem(TOKEN_KEY, input.value.trim()); } catch { /* ignore */ }
    loadData();
  } },
  h('h1', {}, 'Survey results'),
  h('label', { class: 'q-label', for: 'tok' }, 'Admin token'),
  input,
  message && h('p', { class: 'error', role: 'alert' }, message),
  h('div', { class: 'actions' }, h('span'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Open results'))));
  input.focus();
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pct = (x) => `${Math.round(x * 100)}%`;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function renderReport() {
  const segQs = Object.fromEntries(QUESTIONS.filter((q) => SEGMENTS.includes(q.id)).map((q) => [q.id, q]));
  const toolbar = h('div', { class: 'toolbar' },
    SEGMENTS.map((id) => {
      const q = segQs[id];
      const sel = h('select', { onchange: (e) => { filters[id] = e.target.value; renderReport(); } },
        h('option', { value: '' }, 'All'),
        [...q.options, ...(q.other ? [['other', 'Other']] : [])].map(([v, l]) => h('option', { value: v, selected: filters[id] === v }, l)));
      return h('label', {}, q.id === 'operatesCache' ? 'Operates caches' : q.id === 'networkType' ? 'Network type' : 'Role', sel);
    }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn-ghost', onclick: loadData }, 'Refresh'),
    h('button', { class: 'btn btn-ghost', onclick: () => download('responses.json', JSON.stringify({ responses, contacts }, null, 2), 'application/json') }, 'JSON'),
    h('button', { class: 'btn btn-ghost', onclick: () => download('responses.csv', toCsv(wideRows(responses)), 'text/csv') }, 'Responses CSV'),
    h('button', { class: 'btn btn-ghost', onclick: () => download('picks.csv', toCsv(pickRows(responses)), 'text/csv') }, 'Picks CSV'),
    h('button', { class: 'btn btn-ghost', onclick: () => download('contacts.csv', toCsv(contactRows(contacts)), 'text/csv') }, `Contacts CSV (${contacts.length})`),
  );

  const set = filterResponses(responses, filters);
  const durations = set.map((r) => r.meta?.durationSec).filter(Number.isFinite);
  const stats = h('div', { class: 'stats' },
    h('div', { class: 'stat' }, h('b', {}, set.length), h('span', {}, set.length === responses.length ? 'responses' : `of ${responses.length} responses`)),
    h('div', { class: 'stat' }, h('b', {}, set.filter((r) => r.answers?.operatesCache === 'yes').length), h('span', {}, 'operate embedded caches')),
    h('div', { class: 'stat' }, h('b', {}, durations.length ? `${Math.round(median(durations) / 60)} min` : '–'), h('span', {}, 'median time to complete')),
    h('div', { class: 'stat' }, h('b', {}, contacts.length), h('span', {}, 'open to follow-up (all)')),
  );

  const sections = SURVEY.sections.map((s) => {
    const qs = QUESTIONS.filter((q) => q.section.id === s.id);
    if (!qs.length) return null;
    return h('section', { class: 'card report-section' }, h('h2', {}, s.title), qs.map((q) => renderQuestion(q, set)));
  });

  main.replaceChildren(toolbar, stats, ...sections.filter(Boolean));
}

function barRow(labelText, fraction, num, extraClass = '') {
  return h('div', { class: 'bar-row' },
    h('span', {}, labelText),
    h('span', { class: 'bar-track' }, h('span', { class: `bar-fill ${extraClass}`, style: `width:${(fraction * 100).toFixed(1)}%` })),
    h('span', { class: 'bar-num' }, num));
}

function renderQuestion(q, set) {
  const s = summarize(q, set);
  const box = h('div', { class: 'report-q' }, h('h3', {}, q.label));

  if (s.items) {
    box.append(h('p', { class: 'meta' }, `${s.answered} answered`,
      q.type === 'rank' ? ` · sorted by rank points (1st = ${q.max} pts … ${q.max}th = 1 pt); bar = % who picked it in their top ${q.max}` : ''));
    box.append(h('div', { class: 'bars' }, s.items.filter((i) => i.count || q.type !== 'rank').map((i) =>
      q.type === 'rank'
        ? barRow(i.label, i.pct, `${i.points} pts · ${pct(i.pct)}`)
        : barRow(i.label, i.pct, `${i.count} · ${pct(i.pct)}`))));
    if (q.type === 'rank' && s.items.every((i) => !i.count)) box.append(h('p', { class: 'meta' }, 'No answers yet.'));
    if (s.others.length) box.append(h('details', {}, h('summary', {}, `“Other” answers (${s.others.length})`), h('ul', { class: 'texts-list' }, s.others.map((t) => h('li', {}, t)))));
  } else if (s.rows) {
    box.append(h('div', { class: 'legend' }, q.scale.map((l, i) => h('span', {}, h('i', { class: `s${i}` }), l))));
    box.append(h('div', { class: 'bars' }, s.rows.map((r) => h('div', { class: 'bar-row' },
      h('span', {}, r.label),
      h('span', { class: 'bar-track', title: q.scale.map((l, i) => `${l}: ${r.counts[i]}`).join(' · ') },
        r.counts.map((c, i) => h('span', { class: `bar-fill s${i}`, style: `width:${r.answered ? (c / r.answered) * 100 : 0}%` }))),
      h('span', { class: 'bar-num' }, r.answered ? `avg ${r.mean.toFixed(2)} · n=${r.answered}` : 'n=0')))));
  } else {
    box.append(s.answers.length
      ? h('details', {}, h('summary', {}, `${s.answers.length} answers`), h('ol', { class: 'texts-list' }, s.answers.map((a) => h('li', {}, a.text))))
      : h('p', { class: 'meta' }, 'No answers yet.'));
  }
  return box;
}

if (token()) loadData(); else renderLogin();
