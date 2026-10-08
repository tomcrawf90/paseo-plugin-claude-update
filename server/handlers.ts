import type { PluginServerContext } from "@getpaseo/plugin/server";

import { checkNow, dismissAttention, getStatus } from "../shared/status";
import type { Service } from "./service";

/**
 * The three calls the app makes. Each answers with the status as it is after
 * the call, so the screen that asked shows the result without asking again.
 */
export function handleRpcs(server: Pick<PluginServerContext, "handle">, service: Service): void {
  server.handle(getStatus, (_input, { paseo }) => service.status(paseo));
  server.handle(checkNow, async ({ apply }, { paseo }) => {
    await service.check("manual", apply);
    return service.status(paseo);
  });
  server.handle(dismissAttention, async (_input, { paseo }) => {
    await service.dismiss();
    return service.status(paseo);
  });
}
