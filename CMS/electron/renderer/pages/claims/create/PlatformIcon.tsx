import { PlatformLogo } from '@renderer/components/ui/PlatformLogo'

/**
 * The ported form's platform badge, drawn with the app's marketplace logos.
 *
 * TrackVid-FE's own `PlatformIcon` takes these props, so keeping the shape lets
 * the ported picker and the bulk modal stay comparable to the page they came
 * from. What it renders is now the shared `PlatformLogo` — one set of artwork
 * for the claim queue, the dashboard, the sessions list and this form, rather
 * than a second badge that happened to look different here.
 *
 * `fallbackColor` is accepted and ignored: the shared component derives a
 * stable colour from the name for the platforms that ship no logo, which is the
 * same job done in one place.
 */
interface Props {
  name: string
  size?: number
  /** @deprecated the shared logo derives its own fallback colour. */
  fallbackColor?: string
}

export const PlatformIcon = ({ name, size = 16 }: Props) => (
  <PlatformLogo name={name} size={size} />
)

export default PlatformIcon
