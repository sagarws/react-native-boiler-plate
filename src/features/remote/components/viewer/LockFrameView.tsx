import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';

export interface LockFrameViewProps {
  /** The newest lock-screen JPEG (data URI). */
  uri: string;
  style: ViewStyle;
}

/**
 * The host's lock screen, double-buffered: a new picture is decoded in a
 * hidden Image and only swapped in once it has loaded, so the screen never
 * blinks empty between pictures. A picture that arrives while another is
 * still decoding replaces it (only the newest matters).
 */
export function LockFrameView({ uri, style }: LockFrameViewProps) {
  const [shown, setShown] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(uri);

  useEffect(() => {
    if (uri !== shown) setPending(uri);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  return (
    <View style={style} pointerEvents="none">
      {shown ? (
        <Image
          source={{ uri: shown }}
          resizeMode="contain"
          fadeDuration={0}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {pending && pending !== shown ? (
        <Image
          key={pending.length + pending.slice(-32)}
          source={{ uri: pending }}
          resizeMode="contain"
          fadeDuration={0}
          style={[StyleSheet.absoluteFill, styles.hidden]}
          onLoad={() => {
            setShown(pending);
            setPending(null);
          }}
          onError={() => setPending(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
});
