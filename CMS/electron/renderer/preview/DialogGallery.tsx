// React Imports
import { useEffect, useMemo, useState, type ReactNode } from 'react'

// Context Imports
import { SettingsProvider } from '@core/contexts/settingsContext'
import { VerticalNavProvider } from '@menu/contexts/verticalNavContext'

// Theme Imports
import { VuexyThemeProvider } from '@renderer/theme/VuexyThemeProvider'

// App providers — the same ones App.tsx mounts around its pages
import { NotificationProvider } from '@renderer/components/feedback/NotificationStore'
import { ToastProvider } from '@renderer/components/feedback/ToastProvider'
import { AuthProvider } from '@renderer/context/AuthContext'
import { DevModeProvider } from '@renderer/context/DevModeContext'
import { initialAppearance } from '@renderer/services/preferences.service'

// Type Imports
import type { BulkSpfPlan, BulkSpfResultRow } from '@shared/types/bulkSpf'
import type { AjioReturnOrderLine } from '@shared/types/masterDataReport'
import type { MailboxSummary } from '@shared/types/emailReply'
import type { PlatformDescriptor } from '@shared/types/platformSession'

// Dialog Imports
import { UpdateLogDialog } from '@renderer/components/update/UpdateLogDialog'
import { BulkClaimModal } from '@renderer/pages/claims/BulkClaimModal'
import { BulkEditModal } from '@renderer/pages/claims/BulkEditModal'
import { BulkPlanModal } from '@renderer/pages/claims/BulkPlanModal'
import { ReClaimModal } from '@renderer/pages/claims/ReClaimModal'
import { ReClaimTicketModal, type TicketView } from '@renderer/pages/claims/ReClaimTicketModal'
import { RefillProgressModal } from '@renderer/pages/claims/RefillProgressModal'
import { RetryScopeModal } from '@renderer/pages/claims/RetryScopeModal'
import { SkuSweepModal } from '@renderer/pages/claims/SkuSweepModal'
import { TatCheckModal } from '@renderer/pages/claims/TatCheckModal'
import { TicketThreadModal } from '@renderer/pages/claims/TicketThreadModal'
import { VideoSizeModal } from '@renderer/pages/claims/VideoSizeModal'
import CreateBulkClaimModal from '@renderer/pages/claims/create/BulkClaimModal'
import { ClaimCatalogueProvider, accountsFor, useClaimCatalogue } from '@renderer/pages/claims/create/ClaimCatalogue'
import RearrangeModal, { type ArrangementField } from '@renderer/pages/claims/create/RearrangeModal'
import EditBulkRowDialog from '@renderer/pages/claims/create/bulk/EditBulkRowDialog'
import NormalBulkClaimModal from '@renderer/pages/claims/create/bulk/NormalBulkClaimModal'
import { platformSheets, type BulkRow } from '@renderer/pages/claims/create/bulk/normalBulk'
import CameraPermissionModal from '@renderer/pages/claims/create/media/CameraPermissionModal'
import UploadModal from '@renderer/pages/claims/create/media/UploadModal'
import ReturnOrderPickerModal from '@renderer/pages/claims/create/platforms/ajio/ReturnOrderPickerModal'
import AjioSkuPickerModal from '@renderer/pages/claims/create/platforms/ajio/SkuPickerModal'
import { LastSyncDialog } from '@renderer/pages/email/LastSyncDialog'
import { AddCredentialModal } from '@renderer/pages/sessions/AddCredentialModal'
import { OtpPeekModal } from '@renderer/pages/sessions/OtpPeekModal'
import { BackupCalendarModal } from '@renderer/pages/settings/BackupCalendarModal'
import { BackupViewerModal } from '@renderer/pages/settings/BackupViewerModal'
import { CronHistoryModal } from '@renderer/pages/settings/CronHistoryModal'
import { CronModal } from '@renderer/pages/settings/CronModal'
import { FlipkartBackupCalendarModal } from '@renderer/pages/settings/FlipkartBackupCalendarModal'
import { FlipkartRequestCalendarModal } from '@renderer/pages/settings/FlipkartRequestCalendarModal'
import { FlipkartViewerModal } from '@renderer/pages/settings/FlipkartViewerModal'
import { SnapdealBackupCalendarModal } from '@renderer/pages/settings/SnapdealBackupCalendarModal'
import { SnapdealRequestCalendarModal } from '@renderer/pages/settings/SnapdealRequestCalendarModal'
import { SnapdealViewerModal } from '@renderer/pages/settings/SnapdealViewerModal'

