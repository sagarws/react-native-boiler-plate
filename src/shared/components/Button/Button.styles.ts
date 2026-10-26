import { StyleSheet } from 'react-native';
import { hp, wp } from '@/theme';

export const buttonStyles = StyleSheet.create({
  base: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: hp(32),
    borderRadius: wp(8),
    borderWidth: wp(2),
    paddingHorizontal: wp(4),
  },
  icon: { height: hp(16), width: hp(16), marginRight: wp(3) },
});
