import { parentPort } from 'node:worker_threads';
// Deliberately never respond; the supervisor must terminate this worker.
parentPort.on('message', () => {});
