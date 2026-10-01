-- =====================================================================================================================
-- INTEROS — armazenamento de documentos no Postgres (Supabase), substituto do Firestore.
--
-- Modelo: uma tabela por coleção no schema `interos`, com o documento inteiro em `data` (jsonb). A API do servidor
-- (src/server/docdb.ts) reproduz a do Firestore Admin; a camada src/server/db.ts continua a mesma.
--
-- Segurança (equivale ao antigo firestore.rules, que negava tudo ao cliente):
-- - o schema `interos` NÃO é exposto pela Data API (PostgREST expõe só `public`/`graphql_public`);
-- - anon/authenticated não têm USAGE no schema;
-- - RLS ligado em toda tabela, com política apenas para `interos_app` (papel usado pelo servidor do Next).
-- O papel `interos_app` é criado aqui SEM login; a senha é definida fora do repositório:
--   alter role interos_app with login password '<senha>';
-- Aplicada no projeto `interos` (vqkpyjpwxsmsqfgpdjao) em 2026-10-01, dividida em partes (interos_docstore_1..8) pelo
-- limite de tempo do conector; as funções com DELETE (auth_update_user/revoke/delete) foram rodadas no SQL Editor.
-- =====================================================================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'interos_app') then
    create role interos_app nologin;
  end if;
end
$$;

create schema if not exists interos;
revoke all on schema interos from public;
grant usage on schema interos to interos_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- Tabela de coleção
-- ---------------------------------------------------------------------------------------------------------------------

/**
 * Cria (idempotente) a tabela de uma coleção. Toda coleção nova do domínio entra por uma migration que chama esta
 * função — o teste tests/docdb/schema.test.ts confere que COLLECTIONS e as migrations batem.
 */