// Sample screenshots for the image dialogs — the app's own bundled marketplace logos.
import ajioImage from '@renderer/assets/marketplaces/ajio.png'
import myntraImage from '@renderer/assets/marketplaces/myntra.png'
import flipkartImage from '@renderer/assets/marketplaces/flipkart.png'
import meeshoImage from '@renderer/assets/marketplaces/meesho.png'
import snapdealImage from '@renderer/assets/marketplaces/snapdeal.png'

// The stylesheet the app renders from (AppRoot imports the same file).
import '../styles/app.css'

/**
 * PREVIEW ONLY. Every dialog in the app, one at a time, open, with static
 * sample props — `#dialog-gallery=<name>`.
 *
 * Most of these dialogs open only from a live automation state (a run halfway
 * through, a ticket just disputed), which a screenshot cannot reach. This page
 * mounts the providers App.tsx mounts and renders exactly one dialog, so the
 * re-skin can be looked at. All data here is invented; every callback is a
 * no-op. Data a dialog reads on open still goes through `invoke`, which in the
 * preview harness is answered by a stub bridge.
 */

const noop = (): void => {}

const STAMP = '2026-11-17T06:00:00.000Z'

const PLAN: BulkSpfPlan = {
  rows: [
    { key: 'NDR::14920037751::AJ-KT-0192-M', awb: '14920037751', sku: 'AJ-KT-0192-M', claimType: 'NDR', pobid: 'POB30120', account: 'seller.one@example.com', claimable: true, reason: '' },
    { key: 'NDR::14920037768::AJ-KT-0207-L', awb: '14920037768', sku: 'AJ-KT-0207-L', claimType: 'NDR', pobid: 'POB30120', account: 'seller.one@example.com', claimable: true, reason: '' },
    { key: 'DDR::14920038102::AJ-ML-1140-S', awb: '14920038102', sku: 'AJ-ML-1140-S', claimType: 'DDR', pobid: 'POB30131', account: 'seller.two@example.com', claimable: true, reason: '' },
    { key: 'DDR::14920038119::AJ-ML-1152-XL', awb: '14920038119', sku: 'AJ-ML-1152-XL', claimType: 'DDR', pobid: 'POB30131', account: 'seller.two@example.com', claimable: true, reason: '' },
    { key: 'NDR::14920038345::AJ-IF-0880-M', awb: '14920038345', sku: 'AJ-IF-0880-M', claimType: 'NDR', pobid: '', account: '', claimable: false, reason: 'No POB ID on the row' },
    { key: 'NDR::14920038352::AJ-IF-0881-M', awb: '14920038352', sku: 'AJ-IF-0881-M', claimType: 'NDR', pobid: 'POB30188', account: '', claimable: false, reason: 'Already claimed (ticket TKT-55120)' },
    { key: 'DDR::14920038490::AJ-SS-2044-L', awb: '14920038490', sku: 'AJ-SS-2044-L', claimType: 'DDR', pobid: 'POB30999', account: '', claimable: false, reason: 'No AJIO login lists this POB' }
  ],
  buckets: { claimable: 4, alreadyClaimed: 1, missingPob: 1, unknownType: 0, noAccount: 1, notSelected: 0, duplicate: 0, noReturnNumber: 0 }
}

const result = (
  awb: string,
  sku: string,
  outcome: BulkSpfResultRow['result'],
  extra: Partial<BulkSpfResultRow> = {}
): BulkSpfResultRow => ({
  awb,
  sku,
  claimType: 'NDR',
  pobid: 'POB30120',
  orderStatus: 'RTO Delivered',
  result: outcome,
  reason: '',
  ticketNumber: '',
  error: '',
  timestamp: STAMP,
  ...extra
})

const RETRY_ROWS: BulkSpfResultRow[] = [
  result('14920037751', 'AJ-KT-0192-M', 'Success', { ticketNumber: 'TKT-55201' }),
  result('14920037768', 'AJ-KT-0207-L', 'Success', { ticketNumber: 'TKT-55202' }),
  result('14920038102', 'AJ-ML-1140-S', 'Failed', { error: 'Upload timed out after 60s' }),
  result('14920038119', 'AJ-ML-1152-XL', 'Help Center Failed', { error: 'Help Center form did not load' }),
  result('14920038345', 'AJ-IF-0880-M', 'Failed', { error: 'Return not found under POB30120' }),
  result('14920038352', 'AJ-IF-0881-M', 'Skipped', { reason: 'Already claimed', final: true })
]

