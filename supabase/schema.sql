-- Game Night Voter: one vote (+1 / -1) per game per device.
create table if not exists public.game_votes (
  game_id    text        not null check (char_length(game_id) between 1 and 80),
  device_id  uuid        not null,
  vote       smallint    not null check (vote in (-1, 1)),
  updated_at timestamptz not null default now(),
  primary key (game_id, device_id)
);

-- No direct table access from the browser; everything goes through the functions below.
alter table public.game_votes enable row level security;
revoke all on public.game_votes from anon, authenticated;

-- Totals per game.
create or replace function public.get_scores()
returns table (game_id text, score bigint)
language sql stable security definer set search_path = '' as $$
  select v.game_id, sum(v.vote)::bigint from public.game_votes v group by v.game_id;
$$;

-- This device's own votes (so buttons show the right state).
create or replace function public.get_my_votes(p_device_id uuid)
returns table (game_id text, vote smallint)
language sql stable security definer set search_path = '' as $$
  select v.game_id, v.vote from public.game_votes v where v.device_id = p_device_id;
$$;

-- Set this device's vote for a game: 1, -1, or 0 to clear. Returns the game's new total.
create or replace function public.cast_vote(p_game_id text, p_device_id uuid, p_vote int)
returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if p_vote not in (-1, 0, 1) then raise exception 'vote must be -1, 0 or 1'; end if;
  if p_vote = 0 then
    delete from public.game_votes where game_id = p_game_id and device_id = p_device_id;
  else
    insert into public.game_votes (game_id, device_id, vote)
    values (p_game_id, p_device_id, p_vote)
    on conflict (game_id, device_id) do update set vote = excluded.vote, updated_at = now();
  end if;
  return (select coalesce(sum(vote), 0) from public.game_votes where game_id = p_game_id);
end;
$$;

revoke all on function public.get_scores(), public.get_my_votes(uuid), public.cast_vote(text, uuid, int) from public;
grant execute on function public.get_scores(), public.get_my_votes(uuid), public.cast_vote(text, uuid, int) to anon, authenticated;
