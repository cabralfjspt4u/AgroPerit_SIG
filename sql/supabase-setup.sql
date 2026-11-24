-- =====================================================================
-- AGROPERIT Parcelário – preparação da base de dados no Supabase
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run.
-- Pode ser executado mais de uma vez sem estragar nada.
-- =====================================================================

-- 1) Tabelas (as mesmas do site, sem repetir informação)
create table if not exists public.equipa (
  email text primary key,
  papel text not null check (papel in ('admin', 'leitor'))
);
create table if not exists public.estado (
  id integer primary key default 1 check (id = 1),
  versao bigint not null default 0,
  atualizado_em timestamptz not null default now()
);
insert into public.estado (id) values (1) on conflict do nothing;

create table if not exists public.tomador (nif text primary key, nome text not null, nifap text);
create table if not exists public.parcela (parcela text primary key, concelho_cod text, concelho text);
create table if not exists public.cultura (id bigint primary key, descricao text not null unique);
create table if not exists public.risco (id bigint primary key, chave text not null unique, nome text not null);
create table if not exists public.perfil (id bigint primary key, chave text not null unique);
create table if not exists public.perfil_risco (
  perfil_id bigint not null references public.perfil (id) on delete cascade,
  risco_id bigint not null references public.risco (id),
  agr text, franquia text, pmi double precision,
  primary key (perfil_id, risco_id)
);
create table if not exists public.adesao (
  id bigint primary key, apolice text not null, adesao_n text not null,
  tomador_nif text not null references public.tomador (nif),
  inicio text, nif_tomador_apolice text, ref_produtividade text, ref_preco text,
  unique (apolice, adesao_n)
);
create table if not exists public.subparcela (
  id bigint primary key, parcela text not null references public.parcela (parcela), nosa integer not null,
  ifap_estado text, ifap_em text, ifap_classe text, ifap_grau_cob text, ifap_abandono text,
  ifap_data_revisao text, ifap_area_m2 double precision, geom text,
  unique (parcela, nosa)
);
create table if not exists public.item (
  id bigint primary key,
  adesao_id bigint not null references public.adesao (id),
  subparcela_id bigint not null references public.subparcela (id),
  cultura_id bigint references public.cultura (id),
  ha double precision, prod_kg_ha double precision, preco_eur_kg double precision, idade_anos double precision,
  perfil_id bigint references public.perfil (id),
  unique (adesao_id, subparcela_id)
);
create table if not exists public.importacao (
  id bigint primary key, ficheiro text, em text,
  linhas integer, novos integer, atualizados integer, iguais integer, avisos integer
);

-- 2) Quem pode o quê: só quem estiver na tabela "equipa" entra.
--    "admin" carrega dados; "leitor" só consulta.
create or replace function public.papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.equipa
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;
revoke all on function public.papel() from public, anon;
grant execute on function public.papel() to authenticated;

-- 3) Segurança linha a linha (RLS): sem login não se vê nada.
alter table public.equipa enable row level security;   -- sem regras = ninguém lê pela internet
do $$
declare t text;
begin
  foreach t in array array['estado','tomador','parcela','cultura','risco','perfil','perfil_risco',
                           'adesao','subparcela','item','importacao']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists ler_equipa on public.%I', t);
    execute format('drop policy if exists inserir_admin on public.%I', t);
    execute format('drop policy if exists atualizar_admin on public.%I', t);
    execute format('drop policy if exists apagar_admin on public.%I', t);
    execute format('create policy ler_equipa on public.%I for select to authenticated using (public.papel() is not null)', t);
    execute format('create policy inserir_admin on public.%I for insert to authenticated with check (public.papel() = ''admin'')', t);
    execute format('create policy atualizar_admin on public.%I for update to authenticated using (public.papel() = ''admin'') with check (public.papel() = ''admin'')', t);
    execute format('create policy apagar_admin on public.%I for delete to authenticated using (public.papel() = ''admin'')', t);
  end loop;
end $$;

-- sem sessão iniciada (anon) não há acesso nenhum às tabelas
revoke all on all tables in schema public from anon;
revoke all on public.equipa from authenticated;

-- 4) "Ping" para manter o projeto ativo (não revela dados pessoais)
create or replace function public.ping() returns bigint
language sql stable security definer set search_path = public as $$
  select versao from public.estado where id = 1
$$;
grant execute on function public.ping() to anon, authenticated;
