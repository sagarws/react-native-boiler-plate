export type RefillFieldConfig = {
    /**
     * whether Refill will attempt this field
     */
    action: boolean;
    /**
     * the core function that answers it
     */
    api: string | null;
    /**
     * the marketplace call that function makes
     */
    endpoint?: string;
    /**
     * why `action` is false
     */
    reason?: string;
};
export namespace REFILL_CONFIG {
    namespace ajio {
        namespace accountMapping {
            let action: boolean;
            let api: any;
            let endpoint: string;
        }
        namespace forwardAwbNumber {
            let action_1: boolean;
            export { action_1 as action };
            let api_1: any;
            export { api_1 as api };
            let endpoint_1: string;
            export { endpoint_1 as endpoint };
        }
        namespace sellerSku {
            let action_2: boolean;
            export { action_2 as action };
            let api_2: any;
            export { api_2 as api };
            let endpoint_2: string;
            export { endpoint_2 as endpoint };
        }
        namespace pobId {
            let action_3: boolean;
            export { action_3 as action };
            let api_3: any;
            export { api_3 as api };
            let endpoint_3: string;
            export { endpoint_3 as endpoint };
        }
        namespace statusChange {
            let action_4: boolean;
            export { action_4 as action };
            let api_4: string;
            export { api_4 as api };
            let endpoint_4: string;
            export { endpoint_4 as endpoint };
        }
    }
    namespace myntra {
        export namespace accountMapping_1 {
            let action_5: boolean;
            export { action_5 as action };
            let api_5: string;
            export { api_5 as api };
            let endpoint_5: string;
            export { endpoint_5 as endpoint };
        }
        export { accountMapping_1 as accountMapping };
        export namespace forwardAwbNumber_1 {
            let action_6: boolean;
            export { action_6 as action };
            let api_6: string;
            export { api_6 as api };
            let endpoint_6: string;
            export { endpoint_6 as endpoint };
        }
        export { forwardAwbNumber_1 as forwardAwbNumber };
        export namespace statusChange_1 {
            let action_7: boolean;
            export { action_7 as action };
            let api_7: string;
            export { api_7 as api };
            let endpoint_7: string;
            export { endpoint_7 as endpoint };
        }
        export { statusChange_1 as statusChange };
    }
    namespace meesho {
        export namespace accountMapping_2 {
            let action_8: boolean;
            export { action_8 as action };
            let api_8: string;
            export { api_8 as api };
            let endpoint_8: string;
            export { endpoint_8 as endpoint };
        }
        export { accountMapping_2 as accountMapping };
        export namespace subOrderNumber {
            let action_9: boolean;
            export { action_9 as action };
            let api_9: string;
            export { api_9 as api };
            let endpoint_9: string;
            export { endpoint_9 as endpoint };
        }
        export namespace statusChange_2 {
            let action_10: boolean;
            export { action_10 as action };
            let api_10: string;
            export { api_10 as api };
            let endpoint_10: string;
            export { endpoint_10 as endpoint };
        }
        export { statusChange_2 as statusChange };
    }
    namespace snapdeal {
        export namespace accountMapping_3 {
            let action_11: boolean;
            export { action_11 as action };
            let api_11: string;
            export { api_11 as api };
            let endpoint_11: string;
            export { endpoint_11 as endpoint };
        }
        export { accountMapping_3 as accountMapping };
        export namespace subOrderNumber_1 {
            let action_12: boolean;
            export { action_12 as action };
            let api_12: string;
            export { api_12 as api };
            let endpoint_12: string;
            export { endpoint_12 as endpoint };
        }
        export { subOrderNumber_1 as subOrderNumber };
        export namespace statusChange_3 {
            let action_13: boolean;
            export { action_13 as action };
            let api_13: string;
            export { api_13 as api };
            let endpoint_13: string;
            export { endpoint_13 as endpoint };
        }
        export { statusChange_3 as statusChange };
    }
    namespace flipkart {
        export namespace accountMapping_4 {
            let action_14: boolean;
            export { action_14 as action };
            let api_14: string;
            export { api_14 as api };
            let endpoint_14: string;
            export { endpoint_14 as endpoint };
        }
        export { accountMapping_4 as accountMapping };
        export namespace statusChange_4 {
            let action_15: boolean;
            export { action_15 as action };
            let api_15: string;
            export { api_15 as api };
            let endpoint_15: string;
            export { endpoint_15 as endpoint };
        }
        export { statusChange_4 as statusChange };
    }
    namespace delhivery {
        export namespace accountMapping_5 {
            let action_16: boolean;
            export { action_16 as action };
            let api_16: string;
            export { api_16 as api };
            let endpoint_16: string;
            export { endpoint_16 as endpoint };
        }
        export { accountMapping_5 as accountMapping };
        export namespace statusChange_5 {
            let action_17: boolean;
            export { action_17 as action };
            let api_17: string;
            export { api_17 as api };
            let endpoint_17: string;
            export { endpoint_17 as endpoint };
        }
        export { statusChange_5 as statusChange };
    }
    namespace tatacliq {
        export namespace accountMapping_6 {
            let action_18: boolean;
            export { action_18 as action };
            let api_18: string;
            export { api_18 as api };
            let endpoint_18: string;
            export { endpoint_18 as endpoint };
        }
        export { accountMapping_6 as accountMapping };
        export namespace forwardAwbNumber_2 {
            let action_19: boolean;
            export { action_19 as action };
            let api_19: string;
            export { api_19 as api };
            let endpoint_19: string;
            export { endpoint_19 as endpoint };
        }
        export { forwardAwbNumber_2 as forwardAwbNumber };
        export namespace statusChange_6 {
            let action_20: boolean;
            export { action_20 as action };
            let api_20: any;
            export { api_20 as api };
            export let reason: string;
        }
        export { statusChange_6 as statusChange };
    }
    namespace nykaa {
        export namespace statusChange_7 {
            let action_21: boolean;
            export { action_21 as action };
            let api_21: string;
            export { api_21 as api };
            let endpoint_20: string;
            export { endpoint_20 as endpoint };
        }
        export { statusChange_7 as statusChange };
    }
    namespace xbees {
        export namespace accountMapping_7 {
            let action_22: boolean;
            export { action_22 as action };
            let api_22: string;
            export { api_22 as api };
            let endpoint_21: string;
            export { endpoint_21 as endpoint };
        }
        export { accountMapping_7 as accountMapping };
    }
}
/** Platforms Refill Data is offered on. */
export const REFILL_PLATFORMS: string[];
/** The fields Refill can attempt for one platform, in the order they are shown. */
export function refillFields(platform: any): string[];
/** Can this platform resolve this field? */
export function canRefill(platform: any, field: any): boolean;
