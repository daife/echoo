import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from "react";
import { useRuntime } from "./RuntimeProvider";
import {
  BACK_HANDLER_PRIORITY,
  BackHandlerRegistry,
  dispatchBack,
  type BackHandler,
} from "../backNavigation";

interface BackNavigationContextValue {
  register: (handler: BackHandler, priority: number) => () => void;
}

const BackNavigationContext = createContext<BackNavigationContextValue>({
  register: () => () => undefined,
});

export function BackNavigationProvider({ children }: PropsWithChildren) {
  const { appNavigation } = useRuntime();
  const registryRef = useRef(new BackHandlerRegistry());
  const register = useCallback(
    (handler: BackHandler, priority: number) =>
      registryRef.current.register(handler, priority),
    [],
  );
  const value = useMemo(() => ({ register }), [register]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void | Promise<void>) | undefined;
    const handleNativeBack = () =>
      dispatchBack(
        registryRef.current,
        () => appNavigation.moveToBackground(),
        (error) => console.error("Failed to move app to background", error),
      );

    void appNavigation
      .listenBackButton(handleNativeBack)
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
  }, [appNavigation]);

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
  const handlerRef = useRef(handler);
  const enabled = options.enabled ?? true;
  const priority = options.priority ?? BACK_HANDLER_PRIORITY.page;

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useLayoutEffect(() => {
    if (!enabled) return;
    return register(() => handlerRef.current(), priority);
  }, [enabled, priority, register]);
}
