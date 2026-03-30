-- Allow signed-in app users to read store_map.
-- This fixes upload flows and policy checks that reference store_map.

alter table if exists public.store_map enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'store_map'
      and policyname = 'Authenticated users can read store_map'
  ) then
    create policy "Authenticated users can read store_map"
      on public.store_map
      for select
      to authenticated
      using (true);
  end if;
end
$$;
