-- Tracks where a property's listing photo came from, so the generated PDF
-- can caption an auto-fetched aerial fallback as such (and so a producer
-- looking at the property page knows a real MLS/listing photo would still
-- be worth uploading, rather than assuming the photo slot is already taken
-- care of).

alter table public.properties add column photo_source text;

alter table public.properties
  add constraint properties_photo_source_check
  check (photo_source is null or photo_source in ('onehome', 'manual', 'naip_aerial'));