create or replace function interos.create_doc_table(name text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if name !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'nome de coleção inválido: %', name;
  end if;
  execute format(
    'create table if not exists interos.%I (
       id text primary key,
       data jsonb not null default ''{}''::jsonb,
       organization_id text generated always as (data->>''organizationId'') stored,
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now()
     )', name);
  execute format('create index if not exists %I on interos.%I (organization_id)', name || '_org_idx', name);
  execute format('create index if not exists %I on interos.%I using gin (data jsonb_path_ops)', name || '_data_idx', name);
  execute format('alter table interos.%I enable row level security', name);
  if not exists (select 1 from pg_policies where schemaname = 'interos' and tablename = name and policyname = 'interos_app_all') then
    execute format('create policy interos_app_all on interos.%I for all to interos_app using (true) with check (true)', name);
  end if;
  execute format('grant select, insert, update, delete on interos.%I to interos_app', name);
end
$$;

revoke all on function interos.create_doc_table(text) from public;

-- ---------------------------------------------------------------------------------------------------------------------
-- Patch de documento (update/set merge/FieldValue) em um único comando, sem ler o documento no servidor
-- ---------------------------------------------------------------------------------------------------------------------

/** Grava `value` no caminho `path`, criando os mapas intermediários (como o Firestore faz em "a.b.c"). */
create or replace function interos.jsonb_set_deep(target jsonb, path text[], value jsonb) returns jsonb
language plpgsql immutable
set search_path = ''
as $$
begin
  if coalesce(array_length(path, 1), 0) = 0 then
    return value;
  end if;
  if target is null or jsonb_typeof(target) <> 'object' then
    target := '{}'::jsonb;
  end if;
  return jsonb_set(target, array[path[1]], interos.jsonb_set_deep(target -> path[1], path[2:], value), true);
end
$$;

/**
 * Aplica operações [{ "op": "set" | "delete" | "increment", "path": [...], "value": ... }] em ordem.
 * increment em campo não numérico (ou ausente) grava o próprio valor — mesma regra do FieldValue.increment.
 */
create or replace function interos.apply_patch(target jsonb, ops jsonb) returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  op jsonb;
  path text[];
  current jsonb;
begin
  target := coalesce(target, '{}'::jsonb);
  for op in select * from jsonb_array_elements(ops) loop
    path := array(select jsonb_array_elements_text(op -> 'path'));
    case op ->> 'op'
      when 'set' then
        target := interos.jsonb_set_deep(target, path, op -> 'value');
      when 'delete' then
        target := target #- path;
      when 'increment' then
        current := target #> path;
        if current is not null and jsonb_typeof(current) = 'number' then
          target := interos.jsonb_set_deep(target, path, to_jsonb((current #>> '{}')::numeric + (op ->> 'value')::numeric));
        else
          target := interos.jsonb_set_deep(target, path, op -> 'value');
        end if;
      else
        raise exception 'operação de patch desconhecida: %', op ->> 'op';
    end case;
  end loop;
  return target;
end
$$;

grant execute on function interos.jsonb_set_deep(jsonb, text[], jsonb) to interos_app;
grant execute on function interos.apply_patch(jsonb, jsonb) to interos_app;

-- ---------------------------------------------------------------------------------------------------------------------
-- Coleções (src/domain/types.ts → COLLECTIONS)
-- ---------------------------------------------------------------------------------------------------------------------

do $$
declare c text;
begin
  foreach c in array array[
  'organizations', 'users', 'departments', 'clients', 'contacts', 'client_products', 'leads', 'lead_sources',
  'campaigns', 'prospect_lists', 'prospects', 'opportunities', 'products', 'proposals', 'contracts', 'billing',
  'implementation_projects', 'implementation_templates', 'implementation_tasks', 'trainings', 'cs_accounts',
  'health_scores', 'success_plans', 'renewals', 'churn_records', 'support_tickets', 'ticket_interactions',
  'csat_responses', 'knowledge_articles', 'tasks', 'comments', 'documents', 'events', 'timeline_events',
  'notifications', 'sla_rules', 'sla_instances', 'kpis', 'kpi_snapshots', 'goals', 'performance_results',
  'bonus_rules', 'bonus_results', 'bonus_blocks', 'commission_rules', 'commissions', 'gamification_points',
  'gamification_campaigns', 'achievements', 'workflow_templates', 'workflow_instances', 'workflow_steps',
  'automation_rules', 'automation_runs', 'visits', 'communications', 'settings', 'process_definitions',
  'process_runs', 'counters', 'payables', 'payment_events', 'contract_amendments', 'suppliers',
  'permission_profiles', 'portal_links', 'financial_accounts', 'cost_centers', 'finance_categories'
  ] loop
    perform interos.create_doc_table(c);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Gestão de logins (Supabase Auth) pelo servidor do INTEROS
--
-- O id do usuário no INTEROS (documento em interos.users, ex.: "user_igor") fica em
-- auth.users.raw_app_meta_data.interos_uid — app_metadata só é gravável pelo servidor, nunca pelo próprio usuário.
-- As funções rodam como dono (security definer) e só `interos_app` pode executá-las.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function interos.auth_find(p_interos_uid text) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select id from auth.users where raw_app_meta_data ->> 'interos_uid' = p_interos_uid limit 1
$$;

create or replace function interos.auth_create_user(
  p_interos_uid text, p_email text, p_password text, p_name text, p_disabled boolean default false
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if exists (select 1 from auth.users where raw_app_meta_data ->> 'interos_uid' = p_interos_uid) then
    raise exception 'auth/uid-already-exists' using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'auth/email-already-exists' using errcode = 'P0001';
  end if;
  if p_password is not null and length(p_password) < 6 then
    raise exception 'auth/invalid-password' using errcode = 'P0001';
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    reauthentication_token, phone_change, phone_change_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    case when p_password is null then '' else extensions.crypt(p_password, extensions.gen_salt('bf', 10)) end,
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'interos_uid', p_interos_uid),
    jsonb_build_object('name', p_name, 'email_verified', true),
    case when p_disabled then now() + interval '100 years' else null end,
    now(), now(), '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_id, v_id::text, 'email',
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    null, now(), now()
  );
  return v_id;
end
$$;

create or replace function interos.auth_update_user(
  p_interos_uid text, p_password text default null, p_name text default null, p_disabled boolean default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where raw_app_meta_data ->> 'interos_uid' = p_interos_uid limit 1;
  if v_id is null then
    raise exception 'auth/user-not-found' using errcode = 'P0001';
  end if;
  if p_password is not null and length(p_password) < 6 then
    raise exception 'auth/invalid-password' using errcode = 'P0001';
  end if;
  update auth.users set
    encrypted_password = case when p_password is null then encrypted_password
                              else extensions.crypt(p_password, extensions.gen_salt('bf', 10)) end,
    raw_user_meta_data = case when p_name is null then raw_user_meta_data
                              else coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('name', p_name) end,
    banned_until = case when p_disabled is null then banned_until
                        when p_disabled then now() + interval '100 years' else null end,
    updated_at = now()
  where id = v_id;
  -- Desativar ou trocar a senha encerra as sessões abertas no Auth.
  if p_disabled is true or p_password is not null then
    delete from auth.sessions where user_id = v_id;
    delete from auth.refresh_tokens where user_id = v_id::text;
  end if;
end
$$;

create or replace function interos.auth_revoke_sessions(p_interos_uid text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where raw_app_meta_data ->> 'interos_uid' = p_interos_uid limit 1;
  if v_id is null then
    raise exception 'auth/user-not-found' using errcode = 'P0001';
  end if;
  delete from auth.sessions where user_id = v_id;
  delete from auth.refresh_tokens where user_id = v_id::text;
end
$$;

create or replace function interos.auth_delete_user(p_interos_uid text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where raw_app_meta_data ->> 'interos_uid' = p_interos_uid limit 1;
  if v_id is null then
    raise exception 'auth/user-not-found' using errcode = 'P0001';
  end if;
  delete from auth.users where id = v_id;
end
$$;

/** Logins vinculados a uids do INTEROS (usado pelo seed para recriar os usuários de demonstração). */
create or replace function interos.auth_list_users() returns table (id uuid, interos_uid text, email text)
language sql stable security definer
set search_path = ''
as $$
  select id, raw_app_meta_data ->> 'interos_uid', email::text from auth.users
$$;

revoke all on function interos.auth_find(text) from public;
revoke all on function interos.auth_create_user(text, text, text, text, boolean) from public;
revoke all on function interos.auth_update_user(text, text, text, boolean) from public;
revoke all on function interos.auth_revoke_sessions(text) from public;
revoke all on function interos.auth_delete_user(text) from public;
revoke all on function interos.auth_list_users() from public;
grant execute on function interos.auth_find(text) to interos_app;
grant execute on function interos.auth_create_user(text, text, text, text, boolean) to interos_app;
grant execute on function interos.auth_update_user(text, text, text, boolean) to interos_app;
grant execute on function interos.auth_revoke_sessions(text) to interos_app;
grant execute on function interos.auth_delete_user(text) to interos_app;
grant execute on function interos.auth_list_users() to interos_app;
