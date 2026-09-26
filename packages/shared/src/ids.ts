import { ulid } from 'ulid';

/** All entity ids are ULIDs minted in the API so Mongo and Tiger join on plain strings. */
export const newId = (): string => ulid();