const TICKET_VIEW: TicketView = {
  ticketId: 'MYN-TKT-88412035',
  loading: false,
  outcome: { ok: true, message: 'Dispute raised. Myntra now shows the ticket as Re-opened.' },
  payload: {
    ticketId: 'MYN-TKT-88412035',
    issueCategory: 'Item damaged in return',
    remarks: 'Return received torn; footage attached.',
    attachments: ['packing-video.mp4', 'label.jpg']
  },
  error: null,
  ticket: {
    found: true,
    status: 'Re-opened',
    originalStatus: 'Rejected',
    validationReason: 'VMS_Footage_Not_Available_FWRD',
    row: {
      ticketId: 'MYN-TKT-88412035',
      status: 'Re-opened',
      originalStatus: 'Rejected',
      validationReason: 'VMS_Footage_Not_Available_FWRD',
      issueCategory: 'Item damaged in return',
      returnReason: 'Product damaged',
      trackingId: 'ML7730129845',
      orderId: '1209938471-7712',
      returnId: 'RET-55120389',
      skuId: '33019284',
      styleId: '21048871',
      compensationAmount: 1299,
      lastModifiedOn: STAMP,
      sellerId: 'SLR-4412',
      warehouseId: 'WH-BLR-03'
    }
  }
}

const REARRANGE_SCHEMA: ArrangementField[] = [
  { fieldName: 'returnProductImage', label: 'Return Product', position: 'first' },
  { fieldName: 'podProof', label: 'POD Proof', position: 'middle' },
  { fieldName: 'shippingLabel', label: 'Shipping Label', position: 'middle' },
  { fieldName: 'forwardSentProductImage', label: 'Forward Sent Product', position: 'last' }
]

const SAMPLE_IMAGES = [ajioImage, myntraImage, flipkartImage, meeshoImage, snapdealImage]

const RETURN_LINES: AjioReturnOrderLine[] = [
  ['14920037751', 'FWD8830112', '8905123401928', 'AJ-KT-0192-M', '465012839', 'Kesar Threads'],
  ['14920037751', 'FWD8830112', '8905123402079', 'AJ-KT-0207-L', '465012846', 'Kesar Threads'],
  ['14920037751', 'FWD8830112', '8905123411408', 'AJ-ML-1140-S', '465013377', 'Monsoon Mile']
].map(([returnAwbNo, fwdAwbNo, ean, sellerSku, jioCode, brand]) => ({
  returnOrderNo: 'RO-7714209931',
  returnAwbNo: returnAwbNo ?? null,
  fwdAwbNo: fwdAwbNo ?? null,
  ean: ean ?? null,
  pobId: 'POB30120',
  sellerSku: sellerSku ?? null,
  jioCode: jioCode ?? null,
  custOrderNo: 'FN4410298831',
  returnCreateDate: '2026-11-09',
  returnStatus: 'RTO Delivered',
  returnType: 'Customer Return',
  brand: brand ?? null
}))

const SKU_RECORDS = [
  { _id: 'mi_1', sku: 'AJ-KT-0192-M', returnAwb: '14920037751', forwardAwb: 'FWD8830112', orderNo: 'FN4410298831', pobId: 'POB30120' },
  { _id: 'mi_2', sku: 'AJ-KT-0207-L', returnAwb: '14920037768', forwardAwb: 'FWD8830112', orderNo: 'FN4410298831', pobId: 'POB30120' },
  { _id: 'mi_3', sku: 'AJ-ML-1140-S', returnAwb: '14920038102', forwardAwb: 'FWD8830112', orderNo: 'FN4410298831', pobId: 'POB30120' },
  { _id: 'mi_4', sku: '', returnAwb: '14920038119', forwardAwb: 'FWD8830112', orderNo: 'FN4410298831', pobId: 'POB30120' }
]

const MAILBOX: MailboxSummary = {
  id: 'mb_1',
  email: 'returns@example.com',
  displayName: 'Returns desk',
  provider: 'google',
  authType: 'oauth',
  status: 'connected',
  lastSyncedAt: '2026-11-17T04:45:00.000Z',
  createdAt: '2026-08-02T09:00:00.000Z'
}

const SESSION_PLATFORMS: PlatformDescriptor[] = [
  ['ajio', 'AJIO'],
  ['myntra', 'Myntra'],
  ['flipkart', 'Flipkart'],
  ['snapdeal', 'Snapdeal'],
  ['meesho', 'Meesho'],
  ['nykaa', 'Nykaa Fashion']
].map(([key, label]) => ({
  key: key ?? '',
  label: label ?? '',
  loginUrl: `https://${key ?? ''}.example.com/login`,
  automations: ['claim', 'masterImport']
}))

