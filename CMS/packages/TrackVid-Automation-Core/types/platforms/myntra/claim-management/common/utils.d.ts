export function buildDriver({ sessionId, accountEmail }?: {}): Promise<any>;
export function buildDriverAndLogin(credentials: any, { accountEmail, maxAttempts, postLogin, postLoginOptions }?: {
    maxAttempts?: number;
    postLogin?: boolean;
    postLoginOptions?: {};
}): Promise<{
    driver: any;
    sessionId: any;
    ip: string;
}>;
export function destroyDriver(driver: any): Promise<void>;
export function getCurrentIp(driver: any, label: any): Promise<string>;
export function downloadFile(url: any, filename: any, tempPath: any): Promise<any>;
export function myntraLogin(driver: any, credentials: any): Promise<boolean>;
export function completePostLogin(driver: any, credentials: any, { dashboardGate, modalBestEffort }?: {
    dashboardGate?: boolean;
    modalBestEffort?: boolean;
}): Promise<boolean>;
export function handleRelationshipTypeModal(driver: any, partnerType: any): Promise<boolean>;
export function checkMyntraCredentials({ username, password, loginUrl }?: {}): Promise<{
    success: boolean;
    badCredentials: boolean;
    confirmed: boolean;
    error?: undefined;
    warning?: undefined;
} | {
    success: boolean;
    badCredentials: boolean;
    confirmed: boolean;
    error: any;
    warning?: undefined;
} | {
    success: boolean;
    badCredentials: boolean;
    confirmed: boolean;
    warning: any;
    error?: undefined;
}>;
export function navigateToCreateClaim(driver: any): Promise<boolean>;
export function searchAndApplyClaim(driver: any, awbNumber: any): Promise<{
    status: string;
    ticketId: any;
    resume?: undefined;
} | {
    status: string;
    resume: boolean;
    ticketId?: undefined;
}>;
export function probeAwbInSPFModal(driver: any, awbNumber: any): Promise<{
    belongs: boolean;
    alreadyClaimed: boolean;
    ticketId: any;
}>;
export function selectIssueCategory(driver: any, categoryText: any): Promise<void>;
export function fillIssueCategoryConditionalInput(driver: any, placeholder: any, value: any): Promise<void>;
export function fillIssueCategoryConditionalInputs(driver: any, formData: any): Promise<void>;
export function uploadShippingLabelProof(driver: any, absolutePath: any): Promise<void>;
export function removeShippingLabelProof(driver: any): Promise<void>;
export function uploadMultipleImagesForSection(driver: any, headingText: any, filePaths: any): Promise<void>;
export function uploadVideoProof(driver: any, headingText: any, absolutePath: any): Promise<void>;
export function fillAdditionalInfo(driver: any, text: any): Promise<void>;
export function tickConfirmationCheckbox(driver: any): Promise<void>;
export function submitClaim(driver: any): Promise<void>;
export function fillClaimForm(driver: any, formData: any, tempPath: any, { resume, saveCtx }?: {
    resume?: boolean;
    saveCtx?: {};
}): Promise<void>;
export function getMyntraTicketId(driver: any, awbNumber: any): Promise<any>;
export function archiveClaimFiles(configEntry: any, baseDir: any): Promise<{
    dir: string;
    savedPaths: string[];
}>;
