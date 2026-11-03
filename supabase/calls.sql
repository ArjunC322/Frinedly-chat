-- Run once AFTER schema.sql, including on an existing chat database.
begin;

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'declined', 'ended')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  check (caller_id <> callee_id)
);
create index calls_caller_idx on public.calls(caller_id, expires_at);
create index calls_callee_idx on public.calls(callee_id, expires_at);
alter table public.calls enable row level security;
revoke all on public.calls from anon, authenticated;
grant select on public.calls to authenticated;
create policy "Only call participants can read"
on public.calls for select to authenticated
using ((select auth.uid()) in (caller_id, callee_id));

create function public.start_call(peer_id uuid, call_kind text)
returns public.calls
language plpgsql security definer set search_path = ''
as $$
declare result public.calls;
begin
  if auth.uid() is null or peer_id = auth.uid() then
    raise exception 'Sign in and select another friend.';
  end if;
  -- Serialize reservations so simultaneous callers cannot double-book a person.
  perform pg_advisory_xact_lock(716284);
  if exists (
    select 1 from public.calls
    where status in ('ringing', 'accepted') and expires_at > now()
      and (caller_id in (auth.uid(), peer_id) or callee_id in (auth.uid(), peer_id))
  ) then
    raise exception 'You or your friend already has an active call.';
  end if;
  insert into public.calls(caller_id, callee_id, kind)
  values (auth.uid(), peer_id, call_kind) returning * into result;
  return result;
end;
$$;

create function public.respond_to_call(call_id uuid, action text)
returns public.calls
language plpgsql security definer set search_path = ''
as $$
declare result public.calls;
begin
  select * into result from public.calls where id = call_id for update;
  if not found or auth.uid() is null or auth.uid() not in (result.caller_id, result.callee_id) then
    raise exception 'Call unavailable.';
  end if;
  if action in ('accept', 'decline') then
    if auth.uid() <> result.callee_id or result.status <> 'ringing' or result.expires_at <= now() then
      raise exception 'This call can no longer be answered.';
    end if;
    update public.calls set
      status = case when action = 'accept' then 'accepted' else 'declined' end,
      expires_at = case when action = 'accept' then now() + interval '2 hours' else now() end
    where id = call_id returning * into result;
  elsif action = 'end' then
    update public.calls set status = 'ended', expires_at = now()
    where id = call_id returning * into result;
  else
    raise exception 'Invalid call action.';
  end if;
  return result;
end;
$$;

revoke all on function public.start_call(uuid, text) from public, anon, authenticated;
revoke all on function public.respond_to_call(uuid, text) from public, anon, authenticated;
grant execute on function public.start_call(uuid, text) to authenticated;
grant execute on function public.respond_to_call(uuid, text) to authenticated;
alter publication supabase_realtime add table public.calls;
commit;
