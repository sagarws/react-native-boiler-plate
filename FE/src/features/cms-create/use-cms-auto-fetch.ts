"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/lib/events";
import { LOGISTICS_PARTNERS } from "@/mocks/cms-create";
import { getMeeshoOrderInfo, getMyntraOrderInfo, getOrderByAwb, getSnapdealOrderInfo, LookupNotFoundError } from "@/services/cms-autofetch-service";
import type { OrderLookupItem, OrderLookupRecord } from "@/types/cms-create";
import { useDebounced, useUnmounted, type CmsFormik } from "@/features/cms-create/hooks";

interface Options {
  formik: CmsFormik;
  isMyntra?: boolean;
  isMeesho?: boolean;
  isSnapdeal?: boolean;
  onReturnVideoLink?: (link: string) => void;
  onForwardVideoLink?: (link: string) => void;
  onRecords?: (records: OrderLookupRecord[]) => void;
}

const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";

/**
 * TrackVid `useCmsAutoFetch`: typing a Return / Forward AWB (or a Meesho / Snapdeal sub-order) looks the order up
 * (debounced 800 ms) and fills the video links, the other side's AWB, the customer order number and the master-data
 * records (AJIO SKU / POB picker). Toasts "Video found" / "Video not found" like TrackVid.
 */
