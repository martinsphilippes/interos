-- Stub mínimo do que o Supabase já provê (schema extensions e tabelas do auth), para rodar a migration e os testes
-- de tests/docdb num Postgres local/CI. NÃO aplique em um projeto Supabase.
create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  banned_until timestamptz, created_at timestamptz, updated_at timestamptz, confirmation_token varchar(255),
  recovery_token varchar(255), email_change_token_new varchar(255), email_change varchar(255),
  email_change_token_current varchar(255), reauthentication_token varchar(255), phone_change text, phone_change_token varchar(255)
);
create table if not exists auth.identities (
  id uuid primary key, user_id uuid references auth.users(id) on delete cascade, provider_id text, provider text,
  identity_data jsonb, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create table if not exists auth.sessions (id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
create table if not exists auth.refresh_tokens (id bigserial primary key, user_id varchar(255), session_id uuid);
