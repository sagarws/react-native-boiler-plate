// MUI Imports
import Typography from '@mui/material/Typography'

// Component Imports
import { ThemeCustomizerCard } from './ThemeCustomizerCard'
import { CommonSettingsCard } from './CommonSettingsCard'
import { AutomationScheduleCard } from './AutomationScheduleCard'
import { AjioReportSyncStatus } from './AjioReportSyncStatus'
import { AutoClaimTargets } from './AutoClaimTargets'
import { RefillTargets } from './RefillTargets'
import { RefillPassProgress } from './RefillPassProgress'
import { StatusTargets } from './StatusTargets'
import { SessionUpdateTargets } from './SessionUpdateTargets'
import { CompanyDataCard } from './CompanyDataCard'
import { useDevMode } from '@renderer/context/DevModeContext'
// HIDDEN, NOT DELETED. The master import schedule is a COMPANY setting and the
// import itself still runs — the card is only off this screen. Left commented
// so putting it back is one line rather than an archaeology exercise.
// import { ImportScheduleSettings } from './ImportScheduleSettings'
import { MasterBackupCard } from './MasterBackupCard'
import { SnapdealBackupCard } from './SnapdealBackupCard'
import { FlipkartBackupCard } from './FlipkartBackupCard'
import { SnapdealReportSyncStatus } from './SnapdealReportSyncStatus'
import { FlipkartReportSyncStatus } from './FlipkartReportSyncStatus'
import { MyntraSignInCard } from './MyntraSignInCard'
import { AppUpdateCard } from './AppUpdateCard'

/**
 * Everything this installation can be told to do differently.
 *
 * MIGRATED to the ported design system. The cards themselves were already
 * carried over when components/ui/Card was rebuilt on MUI, so what changed here
 * is the page frame: no title of its own — the shell's navbar says where you
 * are — and no scrolling box, because the document scrolls now.
 */
export const SettingsPage = () => {
  const { devMode } = useDevMode()

  return (
    <div className='flex flex-col gap-6'>
      <Typography color='text.secondary'>Preferences for this installation.</Typography>

      {/* First: whether Automations come up on at launch decides whether
          anything on the rest of this page runs at all. */}
      <CommonSettingsCard />

      {/* <ImportScheduleSettings /> — hidden; see the import above. */}

      {/* Three rows have more to say than a task description can hold, and all
          three are handed in here rather than built into the card — which
          renders the tasks as data and knows nothing about any of them.

          Session update lists the accounts it is going to work on, AJIO report
          sync splits its one line into the two reports it actually runs, and
          Auto claim lists the marketplaces it is about to file for, and Refill
          Data and Status change do the same for the rows they are asking about. They follow
          the same convention: red is work outstanding, green is
          done, and it changes as the run goes. */}
      <AutomationScheduleCard
        detailFor={task =>
          task.id === 'session-refresh' ? (
            <SessionUpdateTargets running={task.running} />
          ) : task.id === 'ajio-master-data' ? (
            <AjioReportSyncStatus running={task.running} />
          ) : task.id === 'snapdeal-master-data' ? (
            <SnapdealReportSyncStatus running={task.running} />
          ) : task.id === 'flipkart-master-data' ? (
            <FlipkartReportSyncStatus running={task.running} />
          ) : task.id === 'refill-data' ? (
            <>
              {/* Before a run: what is waiting, per marketplace. During one:
                  every platform it will reach, and where it is. */}
              <RefillTargets running={task.running} />
              <RefillPassProgress running={task.running} phase='blanks' />
            </>
          ) : task.id === 'status-change' ? (
            // Its own task now, with its own time and Run now — the half
            // nobody wants to wait for the blanks sweep to reach.
            <>
              {/* Between runs: every marketplace and what is due. During one:
                  the live chips. Each hides while the other shows. */}
              <StatusTargets running={task.running} />
              <RefillPassProgress running={task.running} phase='status' />
            </>
          ) : task.id === 'auto-claim' ? (
            <AutoClaimTargets running={task.running} />
          ) : task.id === 'eligible-claims' ? (
            // The same board: it lists exactly the rows this task files.
            <AutoClaimTargets running={task.running} taskId='eligible-claims' />
          ) : null
        }
      />

      {/* Developer mode, like the bulk tools it draws on: it reads AJIO
          directly, page after page, and writes a copy to this machine. */}
      {/* DEVELOPER MODE ONLY. It describes one marketplace's sign-in quirk and
          offers a switch between two ways of working around it — a choice that
          needs somebody who knows what a scripted click is, and that an
          operator changing it by accident turns into Myntra sign-ins that
          silently stop. Beside the mailbox card, because both are about how
          this machine gets itself signed in without anybody typing. */}
      {devMode && <MyntraSignInCard />}
      {/* Above the theme: "what am I running, and is there a newer one" is a
          question people come to Settings WITH, where the palette is one they
          find. */}
      <AppUpdateCard />
      {devMode && <MasterBackupCard />}
      {devMode && <SnapdealBackupCard />}
      {devMode && <FlipkartBackupCard />}

      {/*
        THE THEME PANEL IS MONITOR'S NOW.
        What stood here was a two-card theme picker over a thirteen-seed colour
        editor — a customiser for a palette this app no longer renders from. The
        decisions the ported theme actually takes are the primary colour, the
        mode, the skin, the typeface and the content width, which is what the
        customizer offers.

        DEVELOPER MODE ONLY. The saved theme still applies to everyone; only
        the controls for changing it are hidden.
      */}
      {devMode && <ThemeCustomizerCard />}

      {/* Developer mode only. It shows the stored document verbatim — useful
          when something is not behaving and unnecessary noise the rest of the
          time. Unlocked with five clicks on the logo. */}
      {devMode && <CompanyDataCard />}
    </div>
  )
}