export function useCmsAutoFetch({ formik, isMyntra, isMeesho, isSnapdeal, onReturnVideoLink, onForwardVideoLink, onRecords }: Options) {
  const unmounted = useUnmounted();
  const lastReturn = useRef("");
  const lastForward = useRef("");
  const lastSubOrder = useRef("");
  const seq = useRef({ ret: 0, fwd: 0, meesho: 0, snap: 0, myntra: 0 });
  const live = useRef({ formik, onReturnVideoLink, onForwardVideoLink, onRecords });
  useEffect(() => {
    live.current = { formik, onReturnVideoLink, onForwardVideoLink, onRecords };
  });

  const set = (field: string, value: string) => void live.current.formik.setFieldValue(field, value);
  const lookupRef = useRef<(value: string, side: "Return" | "Forward") => void>(() => undefined);
  const fetchReturn = useDebounced((awb: string) => lookupRef.current(awb, "Return"), 800);
  const fetchForward = useDebounced((awb: string) => lookupRef.current(awb, "Forward"), 800);

  const applyReturn = (items: OrderLookupItem[], records?: OrderLookupRecord[]) => {
    const data = items[0];
    if (!data) return;
    if (data.return_video_link) {
      set("returnVideoLink", data.return_video_link);
      live.current.onReturnVideoLink?.(data.return_video_link);
    }
    if (data.return_awb) set("AWBNumber", data.return_awb);
    if (data.customerOrderNumber) set("customerOrderNumber", data.customerOrderNumber);
    if (data.forward_awb && data.forward_awb !== lastForward.current) {
      lastForward.current = data.forward_awb;
      set("forwardAWB", data.forward_awb);
      fetchForward.call(data.forward_awb);
    }
    if (records && records.length) live.current.onRecords?.(records);
  };

  const applyForward = (items: OrderLookupItem[], records?: OrderLookupRecord[]) => {
    const data = items[0];
    if (!data) return;
    const v = live.current.formik.values;
    if (data.forward_video_link && blank(v.forwardVideoLink)) {
      set("forwardVideoLink", data.forward_video_link);
      live.current.onForwardVideoLink?.(data.forward_video_link);
    }
    if (data.forward_awb && blank(v.forwardAWB)) set("forwardAWB", data.forward_awb);
    if (data.customerOrderNumber && blank(v.customerOrderNumber)) set("customerOrderNumber", data.customerOrderNumber);
    if (data.return_awb && data.return_awb !== lastReturn.current && blank(v.AWBNumber)) {
      lastReturn.current = data.return_awb;
      set("AWBNumber", data.return_awb);
      fetchReturn.call(data.return_awb);
    }
    if (records && records.length) live.current.onRecords?.(records);
  };

  const lookup = (value: string, side: "Return" | "Forward") => {
    const awb = value.trim();
    if (!awb) return;
    const key = side === "Return" ? "ret" : "fwd";
    const id = ++seq.current[key];
    getOrderByAwb(awb, side)
      .then((res) => {
        if (id !== seq.current[key] || unmounted.current) return;
        if (side === "Return") applyReturn(res.data, res.records);
        else applyForward(res.data, res.records);
        if (res.data.length) toast.success("Video found");
      })
      .catch((err: unknown) => {
        if (id !== seq.current[key] || unmounted.current) return;
        if (err instanceof LookupNotFoundError) toast.error("Video not found");
      });
  };

  useEffect(() => {
    lookupRef.current = lookup;
  });

  const fetchMeesho = useDebounced((params: { subOrderNo?: string; returnAwbNo?: string; forwardAwbNo?: string }) => {
    if (!Object.values(params).some((v) => v && v.trim())) return;
    const id = ++seq.current.meesho;
    getMeeshoOrderInfo(params)
      .then((res) => {
        if (id !== seq.current.meesho || unmounted.current || !res.isSuccess || !res.data) return;
        const { subOrderNo, returnAwbNo, forwardAwbNo, courierPartner } = res.data;
        if (subOrderNo && subOrderNo !== lastSubOrder.current) {
          lastSubOrder.current = subOrderNo;
          set("subOrderNumber", subOrderNo);
        }
        if (returnAwbNo && returnAwbNo !== lastReturn.current) {
          lastReturn.current = returnAwbNo;
          set("AWBNumber", returnAwbNo);
          fetchReturn.call(returnAwbNo);
        }
        if (forwardAwbNo && forwardAwbNo !== lastForward.current) {
          lastForward.current = forwardAwbNo;
          set("forwardAWB", forwardAwbNo);
          fetchForward.call(forwardAwbNo);
        }
        if (courierPartner && LOGISTICS_PARTNERS.includes(courierPartner)) set("logisticsPartnerName", courierPartner);
      })
      .catch(() => {
        // Master-data miss: the operator types the fields by hand.
      });
  }, 800);

  const fetchSnapdeal = useDebounced((params: { subOrderNo?: string; returnAwbNo?: string; forwardAwbNo?: string }) => {
    if (!Object.values(params).some((v) => v && v.trim())) return;
    const id = ++seq.current.snap;
    getSnapdealOrderInfo(params)
      .then((res) => {
        if (id !== seq.current.snap || unmounted.current || !res.isSuccess || !res.data) return;
        const { subOrderNo, returnAwbNo, forwardAwbNo } = res.data;
        if (subOrderNo && subOrderNo !== lastSubOrder.current) {
          lastSubOrder.current = subOrderNo;
          set("subOrderNumber", subOrderNo);
        }
        if (returnAwbNo && returnAwbNo !== lastReturn.current) {
          lastReturn.current = returnAwbNo;
          set("AWBNumber", returnAwbNo);
          fetchReturn.call(returnAwbNo);
        }
        if (forwardAwbNo && forwardAwbNo !== lastForward.current) {
          lastForward.current = forwardAwbNo;
          set("forwardAWB", forwardAwbNo);
          fetchForward.call(forwardAwbNo);
        }
      })
      .catch(() => {
        // Master-data miss: the operator types the fields by hand.
      });
  }, 800);

  const fetchMyntra = useDebounced((params: { returnTrackingNumber?: string; forwardTrackingNumber?: string }) => {
    if (!Object.values(params).some((v) => v && v.trim())) return;
    const id = ++seq.current.myntra;
    getMyntraOrderInfo(params)
      .then((res) => {
        if (id !== seq.current.myntra || unmounted.current || !res.isSuccess || !res.data) return;
        const { returnTrackingNumber, forwardTrackingNumber, returnVideoLink, forwardVideoLink } = res.data;
        if (returnTrackingNumber && returnTrackingNumber !== lastReturn.current) {
          lastReturn.current = returnTrackingNumber;
          set("AWBNumber", returnTrackingNumber);
        }
        if (forwardTrackingNumber && forwardTrackingNumber !== lastForward.current) {
          lastForward.current = forwardTrackingNumber;
          set("forwardAWB", forwardTrackingNumber);
        }
        if (returnVideoLink) {
          set("returnVideoLink", returnVideoLink);
          live.current.onReturnVideoLink?.(returnVideoLink);
        }
        if (forwardVideoLink) {
          set("forwardVideoLink", forwardVideoLink);
          live.current.onForwardVideoLink?.(forwardVideoLink);
        }
      })
      .catch(() => {
        // Master-data miss: the operator types the fields by hand.
      });
  }, 800);

  const onReturnAwbChange = (value: string) => {
    set("AWBNumber", value);
    lastReturn.current = value;
    fetchReturn.call(value);
    if (isMyntra) fetchMyntra.call({ returnTrackingNumber: value });
    if (isMeesho) fetchMeesho.call({ returnAwbNo: value });
    if (isSnapdeal) fetchSnapdeal.call({ returnAwbNo: value });
  };

  const onForwardAwbChange = (value: string) => {
    set("forwardAWB", value);
    lastForward.current = value;
    fetchForward.call(value);
    if (isMyntra) fetchMyntra.call({ forwardTrackingNumber: value });
    if (isMeesho) fetchMeesho.call({ forwardAwbNo: value });
    if (isSnapdeal) fetchSnapdeal.call({ forwardAwbNo: value });
  };

  const onSubOrderChange = (value: string) => {
    set("subOrderNumber", value);
    lastSubOrder.current = value;
    if (isMeesho) fetchMeesho.call({ subOrderNo: value });
    if (isSnapdeal) fetchSnapdeal.call({ subOrderNo: value });
  };

  return { onReturnAwbChange, onForwardAwbChange, onSubOrderChange };
}
