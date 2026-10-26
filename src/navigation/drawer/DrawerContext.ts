import { createContext, useContext } from 'react';

export interface DrawerControls {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const noop = () => undefined;

export const DrawerContext = createContext<DrawerControls>({
  isOpen: false,
  openDrawer: noop,
  closeDrawer: noop,
});

/** Lets any screen under `DrawerHost` raise or dismiss the side panel. */
export function useDrawer(): DrawerControls {
  return useContext(DrawerContext);
}
