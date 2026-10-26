import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Whether the soft keyboard is currently up.
 *
 * The Android window is set to `adjustResize`, so by the time this flips true
 * the screen has already lost that height — screens use it to shed decoration
 * rather than to compute an offset.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}
