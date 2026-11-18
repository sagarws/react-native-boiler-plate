import App from './App'
import './styles/app.css'

/**
 * The app as it is today, with the stylesheet it renders from.
 *
 * The app now renders through the ported design system: one stylesheet entry
 * (styles/app.css) carrying BOTH token systems, with the outgoing one scoped to
 * the screens that have not been migrated yet. index.css is gone; what was
 * behaviour rather than colour in it lives in styles/behaviour.css.
 */
export const AppRoot = () => <App />
