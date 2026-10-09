-- Rotate through five creators per quarter-hour after a successful manual collection.
select cron.unschedule('reelsmap-sync-views-hourly');
select cron.schedule('reelsmap-sync-views-15m','*/15 * * * *',$job$
 select net.http_post(
  url:='https://tbyfoxsyadmpeeatyzvm.supabase.co/functions/v1/sync-reel-views',
  headers:=jsonb_build_object('Content-Type','application/json','x-reel-sync-key',
   (select decrypted_secret from vault.decrypted_secrets where name='reel_sync_scheduler')),
  body:='{}'::jsonb,timeout_milliseconds:=180000);
$job$);
