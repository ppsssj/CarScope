-- P15: CarScope user accounts (Supabase Auth) and per-user "My Vehicles".
--
-- Scope and boundaries
-- * New schema `carscope_account` only. It does not read, alter or reference the session / inspection-record schema
--   `carscope` (P9-A4) or the empty `carscope_private` schema, and it does not touch `public`.
-- * Identity is `auth.uid()` from the JWT verified by the Data API. `user_metadata` is never used for ownership.
-- * A registered vehicle is SELF_REPORTED_UNVERIFIED. No API role can write the verification columns; promotion to
--   OEM_VERIFIED is reserved for a future, separately approved server role that does not exist yet.
-- * vehicle_inspection_links is structure only. No API role can insert into it, and it can only ever point at
--   VERIFIED_VEHICLE records, so AVD_SIMULATOR and UNVERIFIED records can never become a user's vehicle history.
-- * No SECURITY DEFINER function. The two trigger functions run as the caller and are not executable by API roles.
--
-- Operator application is manual and separately approved (docs/p15-supabase-auth-vehicles.md). Run it once, in one
-- transaction (psql --single-transaction -v ON_ERROR_STOP=1). `create schema` without IF NOT EXISTS is deliberate: a
-- second run, or a project that already has this schema, stops instead of silently merging.

create schema carscope_account;
comment on schema carscope_account is 'P15 CarScope accounts: profiles and self-reported vehicles. RLS on every table; authenticated only.';

revoke all on schema carscope_account from public;
grant usage on schema carscope_account to authenticated;

-- Profiles ------------------------------------------------------------------------------------------------------------
-- Email is not copied here: it stays in auth.users and is shown from the verified session only.
create table carscope_account.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or (char_length(display_name) between 1 and 80 and display_name = btrim(display_name))),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://[^/\s]+/\S*$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Vehicles ------------------------------------------------------------------------------------------------------------
-- No VIN, plate number or location. owner_id defaults to the caller and cannot be supplied or changed by API roles.
create table carscope_account.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  manufacturer text not null check (char_length(manufacturer) between 1 and 40 and manufacturer = btrim(manufacturer)),
  model text not null check (char_length(model) between 1 and 60 and model = btrim(model)),
  model_year smallint check (model_year is null or model_year between 1950 and 2100),
  nickname text check (nickname is null or (char_length(nickname) between 1 and 40 and nickname = btrim(nickname))),
  verification_status text not null default 'SELF_REPORTED_UNVERIFIED'
    check (verification_status in ('SELF_REPORTED_UNVERIFIED', 'OEM_VERIFIED')),
  verified_at timestamptz,
  verification_provider text check (verification_provider is null or verification_provider in ('HYUNDAI_DEVELOPERS', 'PLEOS_VEHICLE_DATA')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_verification_consistent check (
    (verification_status = 'SELF_REPORTED_UNVERIFIED' and verified_at is null and verification_provider is null)
    or (verification_status = 'OEM_VERIFIED' and verified_at is not null and verification_provider is not null)
  ),
  constraint vehicles_id_owner_unique unique (id, owner_id)
);
create index vehicles_owner_created_idx on carscope_account.vehicles (owner_id, created_at desc);

-- Future link between a user's vehicle and an inspection record (structure only) ---------------------------------------
-- record_id is an opaque reference to a record that a future verified owner path returns; there is no foreign key into
-- the `carscope` schema, and nothing here migrates or rewrites cs_inspection_records.
create table carscope_account.vehicle_inspection_links (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  owner_id uuid not null,
  record_namespace text not null check (record_namespace = 'VERIFIED_VEHICLE'),
  record_id text not null check (char_length(record_id) between 1 and 128),
  evidence text not null check (evidence = 'OWNER_VERIFIED_RECORD'),
  linked_at timestamptz not null default now(),
  constraint vehicle_inspection_links_vehicle_owner_fk foreign key (vehicle_id, owner_id)
    references carscope_account.vehicles (id, owner_id) on delete cascade,
  constraint vehicle_inspection_links_record_unique unique (record_namespace, record_id)
);
create index vehicle_inspection_links_owner_idx on carscope_account.vehicle_inspection_links (owner_id, vehicle_id);

-- Triggers (SECURITY INVOKER) -----------------------------------------------------------------------------------------
create function carscope_account.touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Defence in depth behind the column privileges: even if a later grant were too wide, API roles still cannot move a
-- vehicle to another owner or change its verification fields, and a user cannot exceed the per-user vehicle limit.
create function carscope_account.guard_vehicle_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') and (
         new.verification_status <> 'SELF_REPORTED_UNVERIFIED' or new.verified_at is not null or new.verification_provider is not null) then
      raise exception 'verification fields are not writable by API roles' using errcode = '42501';
    end if;
    -- Serialise one owner's inserts so the limit holds under concurrent requests.
    perform pg_advisory_xact_lock(hashtextextended('carscope_account.vehicles:' || new.owner_id::text, 0));
    if (select count(*) from carscope_account.vehicles v where v.owner_id = new.owner_id) >= 20 then
      raise exception 'vehicle limit reached' using errcode = '23514';
    end if;
  else
    if new.owner_id is distinct from old.owner_id then
      raise exception 'owner_id cannot change' using errcode = '42501';
    end if;
    if current_user in ('anon', 'authenticated') and (
         new.verification_status is distinct from old.verification_status
         or new.verified_at is distinct from old.verified_at
         or new.verification_provider is distinct from old.verification_provider) then
      raise exception 'verification fields are not writable by API roles' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on carscope_account.profiles
  for each row execute function carscope_account.touch_updated_at();
create trigger vehicles_guard before insert or update on carscope_account.vehicles
  for each row execute function carscope_account.guard_vehicle_write();
create trigger vehicles_touch_updated_at before update on carscope_account.vehicles
  for each row execute function carscope_account.touch_updated_at();

-- Row Level Security ---------------------------------------------------------------------------------------------------
alter table carscope_account.profiles enable row level security;
alter table carscope_account.vehicles enable row level security;
alter table carscope_account.vehicle_inspection_links enable row level security;

create policy profiles_select_own on carscope_account.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on carscope_account.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on carscope_account.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy vehicles_select_own on carscope_account.vehicles
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy vehicles_insert_own on carscope_account.vehicles
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy vehicles_update_own on carscope_account.vehicles
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy vehicles_delete_own on carscope_account.vehicles
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy vehicle_inspection_links_select_own on carscope_account.vehicle_inspection_links
  for select to authenticated using ((select auth.uid()) = owner_id);

-- Privileges -----------------------------------------------------------------------------------------------------------
-- Start from nothing (whatever platform default privileges added), then grant the minimum to `authenticated` only.
-- anon gets nothing. service_role gets nothing either: no server path in this PR needs to bypass RLS.
revoke all on all tables in schema carscope_account from public, anon, authenticated, service_role;
revoke all on all functions in schema carscope_account from public, anon, authenticated, service_role;

grant select on carscope_account.profiles to authenticated;
grant insert (id, display_name, avatar_url) on carscope_account.profiles to authenticated;
grant update (display_name, avatar_url) on carscope_account.profiles to authenticated;

grant select, delete on carscope_account.vehicles to authenticated;
grant insert (manufacturer, model, model_year, nickname) on carscope_account.vehicles to authenticated;
grant update (manufacturer, model, model_year, nickname) on carscope_account.vehicles to authenticated;

grant select on carscope_account.vehicle_inspection_links to authenticated;
