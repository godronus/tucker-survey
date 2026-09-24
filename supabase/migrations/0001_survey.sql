-- Partner survey schema.
--
-- Tables live in the `survey` schema, which is NOT in Supabase's exposed API
-- schemas, so nothing here is reachable over REST. The FastEdge app talks to
-- three SECURITY DEFINER functions in `public` using the publishable (anon)
-- key: it can submit responses and, with the admin token, read them back.
--
-- `responses.answers` is the complete, lossless record (the same JSON the app
-- validated). `choices`, `ratings` and `texts` are the same answers exploded
-- into rows for SQL, written in the same transaction.

create schema if not exists survey;

create table survey.responses (
  id             text primary key check (id ~ '^[0-9a-z]{6,12}-[0-9a-f]{16,32}$'),
  survey_version int not null,
  submitted_at   timestamptz not null default now(),
  country        text,
  duration_sec   int,
  -- segment columns, copied out of `answers` for cheap filtering
  role           text not null,
  network_type   text not null,
  operates_cache text not null,
  answers        jsonb not null
);
create index on survey.responses (submitted_at);

-- single / multi / rank answers: one row per selected option
create table survey.choices (
  response_id text not null references survey.responses (id) on delete cascade,
  question    text not null,
  option      text not null,
  rank        smallint check (rank >= 1),   -- rank questions only; 1 = top pick
  points      smallint check (points >= 1), -- rank weight: top of a top-5 = 5
  primary key (response_id, question, option)
);
create index on survey.choices (question, option);

-- matrix answers: 0 = not useful .. 3 = extremely important
create table survey.ratings (
  response_id text not null references survey.responses (id) on delete cascade,
  question    text not null,
  item        text not null,
  score       smallint not null check (score between 0 and 3),
  primary key (response_id, question, item)
);

-- every free-text answer, including "Other" fields (question = '<id>Other')
create table survey.texts (
  response_id text not null references survey.responses (id) on delete cascade,
  question    text not null,
  position    smallint not null default 1,
  body        text not null,
  primary key (response_id, question, position)
);
create index on survey.texts using gin (to_tsvector('english', body));

-- only for respondents who opted into follow-up; personal data stays here
create table survey.contacts (
  response_id  text primary key references survey.responses (id) on delete cascade,
  name         text,
  email        text,
  organization text,
  asn          bigint,
  created_at   timestamptz not null default now(),
  -- follow-up workflow, edited by the survey team in the dashboard
  contacted_at timestamptz,
  notes        text
);

-- single row: sha256 of the admin token (see README, "Admin token")
create table survey.settings (
  admin_token_sha256 text not null check (admin_token_sha256 ~ '^[0-9a-f]{64}$')
);

alter table survey.responses enable row level security;
alter table survey.choices   enable row level security;
alter table survey.ratings   enable row level security;
alter table survey.texts     enable row level security;
alter table survey.contacts  enable row level security;
alter table survey.settings  enable row level security;
revoke all on schema survey from public;

-- ---------------------------------------------------------------------------
-- Analyst views (SQL editor, Grafana/Metabase Postgres datasource)

create view survey.v_choices as
select c.*, r.submitted_at, r.role, r.network_type, r.operates_cache, r.country
from survey.choices c join survey.responses r on r.id = c.response_id;

create view survey.v_ratings as
select t.*, r.submitted_at, r.role, r.network_type, r.operates_cache, r.country
from survey.ratings t join survey.responses r on r.id = t.response_id;

-- ---------------------------------------------------------------------------
-- API functions

-- p = { response: { id, version, country, durationSec, answers },
--       choices: [{ q, o, rank?, points? }], ratings: [{ q, item, score }],
--       texts: [{ q, position, body }], contact: { name?, email?, organization?, asn? } | null }
-- Idempotent: resubmitting an id that is already stored is a no-op.
create or replace function public.submit_response(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := p -> 'response';
  rid text := r ->> 'id';
begin
  insert into survey.responses (id, survey_version, country, duration_sec, role, network_type, operates_cache, answers)
  values (rid, (r ->> 'version')::int, r ->> 'country', (r ->> 'durationSec')::int,
          r -> 'answers' ->> 'role', r -> 'answers' ->> 'networkType', r -> 'answers' ->> 'operatesCache',
          r -> 'answers')
  on conflict (id) do nothing;
  if not found then
    return; -- a retry of a response we already have
  end if;

  insert into survey.choices (response_id, question, option, rank, points)
  select rid, x.q, x.o, x.rank, x.points
  from jsonb_to_recordset(coalesce(p -> 'choices', '[]')) as x (q text, o text, rank smallint, points smallint);

  insert into survey.ratings (response_id, question, item, score)
  select rid, x.q, x.item, x.score
  from jsonb_to_recordset(coalesce(p -> 'ratings', '[]')) as x (q text, item text, score smallint);

  insert into survey.texts (response_id, question, position, body)
  select rid, x.q, x.position, x.body
  from jsonb_to_recordset(coalesce(p -> 'texts', '[]')) as x (q text, position smallint, body text);

  if jsonb_typeof(p -> 'contact') = 'object' and p -> 'contact' <> '{}'::jsonb then
    insert into survey.contacts (response_id, name, email, organization, asn)
    values (rid, p -> 'contact' ->> 'name', p -> 'contact' ->> 'email',
            p -> 'contact' ->> 'organization', (p -> 'contact' ->> 'asn')::bigint);
  end if;
end;
$$;

create or replace function survey.check_admin(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or not exists (
    select 1 from survey.settings
    where admin_token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end;
$$;

-- Same shape the app used to store, so shared/report.js works unchanged.
create or replace function public.admin_responses(p_token text, p_offset int default 0, p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform survey.check_admin(p_token);
  return jsonb_build_object(
    'count', (select count(*) from survey.responses),
    'items', coalesce((
      select jsonb_agg(x.j order by x.submitted_at, x.id)
      from (
        select id, submitted_at, jsonb_build_object(
          'v', survey_version, 'id', id, 'submittedAt', submitted_at,
          'meta', jsonb_build_object('country', country, 'durationSec', duration_sec),
          'answers', answers) as j
        from survey.responses
        order by submitted_at, id
        offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000)
      ) x), '[]'::jsonb));
end;
$$;

create or replace function public.admin_contacts(p_token text, p_offset int default 0, p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform survey.check_admin(p_token);
  return jsonb_build_object(
    'count', (select count(*) from survey.contacts),
    'items', coalesce((
      select jsonb_agg(x.j order by x.created_at, x.response_id)
      from (
        select response_id, created_at, jsonb_strip_nulls(jsonb_build_object(
          'id', response_id, 'submittedAt', created_at, 'contactName', name, 'contactEmail', email,
          'contactOrg', organization, 'contactAsn', asn::text)) as j
        from survey.contacts
        order by created_at, response_id
        offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000)
      ) x), '[]'::jsonb));
end;
$$;

revoke execute on function survey.check_admin(text) from public;
revoke execute on function public.submit_response(jsonb) from public;
revoke execute on function public.admin_responses(text, int, int) from public;
revoke execute on function public.admin_contacts(text, int, int) from public;
grant execute on function public.submit_response(jsonb) to anon;
grant execute on function public.admin_responses(text, int, int) to anon;
grant execute on function public.admin_contacts(text, int, int) to anon;
