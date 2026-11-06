-- Step S2 of docs/p9-a4-supabase-migration.md. Run by an operator as the project admin role, after separate approval.
-- No tool in this repository executes this file against a remote server. Tests run it on a disposable local server only.
-- Run supabase-s2-premise-check.sql first. The admin role does not need to be a superuser, but it needs CREATEROLE and the
-- grant option for CREATE on this database, which the database owner holds.
-- Set the password separately with \password carscope_app, so it never appears in a file or a command line.
BEGIN;
CREATE ROLE carscope_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 10;
-- Every connection of this role resolves unqualified names here, whichever endpoint it comes through.
ALTER ROLE carscope_app SET search_path = carscope;
-- Temporary: the archive creates the schema, which makes this role its owner. supabase-post-restore.sql revokes it.
DO $grant$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO carscope_app', current_database()); END $grant$;
-- Without the grant option PostgreSQL only warns "no privileges were granted" and the script would appear to succeed.
DO $verify$ BEGIN
  IF NOT has_database_privilege('carscope_app', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'carscope_app did not receive CREATE on this database: the admin role lacks the grant option';
  END IF;
END $verify$;
COMMIT;
