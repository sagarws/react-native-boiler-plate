"use client";

import { useCallback, useEffect, useRef } from "react";
import { getIn, type FormikProps } from "formik";
import type { ICmsCreate } from "@/types/cms-create";

export type CmsFormik = FormikProps<ICmsCreate>;

/** Error text for a (possibly nested) field, shown once the field was touched — same rule as the MUI helperText. */
export function errorAt(formik: CmsFormik, path: string, touchedPaths: string[] = [path]): string | undefined {
  const touched = touchedPaths.some((p) => Boolean(getIn(formik.touched, p)));
  if (!touched) return undefined;
  const raw: unknown = getIn(formik.errors, path);
  return typeof raw === "string" ? raw : undefined;
}

/** Error text regardless of touched state (array / object level errors TrackVid shows as soon as they exist). */
export function rawErrorAt(formik: CmsFormik, path: string): string | undefined {
  const raw: unknown = getIn(formik.errors, path);
  return typeof raw === "string" ? raw : undefined;
}

export const stringAt = (formik: CmsFormik, path: string): string => {
  const raw: unknown = getIn(formik.values, path);
  return typeof raw === "string" ? raw : raw == null ? "" : String(raw);
};

/** S3 key from an image URL (TrackVid writes `url.split("/").pop()` into formik for VMS shots). */
export const keyOfUrl = (url: string): string => (url.startsWith("data:") ? url : (url.split("/").pop() ?? ""));

/** Debounced call with a stable identity; the pending timer is cleared on unmount. */
export function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number): { call: (...args: A) => void; cancel: () => void } {
  const fnRef = useRef(fn);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );
  const call = useCallback(
    (...args: A) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fnRef.current(...args);
      }, ms);
    },
    [ms],
  );
  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  return { call, cancel };
}

/** True after unmount — guards promise callbacks that would otherwise write into a dead component. */
export function useUnmounted(): { readonly current: boolean } {
  const ref = useRef(false);
  useEffect(() => {
    ref.current = false;
    return () => {
      ref.current = true;
    };
  }, []);
  return ref;
}
