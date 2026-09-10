import { createRecordStorage } from "@isaiandco/ape-share-core/storage/records";
export const indexedDbSessionStorage = createRecordStorage({ databaseFactory: () => indexedDB, name: "apepatrol-session-state" });
