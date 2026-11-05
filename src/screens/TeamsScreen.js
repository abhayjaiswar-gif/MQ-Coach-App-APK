import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, FlatList, RefreshControl, Alert, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getTeams, deleteTeam, getServerDate, getAttendanceStatus } from '../api';
import { Header, ui } from '../components/ui';
import { sportIcon, tintFor, SportBadge, EmptyState, ActionSheet, press, shadow } from '../components/teams';

// Team Management (kind 'teams') and SDP (kind 'sports-teams') list. Head coach sees own teams (server filter).
export default function TeamsScreen({ navigation, route }) {
  const kind = route.params?.kind || 'teams';
  const isSdp = kind === 'sports-teams';
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [teams, setTeams] = useState([]);
  const [status, setStatus] = useState({});
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [sport, setSport] = useState(null);
  const [menu, setMenu] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const t = await getTeams(kind, user);
      setTeams(t);
      if (isSdp) {
        const d = await getServerDate(); setToday(d);
        setStatus(await getAttendanceStatus(t.map((x) => x.id), d).catch(() => ({})));
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [kind, user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sports = useMemo(() => [...new Set(teams.map((t) => (t.sport || 'General').trim()))], [teams]);
  const shown = useMemo(() => teams.filter((t) => (!sport || (t.sport || 'General').trim() === sport) && (!q || t.name.toLowerCase().includes(q.toLowerCase()))), [teams, sport, q]);
  const players = teams.reduce((a, t) => a + Number(t.players_count || 0), 0);
  const doneCount = teams.filter((t) => status[t.id] > 0).length;

  const open = (t) => navigation.navigate(isSdp ? 'Attendance' : 'TeamDetail', { kind, team: t });
  const confirmDelete = (t) => Alert.alert('Delete team?', `"${t.name.trim()}" will be removed${isSdp ? ' with its players and attendance records' : ''}. This cannot be undone.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteTeam(kind, t.id); load(); } catch (e) { Alert.alert('Could not delete', e.message); } } },
  ]);

  const title = isSdp ? 'SDP Teams' : 'Team Management';
  return (
    <View style={ui.screen}>
      <Header title={title} subtitle={isSdp ? `Today · ${doneCount}/${teams.length} attendance done` : `${teams.length} teams · ${players} players`} onBack={() => navigation.goBack()} />
      <FlatList
        data={loading ? [] : shown}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
        ListHeaderComponent={teams.length > 0 ? (
          <View>
            <View style={s.search}>
              <Ionicons name="search" size={18} color={colors.primary} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search teams" placeholderTextColor={colors.iconMuted} style={s.searchInput} />
            </View>
            {sports.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
                {[null, ...sports].map((sp) => (
                  <Pressable key={String(sp)} onPress={() => setSport(sp)} style={(p) => [s.chip, sport === sp && s.chipOn, press(p)]}>
                    {sp && <MaterialCommunityIcons name={sportIcon(sp)} size={14} color={sport === sp ? '#fff' : colors.primary} />}
                    <Text style={[s.chipText, sport === sp && { color: '#fff' }]}>{sp || 'All sports'}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}
        ListEmptyComponent={loading ? <EmptyState icon="timer-sand" text="Loading teams..." /> : error ? <EmptyState icon="wifi-off" title="Couldn't load teams" text={error} action="Try again" onAction={() => { setLoading(true); load(); }} />
          : teams.length ? <EmptyState icon="magnify" title="No matches" text="Try another name or sport." />
          : <EmptyState title={isSdp ? 'No SDP teams yet' : 'No teams yet'} text="Create your first team and pick players from your school." action="Create team" onAction={() => navigation.navigate('TeamForm', { kind })} />}
        renderItem={({ item: t }) => {
          const c = tintFor(t.sport);
          const done = status[t.id] > 0;
          return (
            <Pressable onPress={() => open(t)} style={(p) => [s.card, press(p)]}>
              <View style={[s.icon, { backgroundColor: c + '1F' }]}><MaterialCommunityIcons name={sportIcon(t.sport)} size={28} color={c} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{t.name.trim()}</Text>
                <View style={s.metaRow}>
                  <SportBadge sport={t.sport} />
                  <Text style={s.meta}><Ionicons name="people" size={12} color={colors.meta} /> {t.players_count || 0}</Text>
                </View>
                {isSdp && (
                  <View style={[s.status, { backgroundColor: done ? colors.primarySoft : colors.accentOrange }]}>
                    <Ionicons name={done ? 'checkmark-circle' : 'time'} size={12} color={done ? colors.primary : '#C2410C'} />
                    <Text style={[s.statusText, { color: done ? colors.primary : '#C2410C' }]}>{done ? `Done today · ${status[t.id]} marked` : 'Pending today'}</Text>
                  </View>
                )}
              </View>
              <Pressable hitSlop={10} onPress={() => setMenu(t)} style={(p) => [s.more, press(p)]}><Ionicons name="ellipsis-horizontal" size={18} color={colors.heading} /></Pressable>
            </Pressable>
          );
        }}
      />
      <Pressable onPress={() => navigation.navigate('TeamForm', { kind })} style={(p) => [s.fab, { bottom: 24 }, press(p)]}>
        <Ionicons name="add" size={22} color="#fff" /><Text style={s.fabText}>New team</Text>
      </Pressable>
      <ActionSheet visible={!!menu} title={menu?.name?.trim()} onClose={() => setMenu(null)} items={menu ? [
        ...(isSdp ? [{ label: 'Take attendance', icon: 'checkmark-done', onPress: () => open(menu) }, { label: 'Players', icon: 'people', onPress: () => navigation.navigate('TeamDetail', { kind, team: menu }) }] : [{ label: 'View players', icon: 'people', onPress: () => open(menu) }]),
        { label: 'Edit team', icon: 'create-outline', onPress: () => navigation.navigate('TeamForm', { kind, team: menu }) },
        { label: 'Delete team', icon: 'trash-outline', danger: true, onPress: () => confirmDelete(menu) },
      ] : []} />
    </View>
  );
}

const s = themed(() => ({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.navyLight, borderRadius: 16, paddingHorizontal: 14, marginBottom: 12, ...shadow },
  searchInput: { flex: 1, paddingVertical: 12, color: colors.text, fontSize: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.heading, fontWeight: '700', fontSize: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.navyLight, borderRadius: 20, padding: 14, marginBottom: 12, ...shadow },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.heading, fontSize: 16, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  meta: { color: colors.meta, fontSize: 12, fontWeight: '700' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginTop: 8 },
  statusText: { fontSize: 11, fontWeight: '800' },
  more: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: 18, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 14, shadowColor: '#1E8E3E', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 15 },
}));