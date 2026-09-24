// Flattening and aggregation of stored responses. Runs in the browser (admin
// page) and in Node (scripts/export.mjs); no dependencies.

import { SURVEY, allQuestions } from './survey.js';

const QUESTIONS = allQuestions().filter((q) => !q.contact);

/** Segment fields every long-format row carries, for easy pivoting. */
export const SEGMENTS = ['role', 'networkType', 'operatesCache'];

function label(q, value) {
  if (value === 'other') return 'Other';
  return (q.options || []).find(([v]) => v === value)?.[1] ?? value;
}

/** One row per response; one column per answer (ranks and matrix rows get their own columns). */
export function wideRows(responses) {
  return responses.map((r) => {
    const a = r.answers || {};
    const row = { id: r.id, submittedAt: r.submittedAt, version: r.v, country: r.meta?.country ?? '', durationSec: r.meta?.durationSec ?? '' };
    for (const q of QUESTIONS) {
      const v = a[q.id];
      switch (q.type) {
        case 'rank':
          for (let i = 0; i < q.max; i++) row[`${q.id}_${i + 1}`] = v?.[i] ?? '';
          break;
        case 'texts':
          for (let i = 0; i < q.count; i++) row[`${q.id}_${i + 1}`] = v?.[i] ?? '';
          break;
        case 'matrix':
          for (const [rowId] of q.rows) row[`${q.id}.${rowId}`] = v?.[rowId] ?? '';
          break;
        case 'multi':
          row[q.id] = (v || []).join('|');
          break;
        default:
          row[q.id] = v ?? '';
      }
      if (q.other) row[`${q.id}Other`] = a[`${q.id}Other`] ?? '';
    }
    return row;
  });
}

/**
 * Long format: one row per selected option in multi/rank questions.
 * `points` is a rank weight (max..1 for a top-`max` list), blank for multi.
 */
export function pickRows(responses) {
  const rows = [];
  for (const r of responses) {
    const a = r.answers || {};
    const seg = Object.fromEntries(SEGMENTS.map((s) => [s, a[s] ?? '']));
    for (const q of QUESTIONS) {
      if (q.type !== 'rank' && q.type !== 'multi') continue;
      (a[q.id] || []).forEach((option, i) => rows.push({
        id: r.id, question: q.id, option, optionLabel: label(q, option),
        rank: q.type === 'rank' ? i + 1 : '', points: q.type === 'rank' ? q.max - i : '', ...seg,
      }));
    }
  }
  return rows;
}

export function contactRows(contacts) {
  return contacts.map((c) => ({
    id: c.id, submittedAt: c.submittedAt, name: c.contactName ?? '', email: c.contactEmail ?? '',
    organization: c.contactOrg ?? '', asn: c.contactAsn ?? '',
  }));
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // defuse spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}

export function filterResponses(responses, filters) {
  return responses.filter((r) => Object.entries(filters).every(([k, v]) => !v || r.answers?.[k] === v));
}

/**
 * Summary for one question over a set of responses.
 *   single/multi: { answered, items: [{ value, label, count, pct }] }
 *   rank:         { answered, items: [{ value, label, count, pct, points, first }] }  sorted by points
 *   matrix:       { rows: [{ value, label, counts: [...per scale], answered, mean }] } sorted by mean
 *   text-like:    { answers: [{ id, text }] }
 * pct is relative to respondents who answered the question.
 */
export function summarize(q, responses) {
  const values = responses.map((r) => ({ id: r.id, v: r.answers?.[q.id], other: r.answers?.[`${q.id}Other`] })).filter((x) => x.v != null);

  if (q.type === 'single' || q.type === 'multi' || q.type === 'rank') {
    const options = q.other ? [...q.options, ['other', 'Other']] : q.options;
    const items = options.map(([value, lbl]) => ({ value, label: lbl, count: 0, points: 0, first: 0 }));
    const byValue = Object.fromEntries(items.map((i) => [i.value, i]));
    for (const { v } of values) {
      (Array.isArray(v) ? v : [v]).forEach((opt, i) => {
        const it = byValue[opt];
        if (!it) return;
        it.count++;
        if (q.type === 'rank') { it.points += q.max - i; if (i === 0) it.first++; }
      });
    }
    for (const it of items) it.pct = values.length ? it.count / values.length : 0;
    items.sort(q.type === 'rank' ? (a, b) => b.points - a.points || b.count - a.count : (a, b) => b.count - a.count);
    const others = values.map((x) => x.other).filter(Boolean);
    return { answered: values.length, items, others };
  }

  if (q.type === 'matrix') {
    const rows = q.rows.map(([value, lbl]) => {
      const counts = q.scale.map(() => 0);
      let sum = 0; let n = 0;
      for (const { v } of values) {
        const s = v?.[value];
        if (Number.isInteger(s)) { counts[s]++; sum += s; n++; }
      }
      return { value, label: lbl, counts, answered: n, mean: n ? sum / n : 0 };
    });
    rows.sort((a, b) => b.mean - a.mean);
    return { rows };
  }

  return {
    answers: values.flatMap(({ id, v }) => (Array.isArray(v) ? v : [v]).map((text) => ({ id, text: String(text) }))),
  };
}

export { SURVEY, QUESTIONS };
