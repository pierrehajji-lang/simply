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

-- Imports préparés pour un compte (ex. son export Notion) : Simply les ajoute au prochain chargement puis les retire.
create table if not exists public.imports_en_attente (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data text not null,
  created_at timestamptz not null default now()
);
alter table public.imports_en_attente enable row level security;
create policy "lire mes imports" on public.imports_en_attente for select to authenticated using (auth.uid() = user_id);
create policy "retirer mes imports" on public.imports_en_attente for delete to authenticated using (auth.uid() = user_id);
