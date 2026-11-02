import { createContext, useContext } from 'react';

export interface DrawerControls {
  /** True only under `DrawerHost` (the signed-in app), so UI can hide a dead menu button. */
  available: boolean;
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const noop = () => undefined;

export const DrawerContext = createContext<DrawerControls>({
  available: false,
  isOpen: false,
  openDrawer: noop,
  closeDrawer: noop,
});

/** Lets any screen under `DrawerHost` raise or dismiss the side panel. */
export function useDrawer(): DrawerControls {
  return useContext(DrawerContext);
}
