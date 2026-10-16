-- phone_extension (added in 0025_agent_contact_fields.sql) assumed each
-- agent had their own extension. They don't — the whole agency shares one
-- office line and one extension (727-789-2200 X.1), so the proposal PDFs
-- now hardcode that instead of reading a per-agent value. Drop the column;
-- nothing ever got the chance to populate it.

alter table public.profiles drop column if exists phone_extension;
