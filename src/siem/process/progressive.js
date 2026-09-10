import { createProcessPagination, PROCESS_DIRECTIONS } from "@isaiandco/ape-share-core/graph/progressive";
import { parseSiemTime } from "../../shared/time.js";
export { PROCESS_DIRECTIONS };
function eventKey(event) {
  if (event?.uuid) return `uuid:${event.uuid}`;
  return JSON.stringify([
    event?.time ?? "", event?.["event_src.host"] ?? "", event?.msgid ?? "",
    event?.["object.process.guid"] ?? event?.["subject.process.guid"] ?? "",
    event?.["object.process.id"] ?? event?.["subject.process.id"] ?? event?.["object.id"] ?? "",
  ]);
}


export const { deduplicateProcessEvents, prioritizeProcessEvents, seedProcessRange, expansionRanges, mergeLoadedRanges, fetchProcessPages, runProcessRangeQueries } = createProcessPagination({ identity: eventKey, time: event => parseSiemTime(event?.time)?.valueOf() ?? 0 });
