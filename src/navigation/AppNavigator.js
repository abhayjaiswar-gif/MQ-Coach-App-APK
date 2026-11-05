import { useState } from 'react';
import { NavigationContainer, createNavigationContainerRef, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors, currentMode } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { ALL_TABS, tabsForRole } from './roleTabs';
import DashboardScreen from '../screens/DashboardScreen';
import GalleryScreen from '../screens/GalleryScreen';
import GalleryDetailScreen from '../screens/GalleryDetailScreen';
import AchievementsScreen from '../screens/AchievementsScreen';
import CurriculumScreen from '../screens/CurriculumScreen';
import CurriculumDetailScreen from '../screens/CurriculumDetailScreen';
import CurriculumBuilderScreen from '../screens/CurriculumBuilderScreen';
import LessonPlanScreen from '../screens/LessonPlanScreen';
import ExtraCoverScreen from '../screens/ExtraCoverScreen';
import MoreScreen from '../screens/MoreScreen';
import MoreSheet from '../components/MoreSheet';
import ComingSoonScreen from '../screens/ComingSoonScreen';
import TeamsScreen from '../screens/TeamsScreen';
import TeamDetailScreen from '../screens/TeamDetailScreen';
import TeamFormScreen from '../screens/TeamFormScreen';
import AddPlayersScreen from '../screens/AddPlayersScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import StudentListScreen from '../screens/StudentListScreen';
import HelpdeskScreen from '../screens/HelpdeskScreen';
import LectureAttendanceScreen from '../screens/LectureAttendanceScreen';
import FillMarksScreen from '../screens/FillMarksScreen';
import WeeklyReportScreen from '../screens/WeeklyReportScreen';
import ReportCardScreen from '../screens/ReportCardScreen';
import SavedAchievementsScreen from '../screens/SavedAchievementsScreen';

const SCREENS = {
  Home: DashboardScreen,
  Gallery: GalleryScreen,
  Achievements: AchievementsScreen,
  Curriculum: CurriculumScreen,
  Helpdesk: HelpdeskScreen,
  More: MoreScreen,
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navRef = createNavigationContainerRef();

const navTheme = () => {
  const base = currentMode === 'dark' ? DarkTheme : DefaultTheme;
  return { ...base, colors: { ...base.colors, background: colors.navy, card: colors.navy, text: colors.heading, border: colors.cardBorder, primary: colors.primary } };
};

// Detail pages registered inside every tab's stack, so the tab bar stays visible on all of them.
const SHARED = {
  GalleryDetail: GalleryDetailScreen, CurriculumDetail: CurriculumDetailScreen, CurriculumBuilder: CurriculumBuilderScreen,
  LessonPlan: LessonPlanScreen, ExtraCover: ExtraCoverScreen, HelpdeskPage: HelpdeskScreen, ComingSoon: ComingSoonScreen,
  Teams: TeamsScreen, TeamDetail: TeamDetailScreen, TeamForm: TeamFormScreen, AddPlayers: AddPlayersScreen,
  Attendance: AttendanceScreen, StudentList: StudentListScreen, FillMarks: FillMarksScreen, WeeklyReport: WeeklyReportScreen, ReportCard: ReportCardScreen, SavedAchievements: SavedAchievementsScreen,
};
const stackOpts = { headerShown: false, contentStyle: { backgroundColor: colors.navy } };
const STACKS = {};
const stackFor = (tab) => STACKS[tab] || (STACKS[tab] = function TabStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name={`${tab}Root`} component={SCREENS[tab]} />
      {Object.entries(SHARED).map(([n, C]) => <Stack.Screen key={n} name={n} component={C} />)}
      <Stack.Screen name="LectureAttendance" component={LectureAttendanceScreen} options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
    </Stack.Navigator>
  );
});

function Tabs() {
  const { user, onLogout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = tabsForRole(user?.role_id);
  const openFromMore = (r, params) => {
    if (!navRef.isReady()) return;
    if (r === 'LectureAttendance') {
      // Popup opens over the tab you are on, so that page stays visible behind it.
      const st = navRef.getRootState();
      return navRef.navigate(st.routes[st.index].name, { screen: r, params, initial: false });
    }
    if (tabs.includes('More')) navRef.navigate('More', { screen: r, params });
    else navRef.navigate(r, params);
  };
  return (
    <>
    <Tab.Navigator
      backBehavior="history"
      screenOptions={({ route }) => ({
        headerShown: false,
        popToTopOnBlur: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.iconMuted,
        tabBarStyle: { backgroundColor: colors.navyLight, borderTopColor: colors.cardBorder },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? ALL_TABS[route.name].icon : `${ALL_TABS[route.name].icon}-outline`} size={size} color={color} />
        ),
      })}
    >
      {tabs.map((name) => (
        <Tab.Screen key={name} name={name} component={stackFor(name)} options={{ title: ALL_TABS[name].label }}
          listeners={({ navigation }) => (name === 'More'
            ? { tabPress: (e) => { e.preventDefault(); setMoreOpen(true); } }
            : { tabPress: (e) => {
                // Always land on the tab's root page, even when switching from another tab.
                e.preventDefault();
                navigation.navigate(name, { screen: `${name}Root` });
              } })} />
      ))}
    </Tab.Navigator>
    <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} onNavigate={openFromMore} onLogout={onLogout} />
    </>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer ref={navRef} theme={navTheme()}>
      <Tabs />
    </NavigationContainer>
  );
}
