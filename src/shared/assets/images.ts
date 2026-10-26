import type { ImageSourcePropType } from 'react-native';

/**
 * Icon registry. Swap the PNGs in ./images for your own artwork, keeping the
 * file names, or add a row here for each new image.
 */
export const images = {
  icon_eye: require('./images/Icon_eye.png'),
  icon_logo: require('./images/Icon_logo.png'),
  icon_back: require('./images/Icon_back.png'),
  icon_user: require('./images/Icon_user.png'),
  icon_done: require('./images/Icon_done.png'),
  icon_close: require('./images/Icon_close.png'),
  icon_email: require('./images/Icon_email.png'),
  icon_drawer: require('./images/Icon_drawer.png'),
  icon_logout: require('./images/Icon_logout.png'),
  icon_warning: require('./images/Icon_warning.png'),
  icon_eye_off: require('./images/Icon_eye_off.png'),
  icon_up_arrow: require('./images/Icon_up_arrow.png'),
  icon_app_logo: require('./images/Icon_app_logo.png'),
  /** Brand emblem, generated from public/images/logo.png. */
  app_logo: require('./images/app_logo.png'),
  icon_down_arrow: require('./images/Icon_down_arrow.png'),
  icon_close_modal: require('./images/Icon_close_modal.png'),
  icon_common_logo: require('./images/Icon_common_logo.png'),
  icon_cancel_modal: require('./images/Icon_cancel_modal.png'),
  icon_toggle_switch: require('./images/Icon_toggle_switch.png'),
} satisfies Record<string, ImageSourcePropType>;

export type ImageKey = keyof typeof images;
