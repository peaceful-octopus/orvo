import { startFakeIdp } from './fake-idp';

// Runs the fake sign-in provider on its own, for end-to-end tests: `tsx src/fake-idp-main.ts` (PORT, CLIENT_ID).
const idp = await startFakeIdp({ port: Number(process.env.PORT ?? 9100), clientId: process.env.CLIENT_ID ?? 'chillcall-e2e' });
console.log(`fake identity provider on ${idp.issuer} for client ${idp.clientId}`);
