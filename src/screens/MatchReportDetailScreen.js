import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Image, Pressable, Modal, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { getMatchReport, fileUrl } from '../api';
import { MatchHeader, MatchBadge, MatchButton, matchDate, openMatchPdf, ms } from '../components/matchReports';
export default function MatchReportDetailScreen({
  navigation,
  route
}) {
  const [r, setR] = useState(null),
    [error, setError] = useState(''),
    [photo, setPhoto] = useState(null),
    [loading, setLoading] = useState(true),
    [opening, setOpening] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setR(await getMatchReport(route.params.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [route.params.id]);
  useFocusEffect(useCallback(() => {
    load();
  }, [load]));
  return <View style={ms.screen}><MatchHeader title="Match details" sub={r?.school_name} onBack={() => navigation.goBack()} />{loading ? <ActivityIndicator color={colors.primary} style={{
      marginTop: 30
    }} /> : error ? <View style={{
      padding: 20
    }}><Text style={ms.error}>{error}</Text><MatchButton label="Retry" onPress={load} /></View> : r && <><ScrollView contentContainerStyle={{
        padding: 16,
        paddingBottom: 30
      }}><View style={ms.card}><View style={[ms.row, {
            justifyContent: 'space-between'
          }]}><MatchBadge result={r.result} /><Text style={ms.meta}>{matchDate(r.match_date || r.created_at)}</Text></View>{r.structured ? <><View style={[ms.row, {
              marginTop: 20
            }]}><Text style={[ms.title, {
                flex: 1,
                textAlign: 'center'
              }]}>{r.home_team_name}</Text><Text style={ms.meta}>VS</Text><Text style={[ms.title, {
                flex: 1,
                textAlign: 'center'
              }]}>{r.away_team_name}</Text></View><Text style={ms.score}>{r.home_score} : {r.away_score}</Text><Text style={[ms.meta, {
              textAlign: 'center'
            }]}>Result from the home team's perspective</Text><Text style={ms.label}>Sport · Venue</Text><Text style={ms.body}>{r.sport} · {r.venue || 'Not specified'}</Text><Text style={ms.label}>Match notes</Text><Text style={ms.body}>{r.notes || 'No notes added.'}</Text></> : <><Text style={[ms.title, {
              marginTop: 20
            }]}>Original uploaded PDF</Text><Text style={[ms.meta, {
              marginTop: 8
            }]}>This is the same document available in the web Match Report registry. No redesign or conversion is applied.</Text></>}</View>{r.structured && <View style={ms.card}><Text style={ms.title}>Match squad · {r.players.length}</Text>{r.players.length ? r.players.map(p => <View key={p.id} style={ms.option}><Text style={[ms.body, {
              flex: 1
            }]}>{p.name}</Text><Text style={ms.meta}>{p.std} {p.division}</Text></View>) : <Text style={ms.meta}>No players selected.</Text>}</View>}{!!r.photos.length && <View style={ms.card}><Text style={ms.title}>Match highlights</Text><ScrollView horizontal contentContainerStyle={{
            gap: 10,
            paddingTop: 14
          }}>{r.photos.map(p => <Pressable key={p} onPress={() => setPhoto(fileUrl(p))}><Image source={{
                uri: fileUrl(p)
              }} style={ms.thumb} /></Pressable>)}</ScrollView></View>}<MatchButton label={opening ? 'Opening…' : 'View / Download PDF'} disabled={opening} icon="document-text-outline" onPress={async () => {
          setOpening(true);
          try {
            await openMatchPdf(r.id);
          } finally {
            setOpening(false);
          }
        }} /></ScrollView>{r.can_edit && <View style={ms.footer}><View style={{
          flex: 1
        }}><MatchButton label="Edit match report" secondary icon="create-outline" onPress={() => navigation.navigate('MatchReportForm', {
            report: r
          })} /></View></View>}</>}<Modal visible={!!photo} transparent onRequestClose={() => setPhoto(null)}><Pressable accessibilityLabel="Close photo" onPress={() => setPhoto(null)} style={{
        flex: 1,
        backgroundColor: '#080C09',
        justifyContent: 'center'
      }}><Image source={{
          uri: photo || undefined
        }} resizeMode="contain" style={{
          width: '100%',
          height: '85%'
        }} /><Text style={{
          color: '#fff',
          textAlign: 'center'
        }}>Tap to close</Text></Pressable></Modal></View>;
}
