-- Run once in a new Supabase project's SQL Editor, before creating accounts.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body, E' \t\n\r')) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint different_participants check (sender_id <> recipient_id)
);

create index messages_conversation_idx on public.messages(sender_id, recipient_id, created_at desc, id desc);
create index messages_recipient_idx on public.messages(recipient_id);

create function public.create_friend_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'Friend ' || left(new.id::text, 6)), 60)
  );
  return new;
end;
$$;

revoke all on function public.create_friend_profile() from public, anon, authenticated;

create trigger on_friend_created
after insert on auth.users
for each row execute function public.create_friend_profile();

-- Also support accounts created before this script.
insert into public.profiles (id, display_name)
select id, left(coalesce(nullif(btrim(raw_user_meta_data ->> 'display_name'), ''), 'Friend ' || left(id::text, 6)), 60)
from auth.users;

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

revoke all on public.profiles, public.messages from anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.messages to authenticated;
grant insert (sender_id, recipient_id, body) on public.messages to authenticated;

create policy "Friends can see the account directory"
on public.profiles for select to authenticated
using ((select auth.uid()) is not null);

create policy "Only participants can read messages"
on public.messages for select to authenticated
using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);

create policy "Friends can send only as themselves"
on public.messages for insert to authenticated
with check ((select auth.uid()) = sender_id);

-- Client users cannot update/delete messages, change profiles, or supply timestamps.
-- Database administrators retain access; this is not end-to-end encryption.
alter publication supabase_realtime add table public.messages;

commit;
