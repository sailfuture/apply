"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export interface SaveHandlerOptions {
  label?: string;
  disabled?: boolean;
  saving?: boolean;
}

interface ApplicationFlowContextValue {
  // Page title (shown in header on form pages)
  pageTitle: string;
  setPageTitle: (title: string) => void;

  // Save handler (form pages register their save fn)
  saveHandler: (() => Promise<void> | void) | null;
  saveOptions: SaveHandlerOptions;
  registerSaveHandler: (
    handler: () => Promise<void> | void,
    options?: SaveHandlerOptions
  ) => void;
  unregisterSaveHandler: () => void;
  updateSaveOptions: (options: Partial<SaveHandlerOptions>) => void;

  // Back guard (form pages can block navigation when dirty)
  backGuard: (() => boolean) | null;
  registerBackGuard: (guard: () => boolean) => void;
  unregisterBackGuard: () => void;

  // Back override (form pages can intercept back to handle sub-navigation)
  onBack: (() => void) | null;
  registerOnBack: (handler: () => void) => void;
  unregisterOnBack: () => void;

  // Hide layout chrome (header + bottom bar) for full-page sub-views
  hideChrome: boolean;
  setHideChrome: (hide: boolean) => void;
}

const ApplicationFlowContext = createContext<ApplicationFlowContextValue | null>(
  null
);

export function ApplicationFlowProvider({ children }: { children: ReactNode }) {
  const [pageTitle, setPageTitle] = useState("");
  const [saveHandler, setSaveHandler] = useState<
    (() => Promise<void> | void) | null
  >(null);
  const [saveOptions, setSaveOptions] = useState<SaveHandlerOptions>({});
  const [backGuard, setBackGuard] = useState<(() => boolean) | null>(null);
  const [onBack, setOnBack] = useState<(() => void) | null>(null);
  const [hideChrome, setHideChrome] = useState(false);

  const registerSaveHandler = useCallback(
    (handler: () => Promise<void> | void, options?: SaveHandlerOptions) => {
      setSaveHandler(() => handler);
      setSaveOptions(options ?? {});
    },
    []
  );

  const unregisterSaveHandler = useCallback(() => {
    setSaveHandler(null);
    setSaveOptions({});
  }, []);

  const updateSaveOptions = useCallback(
    (options: Partial<SaveHandlerOptions>) => {
      setSaveOptions((prev) => ({ ...prev, ...options }));
    },
    []
  );

  const registerBackGuard = useCallback((guard: () => boolean) => {
    setBackGuard(() => guard);
  }, []);

  const unregisterBackGuard = useCallback(() => {
    setBackGuard(null);
  }, []);

  const registerOnBack = useCallback((handler: () => void) => {
    setOnBack(() => handler);
  }, []);

  const unregisterOnBack = useCallback(() => {
    setOnBack(null);
  }, []);

  return (
    <ApplicationFlowContext.Provider
      value={{
        pageTitle,
        setPageTitle,
        saveHandler,
        saveOptions,
        registerSaveHandler,
        unregisterSaveHandler,
        updateSaveOptions,
        backGuard,
        registerBackGuard,
        unregisterBackGuard,
        onBack,
        registerOnBack,
        unregisterOnBack,
        hideChrome,
        setHideChrome,
      }}
    >
      {children}
    </ApplicationFlowContext.Provider>
  );
}

export function useApplicationFlow() {
  const ctx = useContext(ApplicationFlowContext);
  if (!ctx) {
    throw new Error(
      "useApplicationFlow must be used within ApplicationFlowProvider"
    );
  }
  return ctx;
}
