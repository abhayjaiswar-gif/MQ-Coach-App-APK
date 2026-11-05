import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, Image, Alert } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed, currentMode } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getDashboardStats, getSchools, getMyLpSummary, fileUrl } from '../api';
import { Loading, ErrorBox } from '../components/ui';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'; };
const isDone = (s) => /complete|done|conduct|submit|approved/i.test(String(s || ''));
const statusOf = (t, i, nextIdx) => (isDone(t.lp_status) ? 'Completed' : i === nextIdx ? 'In Progress' : 'Pending');

// Progress ring built from two half-circles (no SVG dependency)
function Ring({ pct, size = 92, stroke = 9 }) {
  const deg = Math.round((pct / 100) * 360);
  const half = (rot, show) => (
    <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${rot}deg` }] }]}>
      <View style={{ width: size / 2, height: size, overflow: 'hidden' }}>
        <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: show ? colors.primary : 'transparent', borderRightColor: 'transparent', borderBottomColor: 'transparent', transform: [{ rotate: '-45deg' }] }} />
      </View>
    </View>
  );
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: colors.cardBorder }} />
      {half(Math.min(deg, 180) - 180 + 180, deg > 0)}
      {deg > 180 && half(deg, true)}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: colors.heading, fontSize: 20, fontWeight: '800' }}>{pct}%</Text>
      </View>
    </View>
  );
}

export default function DashboardScreen({ navigation }) {
  const { user, onLogout } = useAuth();
  const insets = useSafeAreaInsets();
  const { mode, toggleTheme } = useTheme();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [stats, setStats] = useState(null);
  const [schools, setSchools] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const firstName = String(user.name || 'Coach').trim().split(/\s+/)[0];
  const initials = String(user.name || 'C').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const pic = user.profile_pic || user.profile_image || user.photo;
  const avatarUri = pic && !avatarFailed ? fileUrl(pic) : null;
  const confirmLogout = () => Alert.alert('Log out?', 'You will need to sign in again to use the app.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: onLogout }]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, sc, lp] = await Promise.all([
        getDashboardStats(user.id),
        getSchools(user).catch(() => []),
        getMyLpSummary(user.id).catch(() => null),
      ]);
      setStats(s); setSchools(sc);
      // Flatten lesson plans; prefer the current month's plans as "today's tasks"
      const grouped = lp?.grouped || {};
      const monthKey = new Date().toLocaleString('en', { month: 'short' }) + ', ' + new Date().getFullYear();
      const months = grouped[monthKey] ? [monthKey] : Object.keys(grouped).slice(0, 1);
      const list = [];
      months.forEach((m) => Object.values(grouped[m] || {}).forEach((wk) => (wk.items || []).forEach((it) => list.push({ ...it, school_name: it.school_name || wk.school_name, week_no: it.week_no || wk.week_no }))));
      setTasks(list);
    } catch (e) { setError(e.message); } finally { setLoading(false); setRefreshing(false); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const done = tasks.filter((t) => isDone(t.lp_status)).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const nextIdx = tasks.findIndex((t) => !isDone(t.lp_status));
  const next = nextIdx >= 0 ? tasks[nextIdx] : null;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const sessions = stats?.lectures ?? 0;
  const s = styles;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 30 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onLongPress={confirmLogout} delayLongPress={500} style={s.avatarWrap}>
          {avatarUri ? <Image source={{ uri: avatarUri }} style={s.avatar} onError={() => setAvatarFailed(true)} />
            : <View style={[s.avatar, s.initials]}><Text style={s.initialsText}>{initials}</Text></View>}
          <View style={s.online} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.greet} numberOfLines={2}>{greeting()},{'\n'}{firstName} {'\u{1F44B}'}</Text>
          <Text style={s.date}>{today}</Text>
          <Text style={s.meta}>{schools.length} Schools  •  {tasks.length} Tasks  •  {sessions} Sessions</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={toggleTheme} style={s.pill}>
              <View style={[s.pillOpt, mode === 'light' && s.pillOn]}><Ionicons name="sunny-outline" size={17} color={mode === 'light' ? colors.primary : colors.meta} /></View>
              <View style={[s.pillOpt, mode === 'dark' && s.pillOn]}><Ionicons name="moon-outline" size={17} color={mode === 'dark' ? colors.primary : colors.meta} /></View>
            </Pressable>
            <Pressable style={s.bell}><Ionicons name="notifications-outline" size={21} color={colors.heading} /></Pressable>
            <Pressable onPress={confirmLogout} hitSlop={6} accessibilityLabel="Log out" style={({ pressed }) => [s.bell, s.logout, pressed && { transform: [{ scale: 0.94 }], opacity: 0.85 }]}><Ionicons name="log-out-outline" size={21} color={colors.error} /></Pressable>
          </View>
        </View>
      </View>

      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={() => { setLoading(true); load(); }} /> : (
        <>
          {/* Today's progress */}
          <View style={s.card}>
            <View style={s.labelRow}><Ionicons name="flash" size={14} color={colors.primary} /><Text style={s.label}>TODAY'S PROGRESS</Text></View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
              <Ring pct={pct} />
              <View style={{ flex: 1, marginLeft: 18 }}>
                <Text style={s.progTitle}><Text style={{ fontWeight: '800' }}>{done} of {tasks.length}</Text> tasks completed</Text>
                <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
                <Text style={s.progSub}>{tasks.length - done} tasks remaining</Text>
              </View>
            </View>
          </View>

          {/* Next task hero */}
          <View style={s.hero}>
            <MaterialCommunityIcons name="soccer-field" size={240} color="rgba(255,255,255,0.06)" style={s.heroArt} />
            <MaterialCommunityIcons name="trophy" size={110} color="rgba(255,214,90,0.18)" style={s.heroTrophy} />
            <View style={s.heroTop}>
              <View style={s.labelRow}><Ionicons name="flash" size={14} color="#fff" /><Text style={[s.label, { color: '#fff' }]}>NEXT TASK</Text></View>
              {next && <View style={{ flexDirection: 'row', gap: 6 }}>
                {!!next.sport && <View style={[s.badge, { backgroundColor: '#E8A33D' }]}><Text style={s.badgeText}>{String(next.sport).trim().toUpperCase()}</Text></View>}
                <View style={[s.badge, { backgroundColor: '#3FBF6B' }]}><Text style={s.badgeText}>UP NEXT</Text></View>
              </View>}
            </View>
            {next ? (
              <>
                <View style={s.heroLine}><Ionicons name="calendar-outline" size={20} color="#fff" /><Text style={s.heroTime}>{next.week_no || 'This week'}</Text></View>
                <View style={s.heroLine}><Ionicons name="business-outline" size={16} color="#DDEEE3" /><Text style={s.heroInfo}>{next.school_name || 'School'}</Text></View>
                <View style={s.heroLine}><Ionicons name="trophy-outline" size={16} color="#DDEEE3" /><Text style={s.heroInfo}>{[next.sport, next.grade].filter(Boolean).join('  •  ')}</Text></View>
                <Text style={s.heroTitle} numberOfLines={2}>{next.skill}{next.sub_skill ? ` – ${next.sub_skill}` : ''}</Text>
                <Pressable style={s.startBtn} onPress={() => navigation.navigate('Curriculum')}>
                  <Text style={s.startText}>START SESSION  →</Text>
                </Pressable>
              </>
            ) : <Text style={[s.heroInfo, { marginTop: 14 }]}>{tasks.length ? 'All tasks done. Great work!' : 'No lesson plans assigned yet.'}</Text>}
          </View>

          {/* Today's tasks */}
          <View style={s.secRow}>
            <Text style={s.secTitle}>TODAY'S TASKS</Text>
            <Pressable onPress={() => navigation.navigate('Curriculum')}><Text style={s.viewAll}>View All →</Text></Pressable>
          </View>
          <View style={[s.card, { paddingVertical: 8 }]}>
            {tasks.length === 0 ? <Text style={[s.progSub, { padding: 10 }]}>No tasks yet.</Text> : tasks.slice(0, 6).map((t, i, arr) => {
              const st = statusOf(t, i, nextIdx);
              const dot = st === 'Completed' ? colors.primary : st === 'In Progress' ? '#3B82F6' : colors.iconMuted;
              return (
                <View key={t.id || i} style={s.taskRow}>
                  <View style={{ alignItems: 'center', width: 22 }}>
                    <View style={[s.dot, { backgroundColor: dot }]} />
                    {i < arr.length - 1 && <View style={s.line} />}
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.taskTime}>{t.week_no}</Text>
                    <Text style={s.taskTitle} numberOfLines={1}>{t.skill}{t.sub_skill ? ` – ${t.sub_skill}` : ''}</Text>
                    <Text style={s.taskSchool} numberOfLines={1}>{t.school_name}{t.grade ? `  •  ${t.grade}` : ''}</Text>
                  </View>
                  <View style={[s.status, st === 'Completed' ? s.stDone : st === 'In Progress' ? s.stProg : s.stPend]}>
                    <Text style={[s.statusText, { color: st === 'Completed' ? colors.primary : st === 'In Progress' ? '#3B82F6' : colors.meta }]}>{st}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = themed(() => {
  const dark = currentMode === 'dark';
  return {
    screen: { flex: 1, backgroundColor: colors.navy },
    header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 18, paddingBottom: 16 },
    avatarWrap: { marginTop: 6 },
    avatar: { width: 60, height: 60, borderRadius: 30 },
    initials: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    initialsText: { color: '#fff', fontSize: 22, fontWeight: '800' },
    online: { position: 'absolute', right: 1, bottom: 3, width: 14, height: 14, borderRadius: 7, backgroundColor: '#22C55E', borderWidth: 2, borderColor: colors.navy },
    greet: { color: colors.heading, fontSize: 22, fontWeight: '800', lineHeight: 28 },
    date: { color: colors.subtext, fontSize: 13, marginTop: 4 },
    meta: { color: colors.subtext, fontSize: 12, marginTop: 4 },
    pill: { flexDirection: 'row', backgroundColor: dark ? colors.navyLight : '#E9EFEB', borderRadius: 14, padding: 4, borderWidth: 1, borderColor: colors.cardBorder },
    pillOpt: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    pillOn: { backgroundColor: dark ? colors.primarySoft : '#FFFFFF' },
    logout: { backgroundColor: colors.errorBg, borderColor: colors.errorBg },
  bell: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
    card: { marginHorizontal: 16, marginBottom: 16, padding: 18, borderRadius: 20, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder, shadowColor: '#000', shadowOpacity: dark ? 0 : 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: dark ? 0 : 2 },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    label: { color: colors.primary, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
    progTitle: { color: colors.heading, fontSize: 16 },
    bar: { height: 8, borderRadius: 4, backgroundColor: colors.cardBorder, marginTop: 10, overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 4, backgroundColor: colors.primary },
    progSub: { color: colors.meta, fontSize: 13, marginTop: 10 },
    hero: { marginHorizontal: 16, marginBottom: 20, padding: 18, borderRadius: 22, overflow: 'hidden', backgroundColor: dark ? '#0E2A1A' : '#0F3D24' },
    heroArt: { position: 'absolute', right: -40, top: -20 },
    heroTrophy: { position: 'absolute', right: 10, bottom: 70 },
    heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    heroLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    heroTime: { color: '#fff', fontSize: 22, fontWeight: '800' },
    heroInfo: { color: '#DDEEE3', fontSize: 15 },
    heroTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 14 },
    startBtn: { marginTop: 16, backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
    startText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 1 },
    secRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 18, marginBottom: 10 },
    secTitle: { color: colors.heading, fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
    viewAll: { color: colors.primary, fontWeight: '700' },
    taskRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10 },
    dot: { width: 18, height: 18, borderRadius: 9, marginTop: 2 },
    line: { width: 2, flex: 1, minHeight: 30, backgroundColor: colors.cardBorder, marginTop: 4 },
    taskTime: { color: colors.meta, fontSize: 12 },
    taskTitle: { color: colors.heading, fontSize: 15, fontWeight: '700', marginTop: 2 },
    taskSchool: { color: colors.subtext, fontSize: 13, marginTop: 2 },
    status: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginTop: 10 },
    stDone: { backgroundColor: colors.successSoft },
    stProg: { backgroundColor: dark ? 'rgba(59,130,246,0.18)' : '#E6EEFD' },
    stPend: { backgroundColor: dark ? '#2A322D' : '#EEF1EF' },
    statusText: { fontSize: 12, fontWeight: '700' },
  };
});
