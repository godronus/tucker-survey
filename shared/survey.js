// Single source of truth for the survey. Used by:
//   - the FastEdge app (server-side validation, src/validate.ts)
//   - the browser (rendering, public/survey.js)
//   - reporting (shared/report.js, admin page and scripts/export.mjs)
//
// Changing option values breaks comparability with earlier responses. Add new
// options freely; bump `version` if you rename or remove any.
//
// Question types:
//   single   radio group                       value: string
//   multi    checkboxes                        value: string[]
//   rank     "pick your top N", in order       value: string[] (index 0 = rank 1)
//   matrix   rows x scale                      value: { [rowId]: 0..scale.length-1 }
//   text     one line                          value: string
//   longtext paragraph                         value: string
//   texts    `count` one-line inputs           value: string[]
//   email    work email                        value: string
//   asn      AS number                         value: string ("AS" prefix stripped)
//
// showIf: { q, in: [...] }        single answer is in list / multi answer intersects list
//         { q, anyExcept: [...] } multi answer has at least one value outside list
// contact: true   stored under contact:<id>, never in the analysis record
// other: true     adds an "Other" option with a free-text field (<id>Other)

const SCALE_IMPORTANCE = ['Not useful', 'Nice to have', 'Important', 'Extremely important'];

export const SURVEY = {
  version: 1,
  title: 'Gcore Peering & Embedded Cache Partner Survey',
  intro: [
    'We’re redesigning how ISPs and network operators interact with Gcore for peering, traffic visibility, embedded caches, capacity planning and ongoing operations.',
    'We’ve built an early self-service portal prototype, but before we go much further we want input from people who regularly work with content providers.',
    'We’re especially interested in what existing provider portals do well, what they do poorly, and what still requires unnecessary email or ticket back-and-forth.',
    'Responses can be anonymous. Contact information is optional.',
  ],
  outro: 'Thanks. We’re building this for the people who actually have to operate the network, so critical feedback is more useful to us than polite feedback.',
  sections: [
    {
      id: 'about',
      title: 'About you',
      questions: [
        {
          id: 'role', type: 'single', required: true, other: true,
          label: 'What best describes your role?',
          options: [
            ['peering', 'Peering / Interconnection'],
            ['neteng', 'Network Engineering'],
            ['netarch', 'Network Architecture'],
            ['capacity', 'Capacity Planning'],
            ['noc', 'NOC / Operations'],
            ['cache_ops', 'CDN / Cache Operations'],
            ['ixp', 'IXP'],
            ['leadership', 'Engineering Leadership'],
          ],
        },
        {
          id: 'networkType', type: 'single', required: true, other: true,
          label: 'What type of network do you operate?',
          options: [
            ['isp_broadband', 'ISP / Broadband'],
            ['mobile', 'Mobile'],
            ['regional_isp', 'Regional ISP'],
            ['national_tier1', 'National / Tier-1'],
            ['hosting_cloud', 'Hosting / Cloud'],
            ['enterprise', 'Enterprise'],
            ['ixp', 'IXP'],
            ['content', 'Content Network'],
          ],
        },
        { id: 'organization', type: 'text', label: 'Organization', hint: 'Optional' },
        { id: 'asn', type: 'asn', label: 'ASN', hint: 'Optional, e.g. AS64500' },
      ],
    },
    {
      id: 'portals',
      title: 'Other content-provider portals',
      questions: [
        {
          id: 'portalsUsed', type: 'multi', other: true, exclusive: 'none',
          label: 'Which content-provider peering or cache portals have you used?',
          options: [
            ['google_ggc', 'Google / GGC'],
            ['netflix_oca', 'Netflix Open Connect'],
            ['meta', 'Meta'],
            ['cloudflare', 'Cloudflare'],
            ['akamai', 'Akamai'],
            ['aws', 'AWS / CloudFront ePoP'],
            ['microsoft', 'Microsoft'],
            ['apple', 'Apple'],
            ['none', 'None'],
          ],
        },
        {
          id: 'bestProvider', type: 'longtext', showIf: { q: 'portalsUsed', anyExcept: ['none'] },
          label: 'Which provider offers the best operator experience, and why?',
        },
        {
          id: 'portalsDoWell', type: 'longtext', showIf: { q: 'portalsUsed', anyExcept: ['none'] },
          label: 'What do existing portals do especially well?',
        },
        {
          id: 'stillManual', type: 'longtext',
          label: 'What still requires an email or ticket that should obviously be self-service?',
        },
      ],
    },
    {
      id: 'priorities',
      title: 'Gcore portal priorities',
      questions: [
        {
          id: 'portalTop5', type: 'rank', max: 5, required: true,
          label: 'Pick the 5 things you would most want in a Gcore partner portal, most important first.',
          options: [
            ['traffic_current', 'Current traffic with Gcore'],
            ['traffic_history', '30/90/365-day traffic history'],
            ['traffic_by_market', 'Traffic by market / PoP / DC'],
            ['traffic_by_path', 'Traffic by PNI / IX / transit'],
            ['traffic_trends', 'P95 / peak / growth trends'],
            ['interface_headroom', 'Interface utilization / headroom'],
            ['capacity_forecast', 'Capacity exhaustion forecasting'],
            ['bgp_public', 'Public BGP session state'],
            ['bgp_private', 'Private / PNI session state'],
            ['prefixes_received', 'Received prefixes'],
            ['prefixes_advertised', 'Advertised prefixes'],
            ['ipv4_ipv6', 'Separate IPv4 / IPv6 state'],
            ['bgp_flaps', 'BGP flap history'],
            ['irr', 'IRR validation'],
            ['rpki', 'RPKI validation'],
            ['filter_reason', 'Reason a prefix was filtered / rejected'],
            ['communities', 'Communities'],
            ['shared_ix', 'Shared-IX discovery'],
            ['one_click_peering', 'One-click peering requests'],
            ['pni_eligibility', 'PNI eligibility'],
            ['pni_upgrade', 'PNI upgrade / augmentation requests'],
            ['request_tracking', 'Peering request lifecycle tracking'],
            ['maintenance', 'Maintenance visibility'],
            ['incidents', 'Incident visibility'],
            ['looking_glass', 'Looking glass / diagnostics'],
            ['api', 'API'],
            ['webhooks', 'Webhooks'],
            ['prometheus', 'Prometheus / OpenMetrics'],
            ['export', 'CSV / JSON export'],
          ],
        },
        { id: 'portalMissing', type: 'longtext', label: 'What are we missing?' },
      ],
    },
    {
      id: 'peering',
      title: 'Peering workflow',
      questions: [
        {
          id: 'peeringSelfService', type: 'rank', max: 5,
          label: 'Which 5 peering actions matter most to have as self-service, most important first?',
          options: [
            ['detect_shared_ix', 'Detect IXs where both networks are present'],
            ['request_sessions', 'Request IPv4 + IPv6 sessions'],
            ['auto_addressing', 'Exchange addressing automatically'],
            ['verify_peeringdb', 'Verify PeeringDB information'],
            ['bilateral_vs_rs', 'Choose bilateral vs route-server peering'],
            ['track_approval', 'Track approval'],
            ['track_config', 'Track configuration'],
            ['see_established', 'See when BGP becomes established'],
            ['see_prefixes', 'See received / advertised prefixes'],
            ['config_snippets', 'Download example Junos / IOS-XR / EOS snippets'],
            ['session_issue', 'Open an issue against a specific session'],
            ['more_locations', 'Request additional locations'],
            ['ix_to_pni', 'Request IX → PNI migration'],
          ],
        },
        {
          id: 'lifecycleUseful', type: 'single',
          label: 'Is this request lifecycle useful? Available → Requested → Approved → Configured → BGP Established → Passing Traffic',
          options: [
            ['yes', 'Yes, as shown'],
            ['yes_changes', 'Yes, with changes'],
            ['no', 'No'],
            ['unsure', 'Not sure'],
          ],
        },
        {
          id: 'lifecycleDifferent', type: 'longtext', showIf: { q: 'lifecycleUseful', in: ['yes_changes', 'no'] },
          label: 'How would you structure it differently?',
        },
      ],
    },
    {
      id: 'routing',
      title: 'Routing transparency',
      questions: [
        {
          id: 'routingMatrix', type: 'matrix', scale: SCALE_IMPORTANCE,
          label: 'How important is visibility into each of these?',
          rows: [
            ['prefixes_received', 'Prefixes Gcore receives from my ASN'],
            ['prefixes_accepted', 'Prefixes accepted'],
            ['prefixes_rejected', 'Prefixes rejected'],
            ['reject_reason', 'Reason a prefix was rejected'],
            ['irr_state', 'IRR state'],
            ['rpki_state', 'RPKI state'],
            ['communities', 'Communities received'],
            ['flap_history', 'BGP flap history'],
            ['route_learned_where', 'Where Gcore learns my routes'],
            ['pop_serving_prefix', 'Which Gcore PoP serves a prefix'],
            ['why_not_local', 'Why a prefix is not served locally'],
            ['edge_connectivity_test', 'Connectivity testing from Gcore edge locations toward my network'],
          ],
        },
        {
          id: 'routingProblem', type: 'longtext',
          label: 'What routing problem do you most often need a content provider’s peering team to investigate manually?',
        },
      ],
    },
    {
      id: 'cache',
      title: 'Embedded caches',
      questions: [
        {
          id: 'operatesCache', type: 'single', required: true,
          label: 'Do you currently operate embedded caches for one or more content providers?',
          options: [
            ['yes', 'Yes'],
            ['evaluating', 'Not yet, but we are evaluating it'],
            ['no', 'No'],
          ],
        },
        {
          id: 'cacheFriction', type: 'rank', max: 5, showIf: { q: 'operatesCache', in: ['yes'] },
          label: 'Pick the 5 biggest friction points in embedded-cache programs, worst first.',
          options: [
            ['eligibility', 'Eligibility / qualification'],
            ['commercial', 'Commercial terms'],
            ['tech_requirements', 'Technical requirements'],
            ['site_qualification', 'Site qualification'],
            ['capacity_sizing', 'Capacity sizing'],
            ['shipping', 'Shipping'],
            ['customs', 'Customs / import duty'],
            ['rack', 'Rack requirements'],
            ['power', 'Power requirements'],
            ['cabling_optics', 'Cabling / optics'],
            ['ip_addressing', 'IP addressing'],
            ['bgp_config', 'BGP configuration'],
            ['installation', 'Installation'],
            ['turn_up', 'Initial turn-up'],
            ['troubleshooting', 'Troubleshooting'],
            ['monitoring', 'Monitoring'],
            ['augmentation', 'Capacity augmentation'],
            ['rma', 'Hardware failure / RMA'],
            ['refresh', 'Hardware refresh'],
            ['relocation', 'Relocation'],
            ['decommissioning', 'Decommissioning'],
            ['support', 'Support / escalation'],
          ],
        },
        {
          id: 'cachePreRequest', type: 'rank', max: 5, showIf: { q: 'operatesCache', in: ['yes', 'evaluating'] },
          label: 'Before requesting a cache, which 5 things should Gcore show you, most important first?',
          options: [
            ['eligible_traffic', 'Eligible measured traffic'],
            ['traffic_by_city', 'Traffic by city / region'],
            ['traffic_growth', 'Historical traffic growth'],
            ['offload_estimate', 'Estimated traffic offload'],
            ['recommended_size', 'Recommended deployment size'],
            ['rack', 'Rack requirement'],
            ['power', 'Power requirement'],
            ['ports_optics', 'Port / optic requirement'],
            ['fill_traffic', 'Expected fill traffic'],
            ['cache_egress', 'Expected cache egress'],
            ['qualifies', 'Whether the network currently qualifies'],
            ['why_qualifies', 'Why it qualifies / doesn’t qualify'],
            ['what_to_change', 'What would need to change before it qualifies'],
          ],
        },
      ],
    },
    {
      id: 'cacheOps',
      title: 'Operating an installed cache',
      showIf: { q: 'operatesCache', in: ['yes'] },
      questions: [
        {
          id: 'cacheTelemetryTop5', type: 'rank', max: 5,
          label: 'Pick your top 5 telemetry items for an installed cache, most important first.',
          options: [
            ['cache_traffic', 'Cache traffic'],
            ['hit_ratio', 'Cache-hit / offload ratio'],
            ['by_node', 'Traffic by node'],
            ['by_prefix', 'Traffic by prefix'],
            ['by_category', 'Traffic by service / content category'],
            ['fill_traffic', 'Fill traffic'],
            ['nic_util', 'NIC / interface utilization'],
            ['server_health', 'Server health'],
            ['disk_health', 'Disk health'],
            ['hw_alarms', 'Hardware alarms'],
            ['serving_capacity', 'Serving capacity'],
            ['headroom', 'Remaining headroom'],
            ['capacity_forecast', 'Capacity forecast'],
            ['bgp_state', 'BGP state'],
            ['served_prefixes', 'Served prefixes'],
            ['maintenance', 'Planned maintenance'],
            ['software_version', 'Software / version state'],
            ['incident_history', 'Incident history'],
          ],
        },
        {
          id: 'cacheSelfService', type: 'rank', max: 5,
          label: 'Which 5 cache actions matter most to have as self-service, most important first?',
          options: [
            ['change_serving_prefixes', 'Change serving prefixes'],
            ['change_bgp', 'Change BGP configuration'],
            ['add_remove_prefixes', 'Add / remove prefixes'],
            ['more_capacity', 'Request additional capacity'],
            ['more_appliances', 'Request additional appliances'],
            ['relocation', 'Request relocation'],
            ['rma', 'Request RMA'],
            ['schedule_maintenance', 'Schedule maintenance'],
            ['diagnostics', 'Download diagnostics'],
            ['support_case', 'Open support case'],
            ['decommission', 'Decommission appliance'],
            ['update_contacts', 'Update site / NOC contacts'],
          ],
        },
      ],
    },
    {
      id: 'alerts',
      title: 'Alerts and automation',
      questions: [
        {
          id: 'alertsTop5', type: 'rank', max: 5,
          label: 'Pick the 5 things Gcore should most proactively alert you on, most important first.',
          options: [
            ['session_down', 'Peering session down'],
            ['session_flapping', 'Session flapping'],
            ['traffic_drop', 'Unexpected traffic reduction'],
            ['traffic_shift', 'Unexpected traffic shift'],
            ['pni_util', 'High PNI utilization'],
            ['capacity_limit', 'Approaching capacity limit'],
            ['cache_hw_fault', 'Cache hardware fault'],
            ['cache_capacity', 'Cache capacity exhaustion'],
            ['prefix_rejected', 'Prefix rejected'],
            ['rpki_irr', 'RPKI / IRR issue'],
            ['maintenance', 'Planned maintenance'],
            ['incident', 'Active incident'],
            ['augmentation', 'Cache augmentation recommended'],
          ],
        },
        {
          id: 'channels', type: 'multi', other: true, max: 3,
          label: 'Preferred notification channels (up to 3)',
          options: [
            ['email', 'Email'],
            ['portal', 'Portal'],
            ['webhook', 'Webhook'],
            ['slack', 'Slack'],
            ['teams', 'Microsoft Teams'],
            ['pagerduty', 'PagerDuty'],
            ['api_polling', 'API polling'],
          ],
        },
        {
          id: 'apiUse', type: 'single',
          label: 'Would you use an API for this portal?',
          options: [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']],
        },
        {
          id: 'apiAutomate', type: 'longtext', showIf: { q: 'apiUse', in: ['yes', 'maybe'] },
          label: 'What would you automate with it?',
        },
      ],
    },
    {
      id: 'forced',
      title: 'If you could only choose…',
      intro: 'These are the most important questions in the survey.',
      questions: [
        { id: 'buildNext3', type: 'texts', count: 3, label: 'If Gcore could build only THREE things next, what should they be?' },
        { id: 'mostFrustrating', type: 'longtext', label: 'What is the single most frustrating interaction you currently have with a large content provider?' },
        { id: 'wishEveryProvider', type: 'longtext', label: 'What is one feature from another provider that you wish every provider offered?' },
        { id: 'noProviderDoes', type: 'longtext', label: 'What is something NO provider currently does that you wish existed?' },
      ],
    },
    {
      id: 'followUp',
      title: 'Optional follow-up',
      questions: [
        {
          id: 'followUp', type: 'multi',
          label: 'Would you be willing to…',
          options: [
            ['prototypes', 'Review future prototypes'],
            ['call', 'Join a 20–30 minute feedback call'],
          ],
        },
        { id: 'contactName', type: 'text', contact: true, label: 'Name', hint: 'Optional', showIf: { q: 'followUp', in: ['prototypes', 'call'] } },
        { id: 'contactEmail', type: 'email', contact: true, label: 'Work email', hint: 'Optional, but we can’t reach you without it', showIf: { q: 'followUp', in: ['prototypes', 'call'] } },
        { id: 'contactOrg', type: 'text', contact: true, label: 'Organization', hint: 'Optional', showIf: { q: 'followUp', in: ['prototypes', 'call'] } },
        { id: 'contactAsn', type: 'asn', contact: true, label: 'ASN', hint: 'Optional', showIf: { q: 'followUp', in: ['prototypes', 'call'] } },
      ],
    },
  ],
};

export const LIMITS = { text: 200, longtext: 2000 };

/** Whether a showIf condition passes for the given answers. */
export function visible(cond, answers) {
  if (!cond) return true;
  const a = answers[cond.q];
  const arr = Array.isArray(a) ? a : a == null || a === '' ? [] : [a];
  if (cond.in) return arr.some((v) => cond.in.includes(v));
  if (cond.anyExcept) return arr.some((v) => !cond.anyExcept.includes(v));
  return true;
}

/** Flat list of all questions, each tagged with its section. */
export function allQuestions() {
  return SURVEY.sections.flatMap((s) => s.questions.map((q) => ({ ...q, section: s })));
}

/** Question is shown given answers (section and question conditions both pass). */
export function questionVisible(q, answers) {
  return visible(q.section.showIf, answers) && visible(q.showIf, answers);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASN_RE = /^(?:AS)?(\d{1,10})$/i;

function optionValues(q) {
  const values = (q.options || []).map(([v]) => v);
  return q.other ? [...values, 'other'] : values;
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Validate and normalise raw answers. Used both in the browser (inline
 * validation) and in the FastEdge app (authoritative check).
 *
 * Hidden questions are dropped, so branching is enforced server-side too.
 * Returns { errors, answers, contact }: `errors` maps question id -> message,
 * `answers` is the analysis record, `contact` holds the follow-up details.
 */
export function validateAnswers(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const errors = {};
  const answers = {};
  const contact = {};

  for (const q of allQuestions()) {
    if (!questionVisible(q, input)) continue;
    const v = input[q.id];
    const out = q.contact ? contact : answers;
    let value;

    switch (q.type) {
      case 'single': {
        if (v == null || v === '') break;
        if (!optionValues(q).includes(v)) { errors[q.id] = 'Choose one of the listed options.'; break; }
        value = v;
        break;
      }
      case 'multi':
      case 'rank': {
        if (v == null) break;
        if (!Array.isArray(v)) { errors[q.id] = 'Invalid selection.'; break; }
        const allowed = optionValues(q);
        if (v.some((x) => !allowed.includes(x)) || new Set(v).size !== v.length) { errors[q.id] = 'Invalid selection.'; break; }
        if (q.max && v.length > q.max) { errors[q.id] = `Choose at most ${q.max}.`; break; }
        if (q.exclusive && v.includes(q.exclusive) && v.length > 1) { errors[q.id] = `“${q.options.find(([o]) => o === q.exclusive)[1]}” can’t be combined with other options.`; break; }
        if (v.length) value = v;
        break;
      }
      case 'matrix': {
        if (v == null) break;
        if (typeof v !== 'object' || Array.isArray(v)) { errors[q.id] = 'Invalid answer.'; break; }
        const rows = q.rows.map(([r]) => r);
        const clean = {};
        for (const [row, score] of Object.entries(v)) {
          if (!rows.includes(row) || !Number.isInteger(score) || score < 0 || score >= q.scale.length) { errors[q.id] = 'Invalid answer.'; break; }
          clean[row] = score;
        }
        if (!errors[q.id] && Object.keys(clean).length) value = clean;
        break;
      }
      case 'text':
      case 'longtext': {
        const max = LIMITS[q.type];
        if (typeof v === 'string' && v.trim().length > max) { errors[q.id] = `Keep this under ${max} characters.`; break; }
        value = str(v, max) || undefined;
        break;
      }
      case 'texts': {
        if (v == null) break;
        if (!Array.isArray(v) || v.length > q.count) { errors[q.id] = 'Invalid answer.'; break; }
        const items = v.map((x) => str(x, LIMITS.text)).filter(Boolean);
        if (items.length) value = items;
        break;
      }
      case 'email': {
        const e = str(v, LIMITS.text);
        if (e && !EMAIL_RE.test(e)) { errors[q.id] = 'Enter a valid email address.'; break; }
        value = e || undefined;
        break;
      }
      case 'asn': {
        const s = str(v, 20).replace(/\s+/g, '');
        if (!s) break;
        const m = ASN_RE.exec(s);
        if (!m || Number(m[1]) < 1 || Number(m[1]) > 4294967295) { errors[q.id] = 'Enter an AS number, e.g. AS64500.'; break; }
        value = m[1];
        break;
      }
    }

    if (errors[q.id]) continue;
    if (value === undefined) {
      if (q.required) errors[q.id] = 'This question is required.';
      continue;
    }
    out[q.id] = value;

    if (q.other && (value === 'other' || (Array.isArray(value) && value.includes('other')))) {
      const other = str(input[`${q.id}Other`], LIMITS.text);
      if (other) out[`${q.id}Other`] = other;
    }
  }

  return { errors, answers, contact };
}

/**
 * Explode validated answers into relational rows (see supabase/migrations).
 * `answers` stays the lossless record; these rows exist for SQL.
 */
export function relationalRows(answers) {
  const choices = [];
  const ratings = [];
  const texts = [];
  for (const q of allQuestions()) {
    const v = answers[q.id];
    if (v == null || q.contact) continue;
    switch (q.type) {
      case 'single': choices.push({ q: q.id, o: v }); break;
      case 'multi': v.forEach((o) => choices.push({ q: q.id, o })); break;
      case 'rank': v.forEach((o, i) => choices.push({ q: q.id, o, rank: i + 1, points: q.max - i })); break;
      case 'matrix': for (const [item, score] of Object.entries(v)) ratings.push({ q: q.id, item, score }); break;
      case 'texts': v.forEach((body, i) => texts.push({ q: q.id, position: i + 1, body })); break;
      case 'text': case 'longtext': texts.push({ q: q.id, position: 1, body: v }); break;
    }
    const other = answers[`${q.id}Other`];
    if (other) texts.push({ q: `${q.id}Other`, position: 1, body: other });
  }
  return { choices, ratings, texts };
}
