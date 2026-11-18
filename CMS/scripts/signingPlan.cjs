/*
 * What this packaging run will actually do about signing — said out loud.
 *
 * electron-builder is quiet about this by design: with no certificate it
 * produces a perfectly good UNSIGNED build and carries on. That is the right
 * default for a developer, and the wrong one for a release, because the failure
 * is invisible until an operator downloads the app and Gatekeeper refuses it —
 * or worse, does not, and nobody ever learns the build was unsigned.
 *
 * Same reasoning as the update-feed guard this sits beside: a packaging mistake
 * that cannot be repaired after the fact is worth failing on, loudly, at the
 * only moment anyone can still act.
 *
 * NOTHING HERE READS A SECRET'S VALUE. It reports which variables are SET.
 */

/** macOS notarisation credentials. Any one complete set is enough. */
const APPLE_CREDENTIAL_SETS = [
  {
    name: 'App Store Connect API key (recommended)',
    keys: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
  },
  {
    name: 'Apple ID + app-specific password',
    keys: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
  },
  { name: 'Keychain profile', keys: ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'] }
]

const isSet = (key) => typeof process.env[key] === 'string' && process.env[key].trim() !== ''

/**
 * The certificate electron-builder will find.
 *
 * CSC_LINK is a file path or base64 of the .p12; CSC_NAME picks an identity
 * already in the keychain. CSC_IDENTITY_AUTO_DISCOVERY=false is the documented
 * way to say "do not sign", so it is treated as a deliberate answer rather than
 * a missing one.
 */
const certificateFor = (platform) => {
  const prefix = platform === 'mac' ? 'CSC' : 'WIN_CSC'
  const link = isSet(`${prefix}_LINK`) || isSet('CSC_LINK')
  const name = platform === 'mac' && isSet('CSC_NAME')

  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') return 'disabled'

  return link || name ? 'present' : 'missing'
}

const notarisationFor = () => {
  const complete = APPLE_CREDENTIAL_SETS.find((set) => set.keys.every(isSet))

  return complete ? complete.name : null
}

/**
 * Describes the run, and decides whether it may continue.
 *
 * `strict` is what a release build passes: it turns "this will be unsigned"
 * from a warning into a refusal.
 */
const report = ({ platforms, strict }) => {
  const problems = []

  console.log('\n  Signing plan')

  for (const platform of platforms) {
    const certificate = certificateFor(platform)
    const label = platform === 'mac' ? 'macOS' : 'Windows'

    if (certificate === 'present') {
      console.log(`    ${label}: signed`)
    } else if (certificate === 'disabled') {
      console.log(`    ${label}: NOT signed — CSC_IDENTITY_AUTO_DISCOVERY=false`)
      problems.push(`${label} signing is switched off`)
    } else {
      const variable = platform === 'mac' ? 'CSC_LINK (or CSC_NAME)' : 'WIN_CSC_LINK (or CSC_LINK)'

      console.log(`    ${label}: NOT signed — no certificate. Set ${variable} and CSC_KEY_PASSWORD.`)
      problems.push(`${label} build will be unsigned`)
    }

    if (platform !== 'mac') continue

    const notarisation = notarisationFor()

    if (certificate !== 'present') {
      // Notarisation submits a SIGNED app; without a certificate the question
      // does not arise, and saying "also not notarised" is noise.
      continue
    }

    if (notarisation) {
      console.log(`    macOS notarisation: on — ${notarisation}`)
    } else {
      console.log('    macOS notarisation: OFF — no Apple credentials. One of:')

      for (const set of APPLE_CREDENTIAL_SETS) {
        console.log(`      ${set.keys.join(' + ')}   (${set.name})`)
      }

      problems.push('macOS build will be signed but not notarised')
    }
  }

  console.log('')

  if (problems.length === 0) return true

  if (!strict) {
    console.log(`  Continuing anyway (${problems.join('; ')}).`)
    console.log('  Pass --require-signing to make this a failure, as a release build should.\n')

    return true
  }

  console.error('  Refusing to package: --require-signing was passed and')

  for (const problem of problems) console.error(`    - ${problem}`)

  console.error(
    '\n  An unsigned build is refused by Gatekeeper and SmartScreen, and an\n' +
      '  unnotarised macOS build is refused even when it is signed.\n'
  )

  return false
}

module.exports = { report }
