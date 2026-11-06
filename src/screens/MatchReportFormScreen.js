import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, FlatList, Pressable, Image, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getSchools, getMatchOptions, saveMatchReport, fileUrl } from '../api';
import { MatchHeader, MatchButton, MatchDropdown, MatchBadge, ms } from '../components/matchReports';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  ...props
}) {
  return <View><Text style={ms.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.iconMuted} style={[ms.input, multiline && {
      minHeight: 110,
      textAlignVertical: 'top'
    }]} multiline={multiline} {...props} /></View>;
}
function Score({
  name,
  value,
  onChange
}) {
  return <View style={[ms.card, {
    alignItems: 'center',
    gap: 12
  }]}><Text style={ms.title}>{name}</Text><View style={ms.row}><Pressable accessibilityLabel={`Decrease ${name} score`} onPress={() => onChange(Math.max(0, Number(value || 0) - 1))} style={ms.counter}><Ionicons name="remove" size={25} color={colors.primary} /></Pressable><TextInput accessibilityLabel={`${name} score`} keyboardType="number-pad" maxLength={4} value={String(value)} onChangeText={v => onChange(v.replace(/[^0-9]/g, ''))} onBlur={() => onChange(Number(value || 0))} style={[ms.input, {
        fontSize: 32,
        fontWeight: '900',
        width: 105,
        textAlign: 'center'
      }]} /><Pressable accessibilityLabel={`Increase ${name} score`} onPress={() => onChange(Math.min(9999, Number(value || 0) + 1))} style={ms.counter}><Ionicons name="add" size={25} color={colors.primary} /></Pressable></View></View>;
}
export default function MatchReportFormScreen({
  navigation,
  route
}) {
  const old = route.params?.report;
  const {
    user
  } = useAuth();
  const uploadMode = old ? !old.structured : !!route.params?.upload;
  const [step, setStep] = useState(0),
    [schools, setSchools] = useState([]),
    [teams, setTeams] = useState([]),
    [players, setPlayers] = useState([]),
    [optionsLoading, setOptionsLoading] = useState(false),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const [schoolId, setSchoolId] = useState(old?.school_id || null),
    [date, setDate] = useState(old?.match_date ? String(old.match_date).slice(0, 10) : today()),
    [sport, setSport] = useState(old?.sport || 'Football'),
    [venue, setVenue] = useState(old?.venue || '');
  const [homeId, setHomeId] = useState(old?.home_team_id || 'custom'),
    [awayId, setAwayId] = useState(old?.away_team_id || 'custom'),
    [home, setHome] = useState(old?.home_team_name || ''),
    [away, setAway] = useState(old?.away_team_name || ''),
    [hs, setHs] = useState(old?.home_score ?? 0),
    [as, setAs] = useState(old?.away_score ?? 0);
  const [selected, setSelected] = useState(old?.player_ids || []),
    [notes, setNotes] = useState(old?.notes || ''),
    [photos, setPhotos] = useState([]),
    [retained, setRetained] = useState(old?.photos || []),
    [pdf, setPdf] = useState(null),
    [q, setQ] = useState(''),
    [grade, setGrade] = useState('All grades');
  const steps = uploadMode ? ['School & date', 'PDF & review'] : ['Match', 'Score', 'Players', 'Photos & review'];
  const loadSchools = () => getSchools(user).then(s => {
    setSchools(s);
    if (!schoolId && s.length) setSchoolId(s[0].id);
  }).catch(e => setError(e.message));
  useEffect(() => {
    loadSchools();
  }, []);
  const loadOptions = () => {
    if (!schoolId) return;
    setOptionsLoading(true);
    setError('');
    return getMatchOptions(schoolId).then(d => {
      setTeams(d.teams);
      setPlayers(d.players);
    }).catch(e => {
      setError(e.message);
      setTeams([]);
      setPlayers([]);
    }).finally(() => setOptionsLoading(false));
  };
  useEffect(() => {
    loadOptions();
  }, [schoolId]);
  const grades = useMemo(() => ['All grades', ...new Set(players.map(p => String(p.std)).filter(Boolean))], [players]);
  const shown = useMemo(() => players.filter(p => (grade === 'All grades' || String(p.std) === grade) && `${p.name} ${p.std} ${p.division}`.toLowerCase().includes(q.toLowerCase())), [players, q, grade]);
  const school = schools.find(s => Number(s.id) === Number(schoolId));
  const result = Number(hs) > Number(as) ? 'WIN' : Number(hs) < Number(as) ? 'LOSS' : 'DRAW';
  const teamOptions = [...teams, {
    id: 'custom',
    name: 'Other team / enter a name'
  }];
  const changeSchool = item => {
    if (Number(item.id) === Number(schoolId)) return;
    setSchoolId(item.id);
    setHomeId('custom');
    setAwayId('custom');
    setHome('');
    setAway('');
    setSelected([]);
    setGrade('All grades');
  };
  const pickPhotos = async () => {
    try {
      const remaining = 6 - photos.length - retained.length;
      if (remaining <= 0) return Alert.alert('Photo limit', 'Keep up to six match photos.');
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return Alert.alert('Photo access', 'Allow photo access in your device settings.');
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: .8
      });
      if (!r.canceled) {
        const picked = r.assets.slice(0, remaining);
        if (picked.some(x => x.fileSize > 10 * 1024 * 1024)) return Alert.alert('Photo too large', 'Each photo must be under 10 MB.');
        setPhotos(p => [...p, ...picked]);
      }
    } catch (e) {
      Alert.alert('Could not select photos', e.message);
    }
  };
  const pickPdf = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true
      });
      if (!r.canceled) {
        if (r.assets[0].size > 10 * 1024 * 1024) return Alert.alert('PDF too large', 'Choose a PDF under 10 MB.');
        setPdf(r.assets[0]);
      }
    } catch (e) {
      Alert.alert('Could not select PDF', e.message);
    }
  };
  const validMatch = () => {
    if (!schoolId) return 'Choose a school.';
    const d = new Date(date + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return 'Enter a valid date as YYYY-MM-DD.';
    if (!uploadMode && (!sport.trim() || !home.trim() || !away.trim())) return 'Choose a sport and both teams.';
    if (!uploadMode && home.trim().toLowerCase() === away.trim().toLowerCase()) return 'Choose two different teams.';
    return '';
  };
  const save = async () => {
    const err = validMatch();
    if (err) return Alert.alert('Check match details', err);
    if (uploadMode && !pdf && !old?.file_path) return Alert.alert('Select a PDF', 'Choose the original match report PDF.');
    setSaving(true);
    try {
      const fields = {
        school_id: schoolId,
        match_date: date,
        structured: !uploadMode,
        sport: sport.trim(),
        home_team_id: homeId === 'custom' ? '' : homeId,
        away_team_id: awayId === 'custom' ? '' : awayId,
        home_team_name: home.trim(),
        away_team_name: away.trim(),
        home_score: Number(hs || 0),
        away_score: Number(as || 0),
        venue,
        notes,
        player_ids: selected,
        retained_photos: retained
      };
      const r = await saveMatchReport(old?.id, fields, photos, pdf);
      navigation.replace('MatchReportDetail', {
        id: r.reportId
      });
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  };
  const next = () => {
    if (step === 0) {
      const err = validMatch();
      if (err) return Alert.alert('Check match details', err);
    }
    if (step === steps.length - 1) return save();
    setStep(s => s + 1);
  };
  const back = () => {
    if (saving) return;
    if (step > 0) setStep(s => s - 1);else navigation.goBack();
  };
  const top = <><View style={{
      flexDirection: 'row',
      gap: 7,
      padding: 16
    }}>{steps.map((x, i) => <View key={x} style={[ms.step, i <= step && ms.stepOn]} />)}</View>{!!error && <View style={{
      paddingHorizontal: 16
    }}><Text style={ms.error}>{error}</Text><MatchButton label="Retry loading choices" secondary onPress={() => {
        loadSchools();
        loadOptions();
      }} /></View>}</>;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ms.screen}><MatchHeader title={old ? 'Edit match report' : uploadMode ? 'Upload match PDF' : 'New match report'} sub={`STEP ${step + 1} / ${steps.length} · ${steps[step]}`} onBack={back} />{top}{step === 2 && !uploadMode ? <FlatList data={shown} keyExtractor={p => String(p.id)} contentContainerStyle={{
      padding: 16,
      paddingBottom: 24
    }} keyboardShouldPersistTaps="handled" ListHeaderComponent={<View><Text style={ms.title}>Choose your match squad</Text><Text style={ms.meta}>{selected.length} selected · students from {school?.name}</Text><TextInput value={q} onChangeText={setQ} placeholder="Find a player, grade or division" placeholderTextColor={colors.iconMuted} style={ms.input} /><ScrollView horizontal contentContainerStyle={{
        gap: 8,
        paddingVertical: 12
      }}>{grades.map(g => <Pressable key={g} onPress={() => setGrade(g)} style={[ms.chip, grade === g && ms.chipOn]}><Text style={ms.body}>{g}</Text></Pressable>)}</ScrollView><Pressable onPress={() => {
        const ids = shown.map(x => x.id),
          all = ids.every(id => selected.includes(id));
        setSelected(all ? selected.filter(x => !ids.includes(x)) : [...new Set([...selected, ...ids])]);
      }} style={{
        padding: 12
      }}><Text style={{
          color: colors.primary,
          fontWeight: '800'
        }}>Select / clear visible players</Text></Pressable></View>} ListEmptyComponent={optionsLoading ? <ActivityIndicator color={colors.primary} /> : <Text style={ms.meta}>No players found. You may continue without a squad.</Text>} renderItem={({
      item: p
    }) => <Pressable style={[ms.player, selected.includes(p.id) && ms.chipOn]} onPress={() => setSelected(s => s.includes(p.id) ? s.filter(x => x !== p.id) : [...s, p.id])}><Ionicons name={selected.includes(p.id) ? 'checkbox' : 'square-outline'} size={25} color={colors.primary} /><View style={{
        flex: 1
      }}><Text style={[ms.body, {
          fontWeight: '700'
        }]}>{p.name}</Text><Text style={ms.meta}>Grade {p.std} · {p.division}</Text></View></Pressable>} /> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{
      padding: 16,
      paddingBottom: 35
    }}>{step === 0 ? <View style={ms.card}><Text style={ms.title}>Set the stage</Text><MatchDropdown label="School" value={schoolId} options={schools} onSelect={changeSchool} /><Field label="Match date · YYYY-MM-DD" value={date} onChangeText={setDate} placeholder="2026-11-06" maxLength={10} />{!uploadMode && <><Field label="Sport" value={sport} onChangeText={setSport} placeholder="Football, Basketball…" maxLength={100} /><Field label="Venue (optional)" value={venue} onChangeText={setVenue} placeholder="Where did you play?" maxLength={255} />{optionsLoading && <ActivityIndicator color={colors.primary} />}<MatchDropdown label="Home team" value={homeId} options={teamOptions} onSelect={t => {
            setHomeId(t.id);
            setHome(t.id === 'custom' ? '' : t.name);
            if (t.sport) setSport(t.sport);
          }} />{homeId === 'custom' && <Field label="Home team name" value={home} onChangeText={setHome} placeholder="Your team" maxLength={255} />}<MatchDropdown label="Away team" value={awayId} options={teamOptions} onSelect={t => {
            setAwayId(t.id);
            setAway(t.id === 'custom' ? '' : t.name);
          }} />{awayId === 'custom' && <Field label="Away team name" value={away} onChangeText={setAway} placeholder="Opponent" maxLength={255} />}<Text style={[ms.meta, {
            marginTop: 14
          }]}>Dropdowns use your school's teams. Choose “Other team” for an outside opponent.</Text></>}</View> : step === 1 && !uploadMode ? <><Text style={[ms.title, {
          marginBottom: 14
        }]}>Final score</Text><Score name={home} value={hs} onChange={setHs} /><Score name={away} value={as} onChange={setAs} /><View style={ms.note}><MatchBadge result={result} /><Text style={[ms.meta, {
            marginTop: 8
          }]}>Result is calculated for {home}.</Text></View></> : uploadMode ? <View style={ms.card}><Text style={ms.title}>Original PDF</Text><Text style={[ms.meta, {
          marginVertical: 10
        }]}>Web Match Reports stores an uploaded PDF. Upload it here to keep exactly the same design, pages and photos.</Text><MatchButton label={pdf ? 'Change PDF' : 'Choose PDF · up to 10 MB'} icon="document-text-outline" secondary onPress={pickPdf} />{!!pdf && <Text style={[ms.body, {
          marginTop: 14
        }]}>{pdf.name}</Text>}{!pdf && old?.file_path && <Text style={ms.meta}>Keeping the existing PDF unless you choose a replacement.</Text>}<View style={ms.note}><Text style={ms.body}>{school?.name}</Text><Text style={ms.meta}>{date}</Text></View></View> : <><View style={ms.card}><Text style={ms.title}>Match highlights</Text><Field label="Match notes (optional)" value={notes} onChangeText={setNotes} placeholder="Key moments, stand-out performances…" multiline maxLength={10000} /><Text style={ms.label}>Photos · {photos.length + retained.length}/6</Text><ScrollView horizontal contentContainerStyle={{
            gap: 10,
            marginBottom: 14
          }}>{retained.map(p => <View key={p}><Image source={{
                uri: fileUrl(p)
              }} style={ms.thumb} /><Pressable accessibilityLabel="Remove existing photo" onPress={() => setRetained(s => s.filter(x => x !== p))} style={ms.photoRemove}><Ionicons name="close" size={17} color="#fff" /></Pressable></View>)}{photos.map((p, i) => <View key={p.uri}><Image source={{
                uri: p.uri
              }} style={ms.thumb} /><Pressable accessibilityLabel="Remove new photo" onPress={() => setPhotos(s => s.filter((_, j) => j !== i))} style={ms.photoRemove}><Ionicons name="close" size={17} color="#fff" /></Pressable></View>)}</ScrollView><MatchButton label="Add match photos" secondary icon="images-outline" onPress={pickPhotos} disabled={photos.length + retained.length >= 6} /></View><View style={ms.card}><Text style={ms.title}>Ready for the final whistle?</Text><Text style={[ms.score, {
            fontSize: 23
          }]}>{home} {Number(hs || 0)} : {Number(as || 0)} {away}</Text><MatchBadge result={result} /><Text style={[ms.body, {
            marginTop: 12
          }]}>{school?.name}</Text><Text style={ms.meta}>{date} · {sport} · {selected.length} players</Text><Text style={[ms.meta, {
            marginTop: 10
          }]}>A downloadable scorecard PDF is available after saving. Uploaded web PDFs remain unchanged.</Text></View></>}</ScrollView>}<View style={ms.footer}>{step > 0 && <View style={{
        flex: 1
      }}><MatchButton label="Back" secondary onPress={back} disabled={saving} /></View>}<View style={{
        flex: 2
      }}><MatchButton label={saving ? 'Saving & uploading…' : step === steps.length - 1 ? old ? 'Save changes' : 'Save report' : 'Continue'} icon={step === steps.length - 1 ? 'checkmark-circle-outline' : 'arrow-forward'} disabled={saving || !schools.length || optionsLoading} onPress={next} /></View></View></KeyboardAvoidingView>;
}
