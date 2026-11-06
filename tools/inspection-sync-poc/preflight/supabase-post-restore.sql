-- Step S3 of docs/p9-a4-supabase-migration.md, after the restore. Same rules as supabase-bootstrap.sql.
-- Nothing is granted to anon, authenticated or service_role, and carscope is never added to the exposed schemas.
-- The schema came from the archive, restored with --no-privileges, so it holds no PUBLIC grant to revoke. The admin role
-- also has no rights on a schema carscope_app owns. DB_API_ROLES_DENIED checks the result on the real server.
BEGIN;
DO $revoke$ BEGIN EXECUTE format('REVOKE CREATE ON DATABASE %I FROM carscope_app', current_database()); END $revoke$;
COMMIT;
