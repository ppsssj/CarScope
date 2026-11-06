-- Step S2 of docs/p9-a4-supabase-migration.md. Run by an operator as the project admin role, after separate approval.
-- No tool in this repository executes this file against a remote server. Tests run it on a disposable local server only.
-- Set the password separately with \password carscope_app, so it never appears in a file or a command line.
BEGIN;
CREATE ROLE carscope_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 10;
-- Every connection of this role resolves unqualified names here, whichever endpoint it comes through.
ALTER ROLE carscope_app SET search_path = carscope;
-- Temporary: the archive creates the schema, which makes this role its owner. supabase-post-restore.sql revokes it.
DO $grant$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO carscope_app', current_database()); END $grant$;
COMMIT;