/** Side images for the upload dialog, built from the bundled logos. */
const useSideImages = (): File[] => {
  const [files, setFiles] = useState<File[]>([])

  useEffect(() => {
    let cancelled = false

    void Promise.all(
      SAMPLE_IMAGES.slice(0, 3).map(async (url, index) => {
        const blob = await fetch(url).then(response => response.blob())

        return new File([blob], `side-${index + 1}.png`, { type: 'image/png' })
      })
    )
      .then(loaded => {
        if (!cancelled) setFiles(loaded)
      })
      .catch(noop)

    return () => {
      cancelled = true
    }
  }, [])

  return files
}

const UploadSample = () => {
  const sideImages = useSideImages()

  return <UploadModal open onClose={noop} handleFileChange={noop} sideImages={sideImages} />
}

/** An invalid Myntra row from a filled-in bulk sheet, built on the catalogue's own columns. */
const EditBulkRowSample = () => {
  const catalogue = useClaimCatalogue()
  const sheets = useMemo(
    () => platformSheets(catalogue.platforms, platform => accountsFor(catalogue, platform), catalogue),
    [catalogue]
  )
  const sheet = sheets.find(entry => entry.label.toLowerCase() === 'myntra') ?? sheets[0]

  const row = useMemo<BulkRow | null>(() => {
    if (!sheet) return null

    const samples = ['ML7730129845', 'Product damaged', 'seller.one@example.com', '1209938471-7712', '1299']
    const cells = Object.fromEntries(
      sheet.columns.map((column, index) => [column.header, index === 2 ? '' : (samples[index % samples.length] ?? '')])
    )

    return {
      id: `${sheet.label}:7`,
      sheet: sheet.label,
      rowNumber: 7,
      platformLabel: sheet.label,
      awb: 'ML7730129845',
      claimType: 'Product damaged',
      status: 'invalid',
      errors: [`${sheet.columns[2]?.header ?? 'A required column'} is empty`],
      videoFound: true,
      screenshots: 4,
      cells,
      refill: { source: 'local', filled: ['forwardAwbNumber'], message: 'Forward AWB filled from master data' },
      platform: sheet
    }
  }, [sheet])

  return <EditBulkRowDialog row={row} onClose={noop} onSave={noop} />
}

