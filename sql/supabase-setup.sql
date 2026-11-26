-- =====================================================================
-- AGROPERIT Parcelário – preparação / atualização da base no Supabase
-- Como usar: Supabase > SQL Editor > New query > colar TUDO > Run.
-- Pode ser executado mais de uma vez (também para ATUALIZAR uma base já criada).
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
  sub_ref text not null default '',
  ha double precision, prod_kg_ha double precision, preco_eur_kg double precision,
  idade text,
  oculto_em text,
  perfil_id bigint references public.perfil (id)
);
create table if not exists public.importacao (
  id bigint primary key, ficheiro text, em text,
  linhas integer, novos integer, atualizados integer, iguais integer, avisos integer
);

-- 1b) Atualização de bases criadas por versões anteriores (não faz nada numa base nova)
alter table public.item add column if not exists sub_ref text not null default '';
alter table public.item add column if not exists idade text;
alter table public.item add column if not exists oculto_em text;
alter table public.item drop column if exists idade_anos;
alter table public.item drop constraint if exists item_adesao_id_subparcela_id_key;
create unique index if not exists item_chave on public.item (adesao_id, subparcela_id, sub_ref);
create index if not exists item_adesao_idx on public.item (adesao_id);
create index if not exists item_subparcela_idx on public.item (subparcela_id);
create index if not exists item_cultura_idx on public.item (cultura_id);
create index if not exists item_perfil_idx on public.item (perfil_id);
create index if not exists adesao_tomador_idx on public.adesao (tomador_nif);
create index if not exists adesao_nif_apolice_idx on public.adesao (nif_tomador_apolice);
create index if not exists subparcela_parcela_idx on public.subparcela (parcela);

-- 2) Quem pode o quê: só quem estiver na tabela "equipa" entra.
--    "admin" carrega, apaga e arquiva dados; "leitor" só consulta.
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
    execute format('create policy inserir_admin on public.%I for insert to authenticated with check (public.papel() = ''admin'')', t);
    execute format('create policy atualizar_admin on public.%I for update to authenticated using (public.papel() = ''admin'') with check (public.papel() = ''admin'')', t);
    execute format('create policy apagar_admin on public.%I for delete to authenticated using (public.papel() = ''admin'')', t);
  end loop;
end $$;

-- 3b) Leitura. O ARQUIVO-MORTO: o administrador vê tudo; os leitores NÃO recebem nada do que está arquivado
--     (nem as subparcelas, nem os polígonos, nem os dados do tomador, se todas as suas linhas estiverem arquivadas).
create policy ler_equipa on public.estado for select to authenticated using (public.papel() is not null);
create policy ler_equipa on public.risco for select to authenticated using (public.papel() is not null);
create policy ler_equipa on public.importacao for select to authenticated using (public.papel() is not null);

create policy ler_equipa on public.item for select to authenticated
  using (public.papel() = 'admin' or (public.papel() is not null and oculto_em is null));

create policy ler_equipa on public.adesao for select to authenticated
  using (public.papel() = 'admin' or (public.papel() is not null and exists (
    select 1 from public.item i where i.adesao_id = adesao.id and i.oculto_em is null)));

create policy ler_equipa on public.subparcela for select to authenticated
  using (public.papel() = 'admin' or (public.papel() is not null and exists (
    select 1 from public.item i where i.subparcela_id = subparcela.id and i.oculto_em is null)));

create policy ler_equipa on public.cultura for select to authenticated
  using (public.papel() = 'admin' or (public.papel() is not null and exists (
    select 1 from public.item i where i.cultura_id = cultura.id and i.oculto_em is null)));

create policy ler_equipa on public.perfil for select to authenticated
  using (public.papel() = 'admin' or (public.papel() is not null and exists (
    select 1 from public.item i where i.perfil_id = perfil.id and i.oculto_em is null)));

create policy ler_equipa on public.perfil_risco for select to authenticated
  using (public.papel() = 'admin' or (public.papel() is not null and exists (
    select 1 from public.item i where i.perfil_id = perfil_risco.perfil_id and i.oculto_em is null)));

create policy ler_equipa on public.tomador for select to authenticated
  using (public.papel() = 'admin' or (public.papel() is not null and exists (
    select 1 from public.adesao a join public.item i on i.adesao_id = a.id
    where (a.tomador_nif = tomador.nif or a.nif_tomador_apolice = tomador.nif) and i.oculto_em is null)));

create policy ler_equipa on public.parcela for select to authenticated
  using (public.papel() = 'admin' or (public.papel() is not null and exists (
    select 1 from public.subparcela s join public.item i on i.subparcela_id = s.id
    where s.parcela = parcela.parcela and i.oculto_em is null)));

-- sem sessão iniciada (anon) não há acesso nenhum às tabelas
revoke all on all tables in schema public from anon;
revoke all on public.equipa from authenticated;

-- permissões de acesso às tabelas para quem tem sessão iniciada (as regras acima decidem depois o que cada um vê/escreve)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.estado, public.tomador, public.parcela, public.cultura, public.risco, public.perfil,
  public.perfil_risco, public.adesao, public.subparcela, public.item, public.importacao
to authenticated;

-- 4) "Ping" para manter o projeto ativo (não revela dados pessoais)
create or replace function public.ping() returns bigint
language sql stable security definer set search_path = public as $$
  select versao from public.estado where id = 1
$$;
grant execute on function public.ping() to anon, authenticated;

-- 5) Avisar o Supabase de que a estrutura mudou
notify pgrst, 'reload schema';
