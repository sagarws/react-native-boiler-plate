import { enableStealthMode } from "../../claim-management/common/utils";
import { handleDialog } from "../../claim-management/common/utils";
import { snapdealLogin } from "../../claim-management/common/utils";
/**
 * Wrap snapdealLogin with retry. The shared login helper throws
 */
export function snapdealLoginWithRetry(page: any, credentials: any, maxAttempts?: number): Promise<boolean>;
export function sleep(ms: any): Promise<any>;
export function selectDropdownOption(page: any, refineType: any, optionTitle: any): Promise<void>;
export function navigateToReportsTab(page: any): Promise<void>;
export function openCreateReportModal(page: any): Promise<void>;
export function clickChooseDateRange(page: any): Promise<void>;
/**
 * Select a start + end date on the Generate Report date range picker.
 */
export function selectDateRange(page: any, startDate: any, endDate: any): Promise<void>;
/**
 * Click the Apply button in the date-range popover
 */
export function clickApplyDateRange(page: any): Promise<Date>;
/**
 * Click the "Generate Report" submit button in the modal footer.
 */
export function clickGenerateReport(page: any): Promise<Date>;
/**
 * Find the report-card that matches our just-submitted request.
 */
export function findReportCardByRequestTime(page: any, { reportName, requestedAt, toleranceMinutes }: {
    reportName: any;
    requestedAt: any;
    toleranceMinutes?: number;
}): Promise<any>;
/**
 * Find a report-card by exact initiation text
 */
export function findReportCardByInitiationText(page: any, { reportName, initiationText }: {
    reportName: any;
    initiationText: any;
}): Promise<any>;
/**
 * Trigger the Download button of a specific report-card (matched by exact initiation text).
 */
export function clickReportDownload(page: any, { reportName, initiationText }: {
    reportName: any;
    initiationText: any;
}): Promise<any>;
export { enableStealthMode, handleDialog, snapdealLogin };