const DIALOGS = {
  'u17-update-log': () => <UpdateLogDialog open onClose={noop} />,
  'u18-claims-bulkclaim': () => <BulkClaimModal open onClose={noop} onMinimise={noop} onOpenJobs={noop} />,
  'u19-claims-bulkedit': () => (
    <BulkEditModal open count={38} platform="ajio" saving={false} onSubmit={noop} onClose={noop} />
  ),
  'u20-claims-bulkplan': () => <BulkPlanModal open plan={PLAN} busy={false} onClose={noop} onSubmit={noop} />,
  'u24-claims-reclaim': () => <ReClaimModal open onClose={noop} />,
  'u25-claims-reclaim-ticket': () => <ReClaimTicketModal view={TICKET_VIEW} onClose={noop} />,
  'u27-claims-refill-progress': () => <RefillProgressModal open total={24} onClose={noop} />,
  'u28-claims-retry-scope': () => (
    <RetryScopeModal open rows={RETRY_ROWS} busy={false} onClose={noop} onRetry={noop} />
  ),
  'u31-claims-sku-sweep': () => (
    <SkuSweepModal open platform="ajio" onMinimise={noop} onClose={noop} onSaved={noop} />
  ),
  'u32-claims-tat-check': () => <TatCheckModal open total={18} onClose={noop} />,
  'u34-claims-ticket-thread': () => (
    <TicketThreadModal
      target={{ platform: 'flipkart', username: 'seller.one@example.com', ticket: 'FK-TKT-20931877' }}
      onClose={noop}
    />
  ),
  'u35-claims-video-size': () => (
    <VideoSizeModal platform="myntra" limitBytes={50 * 1024 * 1024} onChoose={noop} onClose={noop} />
  ),
  'u36-create-bulkclaim': () => <CreateBulkClaimModal open onClose={noop} />,
  'u37-create-rearrange': () => (
    <RearrangeModal
      open
      onClose={noop}
      onSave={noop}
      images={SAMPLE_IMAGES}
      schema={REARRANGE_SCHEMA}
      title="Rearrange Product Screenshots"
    />
  ),
  'u38-create-edit-bulk-row': () => <EditBulkRowSample />,
  'u39-create-normal-bulk': () => <NormalBulkClaimModal open onClose={noop} feedId="feed_1" />,
  'u40-create-camera-permission': () => (
    <CameraPermissionModal open status="prompt" hasDevice onRequest={noop} onSkip={noop} />
  ),
  'u41-create-upload': () => <UploadSample />,
  'u42-create-return-order-picker': () => (
    <ReturnOrderPickerModal
      open
      returnOrderNo="RO-7714209931"
      lines={RETURN_LINES}
      onConfirm={noop}
      onCancel={noop}
    />
  ),
  'u43-create-sku-picker': () => (
    <AjioSkuPickerModal open records={SKU_RECORDS} currentSku="AJ-KT-0207-L" onConfirm={noop} onCancel={noop} />
  ),
  'u44-email-last-sync': () => <LastSyncDialog mailbox={MAILBOX} onClose={noop} onSaved={noop} />,
  'u45-sessions-add-credential': () => (
    <AddCredentialModal open platforms={SESSION_PLATFORMS} onClose={noop} onAdded={noop} />
  ),
  'u46-sessions-otp-peek': () => (
    <OtpPeekModal onClose={noop} platform="meesho" username="seller.one@example.com" />
  ),
  'u47-settings-backup-calendar': () => (
    <BackupCalendarModal open report="forward" onClose={noop} onChanged={noop} />
  ),
  'u48-settings-backup-viewer': () => <BackupViewerModal open report="forward" onClose={noop} />,
  'u49-settings-cron-history': () => (
    <CronHistoryModal open taskId="eligible-claims" taskLabel="Eligible claims" onClose={noop} />
  ),
  'u50-settings-cron': () => (
    <CronModal
      open
      taskLabel="Eligible claims"
      cron={{ kind: 'times', times: ['09:30', '13:00', '18:45'] }}
      onCancel={noop}
      onSave={noop}
    />
  ),
  'u51-settings-flipkart-backup-calendar': () => (
    <FlipkartBackupCalendarModal open report="forward" onClose={noop} onChanged={noop} />
  ),
  'u52-settings-flipkart-request-calendar': () => (
    <FlipkartRequestCalendarModal
      open
      report="return"
      username="seller.one@example.com"
      onClose={noop}
      onChanged={noop}
    />
  ),
  'u53-settings-flipkart-viewer': () => <FlipkartViewerModal open report="forward" onClose={noop} />,
  'u54-settings-snapdeal-backup-calendar': () => (
    <SnapdealBackupCalendarModal open onClose={noop} onChanged={noop} />
  ),
  'u55-settings-snapdeal-request-calendar': () => (
    <SnapdealRequestCalendarModal open onClose={noop} onChanged={noop} />
  ),
  'u56-settings-snapdeal-viewer': () => <SnapdealViewerModal open onClose={noop} />
} satisfies Record<string, () => ReactNode>

export type DialogName = keyof typeof DIALOGS

export const DIALOG_NAMES = Object.keys(DIALOGS) as DialogName[]

const isDialogName = (value: string): value is DialogName => value in DIALOGS

const nameFromHash = (): string => decodeURIComponent(window.location.hash.replace(/^#dialog-gallery=?/, ''))

const storedAppearance = initialAppearance()

export const DialogGallery = () => {
  const [name, setName] = useState(nameFromHash)

  useEffect(() => {
    const onHash = (): void => setName(nameFromHash())

    window.addEventListener('hashchange', onHash)

    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const Dialog = isDialogName(name) ? DIALOGS[name] : null

  return (
    <SettingsProvider
      storedSettings={{
        mode: storedAppearance.theme.mode,
        skin: storedAppearance.theme.skin,
        primaryColor: storedAppearance.theme.primaryColor,
        contentWidth: storedAppearance.theme.contentWidth,
        font: storedAppearance.theme.font
      }}
    >
      <VerticalNavProvider>
        <VuexyThemeProvider systemMode="light">
          <NotificationProvider>
            <ToastProvider>
              <AuthProvider>
                <DevModeProvider>
                  <ClaimCatalogueProvider>
                    {Dialog ? (
                      <Dialog />
                    ) : (
                      <ul className="p-6">
                        {DIALOG_NAMES.map(entry => (
                          <li key={entry}>
                            <a href={`#dialog-gallery=${entry}`}>{entry}</a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </ClaimCatalogueProvider>
                </DevModeProvider>
              </AuthProvider>
            </ToastProvider>
          </NotificationProvider>
        </VuexyThemeProvider>
      </VerticalNavProvider>
    </SettingsProvider>
  )
}

export default DialogGallery
