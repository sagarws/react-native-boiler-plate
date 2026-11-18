export namespace SEARCH_SHAPES {
    namespace meesho {
        function rows(body: any): any;
        let matchOn: string[];
        function read(row: any): {
            subOrderNumber: string;
            orderNumber: string;
            awbNumber: string;
            sellerSku: string;
            productName: string;
            status: string;
            returnType: string;
            carrier: string;
        };
    }
    namespace snapdeal {
        export function rows_1(body: any): any[];
        export { rows_1 as rows };
        let matchOn_1: string[];
        export { matchOn_1 as matchOn };
        export function read_1(row: any): {
            subOrderNumber: string;
            awbNumber: string;
            sellerSku: string;
            supc: string;
            productName: string;
            status: string;
            courier: string;
            reference: string;
            disputeId: string;
        };
        export { read_1 as read };
    }
}
/** The platforms with an AWB search, lowercase. */
export const SEARCHABLE_PLATFORMS: string[];
/** Every row in a response body, whatever the platform buries them under. */
export function searchRows(platform: any, body: any): any;
/**
 * The row this query was actually about — null when none of them was.
 *
 * Never `rows[0]`. These are SEARCHES: they can answer with neighbours, and
 * taking the first would map a claim against whichever sorted first.
 */
export function matchingRow(platform: any, rows: any, query: any): any;
/** One row, flattened to the fields a mapping run stores or shows. */
export function readSearchRow(platform: any, row: any): any;
/**
 * Body → the matching row, already flattened. Null when nothing matched.
 *
 * The whole read in one call, so a probe holds no field names of its own.
 */
export function findSearchRow(platform: any, body: any, query: any): any;
