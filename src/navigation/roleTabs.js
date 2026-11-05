// Which bottom tabs each role sees. Add more roles / tabs here later.
export const ALL_TABS = {
  Home: { label: 'Home', icon: 'home' },
  Gallery: { label: 'Gallery', icon: 'images' },
  Achievements: { label: 'Achievements', icon: 'trophy' },
  Curriculum: { label: 'Curriculum', icon: 'book' },
  Helpdesk: { label: 'Helpdesk', icon: 'help-buoy' },
  More: { label: 'More', icon: 'grid' },
};
const COACH_TABS = ['Home', 'Gallery', 'Achievements', 'Curriculum', 'Helpdesk'];
const HEAD_COACH_TABS = ['Home', 'Gallery', 'Achievements', 'Curriculum', 'More'];
export const ROLE_TABS = {
  4: HEAD_COACH_TABS, // Head Coach (Helpdesk lives under More)
  5: COACH_TABS, // Coach
};
export const DEFAULT_TABS = COACH_TABS;
export const tabsForRole = (roleId) => ROLE_TABS[Number(roleId)] || DEFAULT_TABS;