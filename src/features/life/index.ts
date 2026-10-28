export { default as ManageLifeScreen } from './screens/ManageLifeScreen';
export { default as ProjectDetailScreen } from './screens/ProjectDetailScreen';
export { default as ProjectFormScreen } from './screens/ProjectFormScreen';
export { default as TaskFormScreen } from './screens/TaskFormScreen';
export { useLifeWidgetSync } from './hooks/useLifeWidgetSync';
export { LIFE_TABS } from './components/tabs/shared';
export type { LifeTab } from './components/tabs/shared';
// Form and display widgets other features reuse (candidates for shared/).
export { FormField, SectionTitle } from './components/form';
export { ColorPicker, DateField, IconPicker } from './components/pickers';
export { Avatar, Badge, StatCard } from './components/visuals';
export { formatDay, formatLongDay } from './utils/format';
