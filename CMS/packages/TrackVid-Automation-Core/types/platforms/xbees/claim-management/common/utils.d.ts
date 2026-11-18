export function buildDriver(): Promise<any>;
export function downloadFile(url: any, filename: any, tempPath: any): Promise<string>;
export function xbeesLogin(driver: any, { username, password }: {
    username: any;
    password: any;
}): Promise<void>;
export function goToDisputePage(driver: any): Promise<void>;
export function openRaiseDisputeModal(driver: any): Promise<void>;
export function enterAwbAndGo(driver: any, awbNumber: any): Promise<void>;
export function selectMuiOption(driver: any, comboboxId: any, value: any, label: any): Promise<void>;
export function typeIntoInput(driver: any, locator: any, value: any, label: any, { slow }?: {
    slow?: boolean;
}): Promise<void>;
export function replaceSlotWithFile(driver: any, slotKey: any, filePath: any, humanLabel: any): Promise<void>;
export function uploadPackagePhotos(driver: any, packagePhotos: any): Promise<void>;
export function reportSubmitState(driver: any, tempPath: any): Promise<{
    isActive: boolean;
    btn?: undefined;
} | {
    isActive: boolean;
    btn: any;
}>;
export function clickSubmit(driver: any): Promise<{
    accepted: boolean;
    alertText: any;
}>;
export function getXbeesTicketId(driver: any, awbNumber: any): Promise<string>;
