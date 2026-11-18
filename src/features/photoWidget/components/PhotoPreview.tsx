import React, { useMemo, useRef } from 'react';
import { Image, PanResponder, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { dragFocus, imagePlacement, photoLayout } from '../services/layout';
import type { PhotoWidget } from '../types';

/**
 * The widget as it will look on the home screen at [width] × [height]
 * (same maths as the native renderer). In crop mode, dragging the photo
 * moves the focus point.
 */
export function PhotoPreview({
  widget: w,
  width,
  height,
  onFocusChange,
  outline,
  testID,
}: {
  widget: PhotoWidget;
  width: number;
  height: number;
  onFocusChange?: (focus: { x: number; y: number }) => void;
  /** Draw the frame's edge (editor), so the chosen shape is visible in Fit. */
  outline?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const l = photoLayout({
    imgW: w.imgW,
    imgH: w.imgH,
    boxW: width,
    boxH: height,
    mode: w.mode,
    frameW: w.frameW,
    frameH: w.frameH,
    focusX: w.focusX,
    focusY: w.focusY,
    zoom: w.zoom,
  });
  const place = imagePlacement(l, w.imgW, w.imgH);
  // Image coordinates relative to the frame, which clips them.
  const imgStyle = {
    left: place.left - l.frame.left,
    top: place.top - l.frame.top,
    width: place.width,
    height: place.height,
  };

  const latest = useRef({ w, place, onFocusChange });
  latest.current = { w, place, onFocusChange };
  const start = useRef({ x: 0.5, y: 0.5 });
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () =>
          latest.current.w.mode === 'crop' && !!latest.current.onFocusChange,
        onMoveShouldSetPanResponder: () =>
          latest.current.w.mode === 'crop' && !!latest.current.onFocusChange,
        onPanResponderGrant: () => {
          start.current = {
            x: latest.current.w.focusX,
            y: latest.current.w.focusY,
          };
        },
        onPanResponderMove: (_, g) => {
          const { place: p, onFocusChange: cb } = latest.current;
          cb?.(dragFocus(start.current, g.dx, g.dy, p.width, p.height));
        },
      }),
    [],
  );

  return (
    <View testID={testID} style={{ width, height }} {...pan.panHandlers}>
      <View
        style={[
          styles.frame,
          {
            left: l.frame.left,
            top: l.frame.top,
            width: l.frame.width,
            height: l.frame.height,
            borderRadius: w.corner,
          },
          w.mode === 'fit' && { backgroundColor: colors.surfaceMuted },
          outline && [styles.outline, { borderColor: colors.textSecondary }],
        ]}
      >
        <Image
          source={{ uri: `file://${w.image}` }}
          style={[styles.image, imgStyle]}
          resizeMode="stretch"
          accessibilityIgnoresInvertColors
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', overflow: 'hidden' },
  image: { position: 'absolute' },
  outline: { borderWidth: 1, borderStyle: 'dashed' },
});
