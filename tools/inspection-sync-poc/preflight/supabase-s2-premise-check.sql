-- Before step S2 of docs/p9-a4-supabase-migration.md. One SELECT: it reads catalogs and changes nothing.
-- An operator runs it as the project admin role, after approval. Stop unless every line of the table in that document holds.
SELECT
  current_user AS admin_role,
  r.rolsuper AS is_superuser,
  r.rolcreaterole AS can_create_roles,
  pg_get_userbyid(d.datdba) AS database_owner,
  has_database_privilege(current_user, current_database(), 'CREATE WITH GRANT OPTION') AS can_grant_create_on_database,
  current_setting('server_version_num')::int / 10000 AS server_major,
  to_regnamespace('carscope') IS NULL AS carscope_schema_absent,
  NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carscope_app') AS carscope_app_absent,
  COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS connection_uses_tls
FROM pg_database d
JOIN pg_roles r ON r.rolname = current_user
WHERE d.datname = current_database();
