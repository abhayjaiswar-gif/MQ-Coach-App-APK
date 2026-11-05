import { useCallback, useState } from 'react';
import { View, Text, Pressable, FlatList, RefreshControl, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed } from '../theme/colors';
import { getTeamPlayers, removePlayer } from '../api';
import { Avatar, EmptyState, sportIcon, classLabel, press, shadow } from '../components/teams';

// Team detail: header + roster, sticky "Add players"
export default function TeamDetailScreen({ navigation, route }) {
  const { kind, team } = route.params;
  const insets = useSafeAreaInsets();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setPlayers(await getTeamPlayers(kind, team.id)); } catch (e) { Alert.alert('Could not load players', e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [kind, team.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = (p) => Alert.alert('Remove player?', `Remove ${p.name} from ${team.name.trim()}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { try { await removePlayer(kind, team.id, p.id); load(); } catch (e) { Alert.alert('Could not remove', e.message); } } },
  ]);

  return (
    <View style={s.screen}>
      <LinearGradient colors={['#166B2F', '#1E8E3E']} style={[s.hero, { paddingTop: insets.top + 8 }]}>
        <MaterialCommunityIcons name={sportIcon(team.sport)} size={150} color="rgba(255,255,255,0.08)" style={{ position: 'absolute', right: -20, bottom: -30 }} />
        <Pressable onPress={() => navigation.goBack()} style={(p) => [s.back, press(p)]}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
        <View style={s.pill}><MaterialCommunityIcons name={sportIcon(team.sport)} size={12} color="#fff" /><Text style={s.pillText}>{(team.sport || 'General').toUpperCase()}</Text></View>
        <Text style={s.title} numberOfLines={2}>{team.name.trim()}</Text>
        <Text style={s.sub} numberOfLines={1}>{[team.school_name, `${players.length} players`].filter(Boolean).join('  ·  ')}</Text>
      </LinearGradient>
      <FlatList
        data={loading ? [] : players}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
        ListHeaderComponent={players.length ? <Text style={s.section}>Roster</Text> : null}
        ListEmptyComponent={loading ? <EmptyState icon="timer-sand" text="Loading players..." /> : <EmptyState title="No players yet" text="Add students from your school to build this team." />}
        renderItem={({ item: p, index }) => (
          <View style={s.row}>
            <Text style={s.num}>{index + 1}</Text>
            <Avatar name={p.name} />
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>{p.name}</Text>
              <Text style={s.meta} numberOfLines={1}>{classLabel(p)}</Text>
            </View>
            <Pressable hitSlop={10} onPress={() => remove(p)} style={(x) => [s.rm, press(x)]}><Ionicons name="close" size={16} color={colors.meta} /></Pressable>
          </View>
        )}
      />
      <View style={[s.footer, { paddingBottom: 14 }]}>
        <Pressable onPress={() => navigation.navigate('AddPlayers', { kind, team, existingIds: players.map((p) => p.id) })} style={(p) => [s.cta, press(p)]}>
          <Ionicons name="person-add" size={18} color="#fff" /><Text style={s.ctaText}>Add players</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.navy },
  hero: { paddingHorizontal: 18, paddingBottom: 20, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: 'hidden' },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  pillText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: '#fff', fontSize: 22, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4 },
  section: { color: colors.meta, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginLeft: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.navyLight, borderRadius: 16, padding: 12, marginBottom: 10, ...shadow },
  num: { color: colors.iconMuted, fontWeight: '800', width: 18, textAlign: 'center', fontSize: 12 },
  name: { color: colors.heading, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.meta, fontSize: 12, marginTop: 2 },
  rm: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.navyLight, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  cta: { height: 52, borderRadius: 999, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
}));