import { startTracing } from './tracing';

// Imported for its side effect, first thing in main.ts: the instrumentations
// have to be registered before Nest pulls in http, express and pg.
startTracing();
