import { resolveServiceConfig } from "./config/resolve-service-config.js";
import type {
  ContextDestinations,
  ContextEntries,
  ContextValues,
  DestinationNames,
} from "./context/types.js";
import { createService } from "./service/create-service.js";
import type { Service, ServiceOptions } from "./service/types.js";

/**
 * Configures an HTTP service. Invalid options throw synchronously. Configuration opens no sockets
 * and installs no process handlers; that happens in `service.listen(app)`.
 */
export function configureService<
  // Defaults on these parameters would disable resolver parameter inference.
  const Entries extends ContextEntries<Entries>,
  const Destinations extends ContextDestinations<Entries>,
>(
  options: ServiceOptions<Entries, Destinations>,
): Service<ContextValues<Entries>, DestinationNames<Destinations>> {
  const service = createService(resolveServiceConfig(options), process);
  return service as unknown as Service<ContextValues<Entries>, DestinationNames<Destinations>>;
}
