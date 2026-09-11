-- Phase 6: producers need to be able to decline a queued outreach item, not
-- just approve it — the schema had no status for that.

alter table public.outreach
  drop constraint outreach_status_check,
  add constraint outreach_status_check check (
    status in ('pending_review', 'approved', 'sent', 'bounced', 'rejected')
  );
