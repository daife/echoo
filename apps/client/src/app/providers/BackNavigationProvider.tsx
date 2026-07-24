import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { useRuntime } from "./RuntimeProvider";
import {
  BACK_HANDLER_PRIORITY,
  BackHandlerRegistry,
  type BackHandler,
} from "../backNavigation";

interface BackNavigationContextValue {
  register: (handler: BackHandler, priority: number) => () => void;
}

const BackNavigationContext = createContext<BackNavigationContextValue>({
  register: () => () => undefined,
});

const NavigationLayerActivityContext = createContext(true);

export function NavigationLayerActivityProvider({
  active,
  children,
}: PropsWithChildren<{ active: boolean }>) {
  return (
    <NavigationLayerActivityContext.Provider value={active}>
      {children}
    </NavigationLayerActivityContext.Provider>
  );
}

export function NavigationLayer({
  active,
  children,
}: PropsWithChildren<{ active: boolean }>) {
  return (
    <div
      className="h-full min-h-0"
      hidden={!active}
      aria-hidden={!active || undefined}
    >
      <NavigationLayerActivityProvider active={active}>
        {children}
      </NavigationLayerActivityProvider>
    </div>
  );
}

export function BackNavigationProvider({ children }: PropsWithChildren) {
  const { appNavigation } = useRuntime();
  const registryRef = useRef(new BackHandlerRegistry());
  const registry = registryRef.current;
  const hasHandlers = useSyncExternalStore(
    registry.subscribe,
    registry.hasHandlers,
    registry.hasHandlers,
  );
  const register = useCallback(
    (handler: BackHandler, priority: number) =>
      registry.register(handler, priority),
    [registry],
  );
  const value = useMemo(() => ({ register }), [register]);

  useEffect(() => {
    if (!hasHandlers) return;

    let cancelled = false;
    let unlisten: (() => void | Promise<void>) | undefined;

    void appNavigation
      .listenBackButton(() => registry.dispatch())
      .then((cleanup) => {
        if (cancelled) void cleanup();
        else unlisten = cleanup;
      })
      .catch((error) =>
        console.error("Failed to listen for Android back button", error),
      );

    return () => {
      cancelled = true;
      if (unlisten) void unlisten();
    };
  }, [appNavigation, hasHandlers, registry]);

  return (
    <BackNavigationContext.Provider value={value}>
      {children}
    </BackNavigationContext.Provider>
  );
}

export function useBackHandler(
  handler: BackHandler,
  options: { enabled?: boolean; priority?: number } = {},
) {
  const { register } = useContext(BackNavigationContext);
  const layerActive = useContext(NavigationLayerActivityContext);
  const handlerRef = useRef(handler);
  const enabled = options.enabled ?? true;
  const priority = options.priority ?? BACK_HANDLER_PRIORITY.page;

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useLayoutEffect(() => {
    if (!enabled || !layerActive) return;
    return register(() => handlerRef.current(), priority);
  }, [enabled, layerActive, priority, register]);
}
