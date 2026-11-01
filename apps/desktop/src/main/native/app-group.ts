import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import log from "electron-log/main.js";

const requireNative = createRequire(import.meta.url);

/** `app-group.node`, built from `apps/extension/safari/app-group.m`. */
export interface AppGroupModule {
  /** The group's container path; macOS returns one even without the entitlement. */
  containerPath(identifier: string): string | null;
}

/** What the lookup reads from the running process; tests pass their own. */
interface AppGroupDeps {
  /** The app's `Contents/Resources`. */
  resourcesPath?: string;
  /** The module, or null for a build without one. */
  module?: AppGroupModule | null;
}

function loadAppGroupModule(
  resources: string | undefined,
): AppGroupModule | null {
  if (!resources) return null;
  const path = join(resources, "app-group.node");
  if (!existsSync(path)) return null;
  try {
    /** SAFETY: app-group.m exports exactly `containerPath(identifier): string | null`. */
    return requireNative(path) as AppGroupModule;
  } catch (cause) {
    log.warn("[pond native] could not load the app group module", path, cause);
    return null;
  }
}

/**
 * Asks containermanagerd for an app group container, which is what admits Pond to it.
 * Since macOS 15 an unsandboxed app gets EPERM when it creates the container itself, or a
 * file inside one the sandboxed extension created first, until it has asked this way.
 * Returns the container path, or null when the module is missing or returns no URL.
 */
export function openAppGroupContainer(
  group: string,
  deps: AppGroupDeps = {},
): string | null {
  const module =
    deps.module === undefined
      ? loadAppGroupModule(deps.resourcesPath ?? process.resourcesPath)
      : deps.module;
  return module?.containerPath(group) ?? null;
}
