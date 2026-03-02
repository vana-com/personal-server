import type { IndexManager } from "@opendatalabs/personal-server-ts-core/storage/index";
import type { HierarchyManagerOptions } from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import type { GatewayClient } from "@opendatalabs/personal-server-ts-core/gateway";
import type { Logger } from "pino";

export interface McpContext {
  indexManager: IndexManager;
  hierarchyOptions: HierarchyManagerOptions;
  gatewayClient: GatewayClient;
  serverOwner: `0x${string}`;
  logger: Logger;
}
