-- P15 operator check, READ ONLY. Run after applying 20261113000000_p15_account_vehicles.sql, with the same admin
-- connection, e.g.  psql "<admin connection>" -v ON_ERROR_STOP=1 -f verify-account-schema.sql
-- Every row must read `t` in the `pass` column. It changes nothing (one read-only transaction, rolled back).
begin read only;

with checks(check_name, pass) as (
  values
  ('schema carscope_account exists',
     exists (select 1 from pg_namespace where nspname = 'carscope_account')),
  ('exactly the three tables, all with RLS on',
     (select array_agg(relname::text order by relname) = array['profiles','vehicle_inspection_links','vehicles']
             and bool_and(relrowsecurity)
        from pg_class where relnamespace = 'carscope_account'::regnamespace and relkind in ('r','p','v','m','f'))),
  ('anon has no usage on the schema and no table or column privilege',
     not has_schema_privilege('anon', 'carscope_account', 'usage')
     and not exists (select 1 from information_schema.role_table_grants where table_schema = 'carscope_account' and grantee = 'anon')
     and not exists (select 1 from information_schema.column_privileges where table_schema = 'carscope_account' and grantee = 'anon')),
  ('service_role and PUBLIC have no table or column privilege',
     not exists (select 1 from information_schema.role_table_grants where table_schema = 'carscope_account' and grantee in ('service_role','PUBLIC'))
     and not exists (select 1 from information_schema.column_privileges where table_schema = 'carscope_account' and grantee in ('service_role','PUBLIC'))),
  ('authenticated: whole-table SELECT on the three tables, DELETE on vehicles only',
     (select array_agg(table_name || ':' || privilege_type order by table_name, privilege_type)
        from information_schema.role_table_grants where table_schema = 'carscope_account' and grantee = 'authenticated')
     = array['profiles:SELECT','vehicle_inspection_links:SELECT','vehicles:DELETE','vehicles:SELECT']),
  ('authenticated cannot write owner_id or verification fields',
     not has_column_privilege('authenticated', 'carscope_account.vehicles', 'owner_id', 'INSERT')
     and not has_column_privilege('authenticated', 'carscope_account.vehicles', 'owner_id', 'UPDATE')
     and not has_column_privilege('authenticated', 'carscope_account.vehicles', 'verification_status', 'INSERT')
     and not has_column_privilege('authenticated', 'carscope_account.vehicles', 'verification_status', 'UPDATE')
     and not has_column_privilege('authenticated', 'carscope_account.vehicles', 'verified_at', 'UPDATE')
     and not has_column_privilege('authenticated', 'carscope_account.vehicle_inspection_links', 'record_id', 'INSERT')),
  ('eight policies, all TO authenticated, UPDATE with USING and WITH CHECK',
     (select count(*) = 8 and bool_and(roles = '{authenticated}')
             and bool_and(cmd <> 'UPDATE' or (qual is not null and with_check is not null))
        from pg_policies where schemaname = 'carscope_account')),
  ('no SECURITY DEFINER function, and API roles cannot execute the trigger functions',
     not exists (select 1 from pg_proc where pronamespace = 'carscope_account'::regnamespace and prosecdef)
     and not exists (select 1 from pg_proc p cross join (values ('anon'),('authenticated'),('service_role')) r(role)
                      where p.pronamespace = 'carscope_account'::regnamespace and has_function_privilege(r.role, p.oid, 'execute'))),
  ('no view in the schema (views would bypass RLS)',
     not exists (select 1 from pg_class where relnamespace = 'carscope_account'::regnamespace and relkind in ('v','m'))),
  ('the session / record schema `carscope` was not touched by this migration (no carscope_account object refers to it)',
     not exists (select 1 from pg_depend d join pg_class c on c.oid = d.objid
                  where c.relnamespace = 'carscope_account'::regnamespace
                    and d.refobjid in (select oid from pg_class where relnamespace in (select oid from pg_namespace where nspname in ('carscope','carscope_private')))))
)
select check_name, pass from checks;

rollback;
