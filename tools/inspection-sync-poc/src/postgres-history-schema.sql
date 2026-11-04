-- Additive history migration v1. cs_schema_meta/session TTLs remain unchanged.
CREATE TABLE IF NOT EXISTS cs_history_schema_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version>0));
INSERT INTO cs_history_schema_meta(id,version) VALUES(1,1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS cs_inspection_records (
  record_id UUID PRIMARY KEY,
  inspection_id UUID NOT NULL UNIQUE,
  sync_session_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL CHECK(task_id IN ('washer-fluid','tire.front-left','tire.front-right','tire.rear-left','tire.rear-right','ev-charge.port','brake-fluid','coolant-reservoir','lcw-coolant-reservoir','battery-12v','fuse-box','wiper.front.left','wiper.front.right','light-low-beam-left-0','light-low-beam-right-0','light-high-beam-left-0','light-high-beam-right-0')),
  part_id TEXT NOT NULL CHECK(part_id=CASE task_id WHEN 'washer-fluid' THEN 'washer-fluid-cap' WHEN 'brake-fluid' THEN 'brake-fluid-reservoir' ELSE task_id END),
  schema_version INTEGER NOT NULL CHECK(schema_version=CASE WHEN task_id='washer-fluid' THEN 1 ELSE 2 END),
  inspection_status TEXT NOT NULL CHECK(inspection_status IN ('OK','NEEDS_REFILL','UNSURE','REVIEW_NEEDED','UNABLE','NO_FINDINGS_REPORTED')),
  original_result JSONB NOT NULL CHECK(jsonb_typeof(original_result)='object' AND original_result->>'inspectionId'=inspection_id::text AND original_result->>'taskId'=task_id AND original_result->>'status'=inspection_status AND original_result->'schemaVersion'=to_jsonb(schema_version) AND original_result->>'confirmation'='USER_REPORTED' AND original_result->>'source'='MOBILE' AND original_result->>'method'='SELF' AND original_result->>'state'='COMPLETED' AND original_result->>'sync'='NOT_SENT' AND original_result-ARRAY['schemaVersion','inspectionId','taskId','method','source','state','startedAt','aids','responses','status','confirmation','completedAt','sync']='{}'::jsonb),
  result_digest TEXT NOT NULL CHECK(result_digest ~ '^sha256:[0-9a-f]{64}$'),
  completed_at BIGINT NOT NULL CHECK(completed_at BETWEEN -8640000000000000 AND 8640000000000000),
  received_at BIGINT NOT NULL CHECK(received_at>=0 AND received_at<=9007199254740991),
  accepted_at BIGINT NOT NULL CHECK(accepted_at>=received_at AND accepted_at<=9007199254740991),
  authority_namespace TEXT NOT NULL CHECK(authority_namespace IN ('UNVERIFIED','AVD_SIMULATOR','VERIFIED_VEHICLE')),
  authority_issuer TEXT NOT NULL CHECK(length(authority_issuer) BETWEEN 1 AND 512),
  user_id TEXT, vehicle_id TEXT, device_id TEXT, registration_id TEXT, binding_verified_at BIGINT,
  created_at BIGINT NOT NULL CHECK(created_at>=0),
  CHECK(authority_namespace<>'VERIFIED_VEHICLE' OR (user_id IS NOT NULL AND vehicle_id IS NOT NULL AND device_id IS NOT NULL AND registration_id IS NOT NULL AND binding_verified_at IS NOT NULL)),
  CHECK(authority_namespace<>'AVD_SIMULATOR' OR (user_id IS NULL AND vehicle_id IS NULL AND device_id IS NULL AND registration_id IS NOT NULL AND binding_verified_at IS NOT NULL)),
  CHECK(authority_namespace<>'UNVERIFIED' OR (user_id IS NULL AND vehicle_id IS NULL AND device_id IS NULL AND registration_id IS NULL AND binding_verified_at IS NULL)),
  CHECK(original_result ?& ARRAY['schemaVersion','inspectionId','taskId','method','source','state','startedAt','aids','status','confirmation','completedAt','sync']),
  CHECK((schema_version=1 AND NOT(original_result ? 'responses') AND inspection_status IN ('OK','NEEDS_REFILL','UNSURE')) OR (schema_version=2 AND original_result ? 'responses' AND inspection_status IN ('REVIEW_NEEDED','UNABLE','NO_FINDINGS_REPORTED'))),
  CHECK(jsonb_typeof(original_result->'aids')='object' AND (original_result->'aids') ?& ARRAY['cameraUsed','locationMarked'] AND (original_result->'aids')-ARRAY['cameraUsed','locationMarked']='{}'::jsonb AND jsonb_typeof(original_result->'aids'->'cameraUsed')='boolean' AND jsonb_typeof(original_result->'aids'->'locationMarked')='boolean')
  -- Deliberately no FK to cs_sessions: session purge must not delete history.
);
CREATE INDEX IF NOT EXISTS cs_history_owner_page ON cs_inspection_records(authority_namespace,authority_issuer,user_id,vehicle_id,completed_at DESC,record_id DESC);
CREATE INDEX IF NOT EXISTS cs_history_owner_task_page ON cs_inspection_records(authority_namespace,authority_issuer,user_id,vehicle_id,task_id,completed_at DESC,record_id DESC);
