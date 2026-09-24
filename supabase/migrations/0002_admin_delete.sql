-- Delete responses by id (cascades to choices, ratings, texts, contacts).
-- For removing spam, test submissions and GDPR requests; used by the test suite
-- to clean up after itself. Returns the number of responses deleted.
create or replace function public.admin_delete_responses(p_token text, p_ids text[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  perform survey.check_admin(p_token);
  delete from survey.responses where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.admin_delete_responses(text, text[]) from public;
grant execute on function public.admin_delete_responses(text, text[]) to anon;
