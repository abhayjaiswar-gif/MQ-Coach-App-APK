import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, Animated, PanResponder, Alert, ScrollView, useWindowDimensions } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed, currentMode } from '../theme/colors';

// Head coach "More" bottom sheet. To add a page: append one entry to TILES (2 per row).
// Head coach "More" bottom sheet. Tiles = pages role 4 has on the web (effective permissions).
// [key, label, icon set, icon, light bg, light border, fg, dark bg, route]
const TILES = [
  { key: 'team', label: 'Team', lib: 'mci', icon: 'account-group', c: ['#F3EEFF', '#DDD0FB', '#7C3AED', '#2A2140'], go: ['Teams', { kind: 'teams' }] },
  { key: 'sdp', label: 'SDP', lib: 'mci', icon: 'medal', c: ['#E9F7EE', '#C8EBD4', '#1E8E3E', '#1B2E22'], go: ['Teams', { kind: 'sports-teams' }] },
  { key: 'student', label: 'Students', lib: 'ion', icon: 'school', c: ['#EAF2FF', '#CFE0FC', '#2563EB', '#1C2638'], go: ['StudentList'] },
  { key: 'attendance', label: 'Attendance', lib: 'mci', icon: 'clipboard-check-outline', c: ['#FFF4E5', '#FBDDB4', '#EA7A0C', '#33261A'], go: ['LectureAttendance'] },
  { key: 'marks', label: 'Fill Marks', lib: 'mci', icon: 'clipboard-text-outline', c: ['#FDECF4', '#F8CFE2', '#DB2777', '#36202B'], go: ['FillMarks'] },
  { key: 'weekly', label: 'Weekly Report', lib: 'mci', icon: 'file-chart-outline', c: ['#EEF0FF', '#D5D9FB', '#4F46E5', '#22233F'], go: ['WeeklyReport'] },
  { key: 'reportcard', label: 'Report Cards', lib: 'mci', icon: 'card-account-details-outline', c: ['#E6F7F5', '#BFE9E3', '#0D9488', '#17302D'], go: ['ReportCard'] },
];

export default function MoreSheet({ visible, onClose, onNavigate, onLogout }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const dark = currentMode === 'dark';
  const y = useRef(new Animated.Value(height)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(visible);

  useEffect(() => {
    if (visible) {
      setShown(true); y.setValue(height);
      Animated.parallel([
        Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }),
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else if (shown) {
      Animated.parallel([
        Animated.timing(y, { toValue: height, duration: 220, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setShown(false));
    }
  }, [visible]);

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { if (g.dy > 0) y.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 110 || g.vy > 1) onClose();
      else Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }).start();
    },
  })).current;

  const go = (t) => { onClose(); setTimeout(() => onNavigate(...t.go), 180); };
  const logout = () => Alert.alert('Log out?', 'You will need to sign in again to use the app.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Log out', style: 'destructive', onPress: () => { onClose(); onLogout(); } },
  ]);
  const Icon = ({ t, color }) => (t.lib === 'mci' ? <MaterialCommunityIcons name={t.icon} size={26} color={color} /> : <Ionicons name={t.icon} size={26} color={color} />);

  return (
    <Modal visible={shown} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[s.backdrop, { opacity: fade }]}><Pressable style={{ flex: 1 }} onPress={onClose} /></Animated.View>
      <Animated.View style={[s.sheet, { maxHeight: height * 0.7, paddingBottom: 16 + insets.bottom, transform: [{ translateY: y }] }]}>
        <View {...pan.panHandlers} style={{ paddingTop: 10 }}>
          <View style={s.handle} />
          <View style={s.head}>
            <View style={s.headIcon}><Ionicons name="menu" size={22} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>More</Text>
              <Text style={s.sub}>Jump to a section</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={({ pressed }) => [s.close, pressed && { opacity: 0.7 }]}><Ionicons name="close" size={20} color={colors.subtext} /></Pressable>
          </View>
        </View>
        <View style={s.divider} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16 }}>
          <View style={s.grid}>
            {TILES.map((t) => (
              <Pressable key={t.key} onPress={() => go(t)} style={({ pressed }) => [s.tile, { backgroundColor: dark ? t.c[3] : t.c[0], borderColor: dark ? t.c[2] + '40' : t.c[1] }, pressed && s.pressed]}>
                <View style={[s.tileIcon, { backgroundColor: t.c[2] + '1F' }]}><Icon t={t} color={t.c[2]} /></View>
                <Text style={s.tileText} numberOfLines={2}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => go({ go: ['HelpdeskPage'] })} style={({ pressed }) => [s.wide, { backgroundColor: dark ? '#35202A' : '#FFEEF2', borderColor: dark ? '#E11D4840' : '#FBCFDA' }, pressed && s.pressed]}>
            <Ionicons name="headset" size={24} color="#E11D48" />
            <Text style={s.wideText}>Support</Text>
          </Pressable>
          <View style={[s.divider, { marginHorizontal: 0, marginVertical: 16 }]} />
          <Pressable onPress={logout} style={({ pressed }) => [s.logout, pressed && s.pressed]}>
            <Ionicons name="log-out-outline" size={22} color={colors.error} />
            <Text style={s.logoutText}>Logout</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const s = themed(() => ({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(8,15,12,0.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.navyLight, borderTopLeftRadius: 28, borderTopRightRadius: 28, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -6 }, elevation: 16 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.cardBorder, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 14 },
  headIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.heading, fontSize: 18, fontWeight: '900' },
  sub: { color: colors.meta, fontSize: 13, marginTop: 1 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1, backgroundColor: colors.cardBorder, marginHorizontal: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  tile: { width: '48.3%', height: 112, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 6 },
  tileIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  tileText: { color: colors.heading, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  wide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 60, borderRadius: 16, borderWidth: 1, marginTop: 12 },
  wideText: { color: colors.heading, fontSize: 15, fontWeight: '800' },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 16, backgroundColor: colors.errorBg },
  logoutText: { color: colors.error, fontSize: 15, fontWeight: '800' },
}));