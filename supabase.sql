-- Comptes en ligne de Simply : une ligne par compte, que lui seul peut lire et modifier.
-- À coller dans Supabase › SQL Editor, puis « Run ».
create table if not exists public.espaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);
alter table public.espaces enable row level security;
create policy "lire mon espace" on public.espaces for select to authenticated using (auth.uid() = user_id);
create policy "creer mon espace" on public.espaces for insert to authenticated with check (auth.uid() = user_id);
create policy "modifier mon espace" on public.espaces for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
