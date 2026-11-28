import { createContext, useContext } from 'react';

export interface DrawerControls {
  /** False outside `DrawerHost` (e.g. the sign-in screens): no side panel. */
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
