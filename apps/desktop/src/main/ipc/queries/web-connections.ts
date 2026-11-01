import { ConnectionIdSchema } from "../../../shared/web-connections-contracts";
import { webConnections } from "../../web/connections";
import { type QueryHandlerMap, query } from "./params";

function requiredConnections() {
  const owner = webConnections();
  if (!owner) throw new Error("Open Circé on your Mac to connect a browser.");
  return owner;
}

export const webConnectionQueries = {
  "webConnections.list": () =>
    webConnections()?.nativeList() ?? {
      available: false,
      origin: null,
      currentId: null,
      devices: [],
    },
  "webConnections.createCode": () => requiredConnections().nativeCreateCode(),
  "webConnections.cancelCode": query(ConnectionIdSchema, ({ id }) =>
    requiredConnections().nativeCancelCode(id),
  ),
  "webConnections.revoke": query(ConnectionIdSchema, ({ id }) =>
    requiredConnections().nativeRevoke(id),
  ),
} satisfies QueryHandlerMap;
