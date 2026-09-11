-- Seeds the single tenant this internal build runs for.
-- After creating your first user (Supabase Studio -> Authentication -> Add user,
-- or a signup flow), link it to this agency:
--
--   insert into public.profiles (id, agency_id, email, role)
--   values ('<auth-user-uuid>', (select id from public.agencies limit 1), '<email>', 'admin');

insert into public.agencies (name)
values ('Brightway Insurance')
on conflict do nothing;
