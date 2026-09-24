-- Optional: a read-only login for Grafana / Metabase / psql analysis.
-- Sees everything except contacts. Run in the SQL editor; change the password.
create role survey_reader login password 'change-me';
grant usage on schema survey to survey_reader;
grant select on survey.responses, survey.choices, survey.ratings, survey.texts,
                survey.v_choices, survey.v_ratings to survey_reader;
create policy reader_select on survey.responses for select to survey_reader using (true);
create policy reader_select on survey.choices   for select to survey_reader using (true);
create policy reader_select on survey.ratings   for select to survey_reader using (true);
create policy reader_select on survey.texts     for select to survey_reader using (true);
