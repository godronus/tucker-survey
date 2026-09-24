import { SURVEY, LIMITS, visible, validateAnswers } from '/shared/survey.js';

const STORE_KEY = `tucker-survey:v${SURVEY.version}`;
const app = document.getElementById('app');

// ---------- state (autosaved to localStorage) ----------

function newId() {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${rand}`;
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.id && s.answers) return s;
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return null;
}

let state = load() || { id: newId(), answers: {}, step: 'intro', token: null };

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    document.getElementById('saved').textContent = 'Progress saved in this browser';
  } catch {
    document.getElementById('saved').textContent = '';
  }
}

function setAnswer(id, value) {
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
  if (empty) delete state.answers[id];
  else state.answers[id] = value;
  save();
  refreshConditionals();
  updateProgress();
}

async function ensureToken(force = false) {
  if (state.token && !force) return state.token;
  const res = await fetch('/api/token');
  if (!res.ok) throw new Error('token');
  state.token = (await res.json()).token;
  save();
  return state.token;
}

// ---------- tiny DOM helper ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

// ---------- navigation ----------

const visibleSections = () => SURVEY.sections.filter((s) => visible(s.showIf, state.answers));

function go(step) {
  state.step = step;
  save();
  render();
  document.getElementById('main').focus();
  window.scrollTo(0, 0);
}

function render() {
  app.replaceChildren();
  const progress = document.getElementById('progress');
  if (state.step === 'intro') { progress.hidden = true; return renderIntro(); }
  if (state.step === 'done') { progress.hidden = true; return renderDone(); }

  const sections = visibleSections();
  let idx = sections.findIndex((s) => s.id === state.step);
  if (idx < 0) { idx = 0; state.step = sections[0].id; }
  progress.hidden = false;
  updateProgress();
  renderSection(sections[idx], idx, sections.length);
}

/** Section count changes live when an answer adds or removes a section. */
function updateProgress() {
  const sections = visibleSections();
  const idx = sections.findIndex((s) => s.id === state.step);
  if (idx < 0) return;
  document.getElementById('progress-fill').style.width = `${Math.round(((idx + 1) / sections.length) * 100)}%`;
  document.getElementById('progress-label').textContent = `Section ${idx + 1} of ${sections.length}`;
}

function renderIntro() {
  const resumed = Object.keys(state.answers).length > 0;
  app.append(h('section', { class: 'card intro' },
    h('p', { class: 'eyebrow' }, 'ISP · IXP · Embedded cache partners'),
    h('h1', {}, SURVEY.title),
    SURVEY.intro.map((p) => h('p', {}, p)),
    h('ul', { class: 'facts' },
      h('li', {}, h('strong', {}, '5–8 minutes')),
      h('li', {}, h('strong', {}, 'Anonymous'), ' by default'),
      h('li', {}, 'Answers are ', h('strong', {}, 'saved as you go')),
    ),
    h('div', { class: 'actions' },
      resumed && h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
        if (!confirm('Discard your saved answers and start over?')) return;
        state = { id: newId(), answers: {}, step: 'intro', token: null };
        save(); render();
      } }, 'Start over'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go(visibleSections()[0].id) },
        resumed ? 'Continue where you left off' : 'Start the survey'),
    ),
  ));
}

function renderDone() {
  app.append(h('section', { class: 'card done', role: 'status' },
    h('div', { class: 'done-mark', 'aria-hidden': 'true' }, '✓'),
    h('h1', {}, 'Response received'),
    h('p', { class: 'lead' }, SURVEY.outro),
  ));
}

let currentQuestions = [];

function renderSection(section, idx, total) {
  const last = idx === total - 1;
  const form = h('form', { class: 'card section', novalidate: true, 'aria-labelledby': `h-${section.id}` });
  form.append(
    h('p', { class: 'eyebrow' }, `Section ${idx + 1}`),
    h('h1', { id: `h-${section.id}` }, section.title),
  );
  if (section.intro) form.append(h('p', { class: 'lead' }, section.intro));

  currentQuestions = section.questions.map((q) => {
    const wrap = h('div', { class: 'q', id: `q-${q.id}`, 'data-q': q.id });
    wrap.append(renderQuestion(q));
    wrap.append(h('p', { class: 'error', id: `err-${q.id}`, role: 'alert' }));
    form.append(wrap);
    return { q, wrap };
  });

  // Honeypot on the last page only; hidden from humans and assistive tech.
  if (last) {
    form.append(h('div', { class: 'hp', 'aria-hidden': 'true' },
      h('label', { for: 'website' }, 'Website'),
      h('input', { id: 'website', name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' })));
  }

  const status = h('p', { class: 'form-status', id: 'form-status', role: 'status' });
  form.append(status, h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
      const secs = visibleSections();
      const i = secs.findIndex((s) => s.id === section.id);
      go(i > 0 ? secs[i - 1].id : 'intro');
    } }, 'Back'),
    h('button', { type: 'submit', class: 'btn btn-primary' }, last ? 'Submit response' : 'Next'),
  ));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!showErrors()) return;
    if (!last) {
      const secs = visibleSections();
      return go(secs[secs.findIndex((s) => s.id === section.id) + 1].id);
    }
    await submit(form, status);
  });

  app.append(form);
  refreshConditionals();
}

function refreshConditionals() {
  for (const { q, wrap } of currentQuestions) {
    wrap.hidden = !visible(q.showIf, state.answers);
  }
}

/** Show inline errors for the current section. Returns true if it is valid. */
function showErrors() {
  const { errors } = validateAnswers(state.answers);
  let first = null;
  for (const { q, wrap } of currentQuestions) {
    const msg = wrap.hidden ? '' : errors[q.id] || '';
    setError(q.id, msg);
    if (msg && !first) first = wrap;
  }
  if (first) {
    first.scrollIntoView({ block: 'center' });
    first.querySelector('input, textarea, button')?.focus({ preventScroll: true });
  }
  return !first;
}

function setError(id, msg) {
  const err = document.getElementById(`err-${id}`);
  if (!err) return;
  err.textContent = msg;
  const wrap = document.getElementById(`q-${id}`);
  wrap.classList.toggle('has-error', !!msg);
  wrap.querySelectorAll('input, textarea, fieldset').forEach((el) => {
    if (msg) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });
}

// ---------- submission ----------

async function submit(form, status) {
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  status.className = 'form-status';
  status.textContent = 'Submitting…';

  const send = async () => fetch('/api/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: state.id,
      token: await ensureToken(),
      website: form.querySelector('#website')?.value || '',
      answers: state.answers,
    }),
  });

  try {
    let res = await send();
    let data = await res.json().catch(() => ({}));
    if (data.error === 'token_invalid' || data.error === 'token_expired') {
      await ensureToken(true);
      res = await send();
      data = await res.json().catch(() => ({}));
    }
    // Anti-bot minimum fill time, or the tail end of the per-IP window:
    // a short wait is friendlier than an error.
    if ((data.error === 'token_too_fast' || data.error === 'rate_limited') && data.retryAfter <= 30) {
      await new Promise((r) => setTimeout(r, data.retryAfter * 1000 + 500));
      res = await send();
      data = await res.json().catch(() => ({}));
    }
    if (res.ok) {
      try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      state = { id: newId(), answers: {}, step: 'done', token: null };
      document.getElementById('saved').textContent = '';
      render();
      document.getElementById('main').focus();
      return;
    }
    if (data.error === 'invalid' && data.fields) {
      const bad = Object.keys(data.fields)[0];
      const sec = SURVEY.sections.find((s) => s.questions.some((q) => q.id === bad));
      go(sec.id);
      setError(bad, data.fields[bad]);
      return;
    }
    const messages = {
      token_too_fast: 'That was quick! Please check your answers, then submit again.',
      token_expired: 'This page has been open too long. Please reload it (your answers are kept) and submit again.',
      rate_limited: `Someone on your network submitted a response in the last few minutes, and we accept one at a time per network. Your answers are saved in this browser; please submit again in about ${Math.max(1, Math.ceil((data.retryAfter || 300) / 60))} minute(s).`,
    };
    throw new Error(messages[data.error] || '');
  } catch (err) {
    status.className = 'form-status is-error';
    status.textContent = err.message ||
      'We couldn’t save your response. Your answers are kept in this browser; please try again in a moment.';
    button.disabled = false;
  }
}

// ---------- question renderers ----------

function labelFor(q) {
  return [q.label, q.required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *'), q.hint && h('span', { class: 'hint' }, ` (${q.hint})`)];
}

function renderQuestion(q) {
  switch (q.type) {
    case 'single': return choiceQ(q, 'radio');
    case 'multi': return choiceQ(q, 'checkbox');
    case 'rank': return rankQ(q);
    case 'matrix': return matrixQ(q);
    case 'texts': return textsQ(q);
    default: return textQ(q);
  }
}

function describedBy(q) { return `err-${q.id}`; }

function otherInput(q, shown) {
  const input = h('input', {
    type: 'text', class: 'input other-input', id: `${q.id}Other`, maxlength: LIMITS.text,
    'aria-label': `${q.label}: other, please specify`, placeholder: 'Please specify',
    value: state.answers[`${q.id}Other`] || '',
    oninput: (e) => setAnswer(`${q.id}Other`, e.target.value),
  });
  input.hidden = !shown;
  return input;
}

function choiceQ(q, type) {
  const current = state.answers[q.id];
  const has = (v) => (type === 'radio' ? current === v : (current || []).includes(v));
  const options = q.other ? [...q.options, ['other', 'Other']] : q.options;
  const other = q.other && otherInput(q, has('other'));
  const counter = q.max && h('p', { class: 'counter', 'aria-live': 'polite' });

  const fs = h('fieldset', { 'aria-describedby': describedBy(q), 'aria-required': q.required ? 'true' : null },
    h('legend', {}, labelFor(q)));
  const grid = h('div', { class: `choices ${options.length > 6 ? 'choices-2col' : ''}` });

  const sync = () => {
    const sel = state.answers[q.id] || [];
    if (other) other.hidden = !(type === 'radio' ? sel === 'other' : sel.includes('other'));
    if (q.max) {
      counter.textContent = `${sel.length} of ${q.max} chosen`;
      grid.querySelectorAll('input').forEach((i) => { i.disabled = !i.checked && sel.length >= q.max; });
    }
  };

  for (const [value, label] of options) {
    const id = `${q.id}-${value}`;
    grid.append(h('label', { class: 'choice', for: id },
      h('input', {
        type, id, name: q.id, value, checked: has(value),
        onchange: (e) => {
          if (type === 'radio') {
            setAnswer(q.id, value);
          } else {
            let sel = (state.answers[q.id] || []).filter((v) => v !== value);
            if (e.target.checked) {
              if (q.exclusive === value) sel = [];
              else sel = sel.filter((v) => v !== q.exclusive);
              sel.push(value);
            }
            grid.querySelectorAll('input').forEach((i) => { i.checked = sel.includes(i.value); });
            setAnswer(q.id, sel);
          }
          sync();
          setError(q.id, '');
        },
      }),
      h('span', {}, label)));
  }
  fs.append(grid);
  if (other) fs.append(other);
  if (counter) fs.append(counter);
  queueMicrotask(sync);
  return fs;
}

function rankQ(q) {
  const labels = Object.fromEntries(q.options);
  const fs = h('fieldset', { class: 'rank', 'aria-describedby': `${describedBy(q)} ${q.id}-help`, 'aria-required': q.required ? 'true' : null },
    h('legend', {}, labelFor(q)));
  const help = h('p', { class: 'hint-block', id: `${q.id}-help` }, `Select up to ${q.max}. The order you pick them in is your ranking; reorder below.`);
  const picked = h('ol', { class: 'rank-list', 'aria-label': `Your top ${q.max}, in order` });
  const counter = h('p', { class: 'counter', 'aria-live': 'polite' });
  const grid = h('div', { class: 'choices choices-2col' });

  const sel = () => state.answers[q.id] || [];
  const update = (next) => { setAnswer(q.id, next); sync(); setError(q.id, ''); };
  const move = (i, d) => { const s = [...sel()]; [s[i], s[i + d]] = [s[i + d], s[i]]; update(s); picked.querySelectorAll('li')[i + d]?.querySelector(d < 0 ? '.up' : '.down')?.focus(); };

  function sync() {
    const s = sel();
    counter.textContent = `${s.length} of ${q.max} chosen`;
    grid.querySelectorAll('input').forEach((i) => {
      const pos = s.indexOf(i.value);
      i.checked = pos >= 0;
      i.disabled = pos < 0 && s.length >= q.max;
      i.closest('label').querySelector('.badge').textContent = pos >= 0 ? pos + 1 : '';
    });
    picked.replaceChildren(...s.map((v, i) => h('li', {},
      h('span', { class: 'rank-n', 'aria-hidden': 'true' }, i + 1),
      h('span', { class: 'rank-label' }, labels[v]),
      h('span', { class: 'rank-tools' },
        h('button', { type: 'button', class: 'icon up', 'aria-label': `Move ${labels[v]} up`, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        h('button', { type: 'button', class: 'icon down', 'aria-label': `Move ${labels[v]} down`, disabled: i === s.length - 1, onclick: () => move(i, 1) }, '↓'),
        h('button', { type: 'button', class: 'icon', 'aria-label': `Remove ${labels[v]}`, onclick: () => update(s.filter((x) => x !== v)) }, '✕')),
    )));
    picked.hidden = s.length === 0;
  }

  for (const [value, label] of q.options) {
    const id = `${q.id}-${value}`;
    grid.append(h('label', { class: 'choice', for: id },
      h('input', { type: 'checkbox', id, value, onchange: (e) => {
        const s = sel().filter((v) => v !== value);
        if (e.target.checked) s.push(value);
        update(s);
      } }),
      h('span', { class: 'badge', 'aria-hidden': 'true' }),
      h('span', {}, label)));
  }
  fs.append(help, picked, counter, grid);
  queueMicrotask(sync);
  return fs;
}

function matrixQ(q) {
  const wrap = h('div', { class: 'matrix', role: 'group', 'aria-labelledby': `${q.id}-label`, 'aria-describedby': describedBy(q) },
    h('p', { class: 'q-label', id: `${q.id}-label` }, labelFor(q)));
  for (const [row, rowLabel] of q.rows) {
    const current = (state.answers[q.id] || {})[row];
    const fs = h('fieldset', { class: 'matrix-row' }, h('legend', {}, rowLabel));
    const seg = h('div', { class: 'seg' });
    q.scale.forEach((label, score) => {
      const id = `${q.id}-${row}-${score}`;
      seg.append(
        h('input', { type: 'radio', id, name: `${q.id}.${row}`, value: score, checked: current === score, onchange: () => {
          setAnswer(q.id, { ...(state.answers[q.id] || {}), [row]: score });
          setError(q.id, '');
        } }),
        h('label', { for: id }, label));
    });
    fs.append(seg);
    wrap.append(fs);
  }
  return wrap;
}

function textQ(q) {
  const id = `in-${q.id}`;
  const long = q.type === 'longtext';
  const max = long ? LIMITS.longtext : LIMITS.text;
  const attrs = {
    id, class: 'input', maxlength: max, 'aria-describedby': describedBy(q),
    oninput: (e) => {
      setAnswer(q.id, e.target.value);
      if (counter) counter.textContent = `${e.target.value.length} / ${max}`;
      // Once a field shows an error, re-check as they type so the message clears
      // before they click away (clearing it on blur shifts the layout mid-click).
      if (document.getElementById(`q-${q.id}`)?.classList.contains('has-error')) revalidate(q.id);
    },
    onblur: () => revalidate(q.id),
  };
  const counter = long && h('p', { class: 'counter' }, `${(state.answers[q.id] || '').length} / ${max}`);
  let input;
  if (long) {
    input = h('textarea', { ...attrs, rows: 4 });
    input.value = state.answers[q.id] || '';
  } else {
    const typeAttrs = {
      email: { type: 'email', autocomplete: 'email', inputmode: 'email' },
      asn: { type: 'text', inputmode: 'text', autocomplete: 'off', placeholder: 'AS64500', spellcheck: 'false' },
      text: { type: 'text', autocomplete: q.id === 'contactName' ? 'name' : q.id.toLowerCase().includes('org') ? 'organization' : 'off' },
    }[q.type];
    input = h('input', { ...attrs, ...typeAttrs, value: state.answers[q.id] || '' });
  }
  return h('div', { class: 'field' }, h('label', { class: 'q-label', for: id }, labelFor(q)), input, counter);
}

function revalidate(id) {
  setError(id, validateAnswers(state.answers).errors[id] || '');
}

function textsQ(q) {
  const values = state.answers[q.id] || [];
  const fs = h('fieldset', { 'aria-describedby': describedBy(q) }, h('legend', {}, labelFor(q)));
  const inputs = [];
  for (let i = 0; i < q.count; i++) {
    const input = h('input', {
      type: 'text', class: 'input', id: `${q.id}-${i}`, maxlength: LIMITS.text, value: values[i] || '',
      'aria-label': `${i + 1} of ${q.count}`,
      oninput: () => setAnswer(q.id, inputs.map((x) => x.value).some((v) => v.trim()) ? inputs.map((x) => x.value) : []),
    });
    inputs.push(input);
    fs.append(h('div', { class: 'numbered' }, h('span', { class: 'rank-n', 'aria-hidden': 'true' }, i + 1), input));
  }
  return fs;
}

// ---------- boot ----------

render();
ensureToken().catch(() => { /* retried on submit */ });
