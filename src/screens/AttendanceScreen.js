import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, ScrollView, RefreshControl, Alert, Animated } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed } from '../theme/colors';
import { getServerDate, getTeamPlayers, getAttendance, saveAttendance, getAttendanceSummary } from '../api';
import { Avatar, EmptyState, sportIcon, classLabel, press, shadow } from '../components/teams';

// SDP attendance: date pill, history strip, Present/Absent toggles, Mark all present, pinned Save bar
const toStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromStr = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = fromStr(s); d.setDate(d.getDate() + n); return toStr(d); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pretty = (s) => { const d = fromStr(s); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`; };

export default function AttendanceScreen({ navigation, route }) {
  const { team } = route.params;
  const insets = useSafeAreaInsets();
  const [today, setToday] = useState(null);
  const [date, setDate] = useState(null);
  const [players, setPlayers] = useState([]);
  const [marks, setMarks] = useState({});
  const [savedIds, setSavedIds] = useState(new Set());
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useRef(new Animated.Value(0)).current;
  const stripRef = useRef(null);

  const strip = useMemo(() => (today ? Array.from({ length: 21 }, (_, i) => addDays(today, i - 20)) : []), [today]);

  const loadSummary = useCallback(async (t) => {
    const list = await getAttendanceSummary(team.id, addDays(t, -20), t).catch(() => []);
    const m = {}; list.forEach((d) => { m[d.date] = d; }); setDays(m);
  }, [team.id]);

  const loadDay = useCallback(async (d, pl) => {
    const rows = await getAttendance(team.id, d).catch(() => []);
    const m = {}; (pl || []).forEach((p) => { m[p.id] = null; });
    const saved = new Set();
    rows.forEach((r) => { if (r.status === 'present' || r.status === 'absent') { m[r.student_id] = r.status; saved.add(r.student_id); } });
    setMarks(m); setSavedIds(saved);
  }, [team.id]);

  const loadAll = useCallback(async () => {
    try {
      const t = today || (await getServerDate());
      const d = date || t;
      setToday(t); setDate(d);
      const pl = await getTeamPlayers('sports-teams', team.id);
      setPlayers(pl);
      await Promise.all([loadDay(d, pl), loadSummary(t)]);
    } catch (e) { Alert.alert('Could not load', e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [today, date, team.id]);
  useEffect(() => { loadAll(); }, []);

  const pick = (d) => { setDate(d); loadDay(d, players); };
  const set = (id, v) => setMarks((m) => ({ ...m, [id]: m[id] === v ? null : v }));
  const allPresent = () => setMarks(Object.fromEntries(players.map((p) => [p.id, 'present'])));
  const present = players.filter((p) => marks[p.id] === 'present').length;
  const absent = players.filter((p) => marks[p.id] === 'absent').length;
  const unmarked = players.length - present - absent;

  const doSave = async () => {
    setSaving(true);
    try {
      const list = players.filter((p) => marks[p.id]).map((p) => ({ student_id: p.id, status: marks[p.id] }));
      await saveAttendance(team.id, date, list);
      setSavedIds(new Set(list.map((x) => x.student_id)));
      loadSummary(today);
      Animated.sequence([Animated.timing(toast, { toValue: 1, duration: 220, useNativeDriver: true }), Animated.delay(1600), Animated.timing(toast, { toValue: 0, duration: 260, useNativeDriver: true })]).start();
    } catch (e) { Alert.alert('Could not save', e.message); }
    finally { setSaving(false); }
  };
  const save = () => {
    if (!present && !absent) return Alert.alert('Nothing marked', 'Mark at least one player as Present or Absent.');
    if (unmarked > 0) return Alert.alert('Some players not marked', `${unmarked} player(s) are not marked. Save anyway?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: doSave }]);
    doSave();
  };

  const dayColor = (d) => {
    const info = days[d];
    if (info) return info.absent > 0 && info.present === 0 ? 'missed' : 'done';
    return d < today ? 'missed' : 'none';
  };

  return (
    <View style={s.screen}>
      <LinearGradient colors={['#166B2F', '#1E8E3E']} style={[s.hero, { paddingTop: insets.top + 8 }]}>
        <MaterialCommunityIcons name={sportIcon(team.sport)} size={140} color="rgba(255,255,255,0.08)" style={{ position: 'absolute', right: -16, bottom: -30 }} />
        <View style={s.heroTop}>
          <Pressable onPress={() => navigation.goBack()} style={(p) => [s.round, press(p)]}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Pressable onPress={() => navigation.navigate('TeamDetail', { kind: 'sports-teams', team })} style={(p) => [s.roundPill, press(p)]}><Ionicons name="people" size={14} color="#fff" /><Text style={s.roundPillText}>Players</Text></Pressable>
        </View>
        <Text style={s.title} numberOfLines={1}>{team.name.trim()}</Text>
        {!!date && (
          <View style={s.datePill}>
            <Pressable hitSlop={8} onPress={() => pick(addDays(date, -1))}><Ionicons name="chevron-back" size={16} color="#fff" /></Pressable>
            <Ionicons name="calendar" size={14} color="#fff" />
            <Text style={s.dateText}>{date === today ? `Today · ${pretty(date)}` : pretty(date)}</Text>
            <Pressable hitSlop={8} disabled={date >= today} onPress={() => pick(addDays(date, 1))} style={{ opacity: date >= today ? 0.3 : 1 }}><Ionicons name="chevron-forward" size={16} color="#fff" /></Pressable>
          </View>
        )}
      </LinearGradient>

      <FlatList
        data={loading ? [] : players}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 150 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(); }} tintColor={colors.primary} colors={[colors.primary]} />}
        ListHeaderComponent={
          <View>
            <Text style={s.section}>Last 3 weeks</Text>
            <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} onContentSizeChange={() => stripRef.current?.scrollToEnd({ animated: false })}>
              {strip.map((d) => {
                const c = dayColor(d); const on = d === date; const dt = fromStr(d);
                return (
                  <Pressable key={d} onPress={() => pick(d)} style={(p) => [s.day, c === 'done' && s.dayDone, c === 'missed' && s.dayMissed, on && s.dayOn, press(p)]}>
                    <Text style={[s.dayDow, on && { color: '#fff' }]}>{DOW[dt.getDay()][0]}</Text>
                    <Text style={[s.dayNum, on && { color: '#fff' }]}>{dt.getDate()}</Text>
                    <View style={[s.dayDot, { backgroundColor: c === 'done' ? colors.primary : c === 'missed' ? '#EF4444' : 'transparent' }, on && { backgroundColor: '#fff' }]} />
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={s.legend}>
              <View style={[s.lg, { backgroundColor: colors.primary }]} /><Text style={s.lgText}>Done</Text>
              <View style={[s.lg, { backgroundColor: '#EF4444' }]} /><Text style={s.lgText}>Missed</Text>
            </View>
            {players.length > 0 && (
              <View style={s.listHead}>
                <Text style={s.section}>{players.length} players</Text>
                <Pressable onPress={allPresent} style={(p) => [s.allBtn, press(p)]}><Ionicons name="checkmark-done" size={16} color={colors.primary} /><Text style={s.allText}>Mark all present</Text></Pressable>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={loading ? <EmptyState icon="timer-sand" text="Loading players..." /> : <EmptyState title="No players in this team" text="Add students first, then take attendance." action="Add players" onAction={() => navigation.navigate('AddPlayers', { kind: 'sports-teams', team, existingIds: [] })} />}
        renderItem={({ item: p }) => {
          const m = marks[p.id];
          return (
            <View style={[s.row, m === 'present' && { borderColor: colors.primary }, m === 'absent' && { borderColor: '#EF4444' }]}>
              <Avatar name={p.name} />
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{p.name}</Text>
                <Text style={s.meta} numberOfLines={1}>{classLabel(p)}{savedIds.has(p.id) ? '  ·  saved' : ''}</Text>
              </View>
              <Pressable onPress={() => set(p.id, 'present')} style={(x) => [s.tog, m === 'present' && s.togP, press(x)]}><Text style={[s.togText, m === 'present' && { color: '#fff' }]}>P</Text></Pressable>
              <Pressable onPress={() => set(p.id, 'absent')} style={(x) => [s.tog, m === 'absent' && s.togA, press(x)]}><Text style={[s.togText, m === 'absent' && { color: '#fff' }]}>A</Text></Pressable>
            </View>
          );
        }}
      />

      {players.length > 0 && (
        <View style={[s.bar, { paddingBottom: 14 }]}>
          <View style={s.counts}>
            <View style={s.count}><Text style={[s.countNum, { color: colors.primary }]}>{present}</Text><Text style={s.countLbl}>Present</Text></View>
            <View style={s.count}><Text style={[s.countNum, { color: '#EF4444' }]}>{absent}</Text><Text style={s.countLbl}>Absent</Text></View>
            <View style={s.count}><Text style={[s.countNum, { color: colors.meta }]}>{unmarked}</Text><Text style={s.countLbl}>Not marked</Text></View>
          </View>
          <Pressable disabled={saving} onPress={save} style={(p) => [s.cta, saving && { opacity: 0.5 }, press(p)]}>
            <Ionicons name="cloud-upload" size={18} color="#fff" /><Text style={s.ctaText}>{saving ? 'Saving...' : 'Save'}</Text>
          </Pressable>
        </View>
      )}

      <Animated.View pointerEvents="none" style={[s.toast, { top: insets.top + 12, opacity: toast, transform: [{ translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
        <Ionicons name="checkmark-circle" size={20} color="#fff" /><Text style={s.toastText}>Attendance saved</Text>
      </Animated.View>
    </View>
  );
}

const s = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.navy },
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: 'hidden', marginBottom: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  roundPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  roundPillText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900' },
  datePill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginTop: 10 },
  dateText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  section: { color: colors.meta, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginLeft: 2 },
  day: { width: 46, paddingVertical: 8, borderRadius: 14, alignItems: 'center', backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  dayDone: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  dayMissed: { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.15)' },
  dayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayDow: { color: colors.meta, fontSize: 10, fontWeight: '800' },
  dayNum: { color: colors.heading, fontSize: 16, fontWeight: '900', marginTop: 2 },
  dayDot: { width: 5, height: 5, borderRadius: 3, marginTop: 4 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 14 },
  lg: { width: 8, height: 8, borderRadius: 4 },
  lgText: { color: colors.meta, fontSize: 11, fontWeight: '700', marginRight: 10 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  allBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10 },
  allText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.navyLight, borderRadius: 18, padding: 12, marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent', ...shadow },
  name: { color: colors.heading, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.meta, fontSize: 12, marginTop: 2 },
  tog: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy, borderWidth: 1, borderColor: colors.cardBorder },
  togP: { backgroundColor: colors.primary, borderColor: colors.primary },
  togA: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  togText: { color: colors.heading, fontWeight: '900', fontSize: 16 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.navyLight, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  counts: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  count: { alignItems: 'center' },
  countNum: { fontSize: 18, fontWeight: '900' },
  countLbl: { color: colors.meta, fontSize: 10, fontWeight: '700' },
  cta: { height: 50, paddingHorizontal: 24, borderRadius: 999, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  toast: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, ...shadow },
  toastText: { color: '#fff', fontWeight: '800' },
}));