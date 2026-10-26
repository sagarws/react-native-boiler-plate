import { StyleSheet } from 'react-native';
import { hp, wp } from '@/theme';

export const THUMB_SIZE = hp(22);
const TRACK_HEIGHT = hp(6);
/** Tall enough to hit with a thumb on a phone held in a gloved hand. */
const TOUCH_HEIGHT = hp(40);

export const styles = StyleSheet.create({
  container: {
    height: TOUCH_HEIGHT,
    justifyContent: 'center',
    // Keeps the thumb inside the container when it sits at either end.
    paddingHorizontal: THUMB_SIZE / 2,
  },
  track: { height: TRACK_HEIGHT, justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderWidth: wp(2),
    top: -(THUMB_SIZE - TRACK_HEIGHT) / 2,
  },
});
