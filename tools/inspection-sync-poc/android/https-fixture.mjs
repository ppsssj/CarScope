// Spawned by JVM tests only. Certificate/key and the explicit fixture credential stay outside Git.
import { startSyncServer } from '../src/server.mjs';
import { FakeSessionCreationAuthorizer } from '../src/creation-authorizer.mjs';
const [cert, key] = process.argv.slice(2);
if (!cert || !key || !process.env.SYNC_FIXTURE_TOKEN) throw new Error('Missing local TLS fixture');
const server = await startSyncServer({ host: '127.0.0.1', port: 0, tlsCert: cert, tlsKey: key,
  authorizer: new FakeSessionCreationAuthorizer({ token: process.env.SYNC_FIXTURE_TOKEN, expiresAt: Date.now() + 60000 }), log: () => {} });
process.stdout.write(JSON.stringify({ origin: server.url }) + '\n');
