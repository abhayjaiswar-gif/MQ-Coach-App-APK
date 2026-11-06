import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { getMatchReports } from '../api';
import { MatchHeader, MatchButton, MatchBadge, matchDate, ms } from '../components/matchReports';
export default function MatchReportScreen({
  navigation
}) {
  const [reports, setReports] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [q, setQ] = useState(''),
    [filter, setFilter] = useState('ALL');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReports(await getMatchReports());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    load();
  }, [load]));
  const shown = useMemo(() => reports.filter(r => (filter === 'ALL' || r.result === filter) && `${r.school_name} ${r.home_team_name || ''} ${r.away_team_name || ''} ${r.sport || ''}`.toLowerCase().includes(q.toLowerCase())), [reports, filter, q]);
  return <View style={ms.screen}><MatchHeader title="Match Reports" sub={`${reports.length} reports · every match, one story`} onBack={() => navigation.goBack()} /><FlatList data={shown} keyExtractor={r => String(r.id)} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />} contentContainerStyle={{
      padding: 16,
      paddingBottom: 28
    }} ListHeaderComponent={<View><MatchButton label="Create match report" icon="add-circle-outline" onPress={() => navigation.navigate('MatchReportForm')} /><Pressable onPress={() => navigation.navigate('MatchReportForm', {
        upload: true
      })} style={{
        alignSelf: 'center',
        padding: 14
      }}><Text style={{
          color: colors.primary,
          fontWeight: '700'
        }}>Or upload an existing PDF</Text></Pressable><TextInput value={q} onChangeText={setQ} placeholder="Search school, team or sport" placeholderTextColor={colors.iconMuted} style={ms.input} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{
        gap: 8,
        paddingVertical: 12
      }}>{['ALL', 'WIN', 'LOSS', 'DRAW', 'UPLOADED'].map(x => <Pressable key={x} onPress={() => setFilter(x)} style={[ms.chip, filter === x && ms.chipOn]}><Text style={[ms.meta, {
            fontWeight: '800',
            color: filter === x ? colors.primary : colors.meta
          }]}>{x}</Text></Pressable>)}</ScrollView>{!!error && <View><Text style={ms.error}>{error}</Text><MatchButton label="Retry" secondary onPress={load} /></View>}</View>} ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} style={{
      marginTop: 28
    }} /> : !error && <View style={ms.empty}><Ionicons name="trophy-outline" size={44} color={colors.primary} /><Text style={ms.title}>No matches here yet</Text><Text style={ms.meta}>{q || filter !== 'ALL' ? 'Try a different search or result.' : 'Create a scorecard or upload your web report PDF.'}</Text></View>} renderItem={({
      item: r
    }) => <Pressable onPress={() => navigation.navigate('MatchReportDetail', {
      id: r.id
    })} style={({
      pressed
    }) => [ms.card, pressed && {
      opacity: .8
    }]}><View style={[ms.row, {
        justifyContent: 'space-between'
      }]}><MatchBadge result={r.result} /><Text style={ms.meta}>{matchDate(r.match_date || r.created_at)}</Text></View>{r.structured ? <><View style={[ms.row, {
          marginTop: 18
        }]}><Text style={[ms.title, {
            flex: 1,
            textAlign: 'center'
          }]}>{r.home_team_name}</Text><Text style={ms.meta}>VS</Text><Text style={[ms.title, {
            flex: 1,
            textAlign: 'center'
          }]}>{r.away_team_name}</Text></View><Text style={ms.score}>{r.home_score} : {r.away_score}</Text></> : <View style={[ms.row, {
        marginVertical: 20
      }]}><Ionicons name="document-text-outline" size={30} color={colors.primary} /><Text style={ms.title}>Uploaded match report</Text></View>}<View style={ms.row}><View style={{
          flex: 1
        }}><Text style={ms.body}>{r.school_name}</Text><Text style={ms.meta}>{r.structured ? `${r.sport} · ${r.player_ids.length} players` : `#MR-${String(r.id).padStart(4, '0')} · Original PDF`}</Text></View><Ionicons name="arrow-forward-circle" size={28} color={colors.primary} /></View></Pressable>} /></View>;
}
