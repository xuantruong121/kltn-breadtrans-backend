/**
 * External-service isolation (P12.9): the first thing a test worker runs.
 * Used by both jest projects: imported first by jest-setup-isolation.ts (unit)
 * and listed in test/jest-e2e.json `setupFiles` (e2e, whose database and Redis
 * targets are set by its own global setup).
 */
import { isolateExternalEnvironment } from './external-env';
import { installNetworkGuard } from './network-guard';

isolateExternalEnvironment();
installNetworkGuard();
