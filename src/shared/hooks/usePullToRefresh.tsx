import React, { useCallback, useState } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import { useTheme } from '@/theme';

/**
 * Shared pull-to-refresh helper. Owns the `refreshing` UI flag; the caller
 * supplies the async refresh work. Returns a ready-to-attach `RefreshControl`
 * element themed with `colors.primary` so screens stay visually consistent
 * with the notifications page (the pattern this hook was extracted from).
 *
 * The caller's `onRefresh` may throw — errors are swallowed so a screen
 * doesn't get stuck in the spinning state. Screens that need to react to
 * an error should catch inside their own `onRefresh` before it returns.
 *
 * Usage:
 *   const { refreshControl } = usePullToRefresh(refetch);
 *   <ScrollView refreshControl={refreshControl} ... />
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void): {
  refreshing: boolean;
  refreshControl: React.ReactElement<RefreshControlProps>;
} {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // Intentionally swallowed — the caller's `onRefresh` is expected to
      // surface its own errors (toast / banner / retry). Rethrowing here
      // would leave the spinner stuck.
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor={colors.primary}
      colors={[colors.primary]}
    />
  );

  return { refreshing, refreshControl };
}
