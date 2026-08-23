import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { isDirectAppServerDesktop } from "~/appServer/mode";
import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";

export { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";

export type AssetUrlState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failure" }
  | { readonly _tag: "Success"; readonly url: string; readonly sourcePath?: string };

const EMPTY_ASSET_URL_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("web-asset-url:direct-empty"),
);
const EMPTY_ASSET_URLS_ATOM = Atom.make<Array<AsyncResult.AsyncResult<never, never>>>([]).pipe(
  Atom.withLabel("web-asset-urls:direct-empty"),
);

export function useAssetUrlState(
  environmentId: EnvironmentId,
  resource: AssetResource,
): AssetUrlState {
  const direct = isDirectAppServerDesktop();
  const preparedConnection = usePreparedConnection(environmentId);
  const result = useAtomValue(
    direct
      ? EMPTY_ASSET_URL_ATOM
      : assetEnvironment.createUrl({
          environmentId,
          input: { resource },
        }),
  );
  if (direct) return { _tag: "Failure" };
  if (result._tag === "Failure") {
    return { _tag: "Failure" };
  }
  if (preparedConnection._tag === "None" || result._tag !== "Success") {
    return { _tag: "Loading" };
  }
  const url = resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl);
  return url === null
    ? { _tag: "Failure" }
    : {
        _tag: "Success",
        url,
        ...(result.value.sourcePath !== undefined ? { sourcePath: result.value.sourcePath } : {}),
      };
}

export function useAssetUrl(environmentId: EnvironmentId, resource: AssetResource): string | null {
  const result = useAssetUrlState(environmentId, resource);
  if (result._tag !== "Success") {
    return null;
  }
  return result.url;
}

export function useAssetUrls(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<string | null> {
  const direct = isDirectAppServerDesktop();
  const preparedConnection = usePreparedConnection(environmentId);
  const results = useAtomValue(
    direct
      ? EMPTY_ASSET_URLS_ATOM
      : assetEnvironment.createUrls({
          environmentId,
          resources,
        }),
  );
  return useMemo(
    () =>
      direct || preparedConnection._tag === "None"
        ? resources.map(() => null)
        : results.map((result) =>
            AsyncResult.isSuccess(result)
              ? resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl)
              : null,
          ),
    [direct, preparedConnection, resources, results],
  );
}
