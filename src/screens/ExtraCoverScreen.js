import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Image, Alert, ImageBackground } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getSchools, getCurriculumGrades, getSchoolDivisions, saveExtraActivity } from '../api';
import { ui } from '../components/ui';

// Web: "Extra Covered" card -> Log Extra Activity (save-extra-activity). Saved as Complete for the weekly report.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const now = new Date();
const WEEKS = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
const curWeek = `Week ${Math.min(5, Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7))}`;
const monthOpts = [-1, 0, 1].map((o) => { const d = new Date(now.getFullYear(), now.getMonth() + o, 1); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; });

function Chip({ label, active, onPress }) {
  return <Pressable onPress={onPress} style={[st.chip, active && st.chipOn]}><Text style={[st.chipText, active && { color: '#fff' }]}>{label}</Text></Pressable>;
}
function Field({ label, children }) {
  return <View style={{ marginBottom: 14 }}><Text style={st.label}>{label} <Text style={{ color: colors.error }}>*</Text></Text>{children}</View>;
}

export default function ExtraCoverScreen({ navigation }) {
  const { user } = useAuth();
  const [schools, setSchools] = useState([]);
  const [grades, setGrades] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [f, setF] = useState({ title: '', sport: '', covered_skill: '', objective: '', remark: '', school_id: null, grades: [], divs: [], week: curWeek, month_year: monthOpts[1] });
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  useEffect(() => { getSchools(user).then((s) => { setSchools(s); if (s.length === 1) set('school_id', s[0].id); }).catch(() => {}); }, [user]);
  useEffect(() => {
    if (!f.school_id) return;
    getCurriculumGrades('inschool', null, f.school_id).then(setGrades).catch(() => setGrades([]));
    getSchoolDivisions(f.school_id).then(setDivisions).catch(() => setDivisions([]));
  }, [f.school_id]);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 0.7 });
    if (!r.canceled) setPhotos((p) => [...p, ...r.assets].slice(0, 10));
  };

  const submit = async () => {
    const miss = [['title', 'Title'], ['sport', 'Sport / Activity Type'], ['covered_skill', 'Covered Skill'], ['objective', 'Objective']].find(([k]) => !f[k].trim());
    if (miss) return Alert.alert('Missing', `Please enter ${miss[1]}.`);
    if (!f.school_id) return Alert.alert('Missing', 'Please select a School.');
    if (!f.grades.length) return Alert.alert('Missing', 'Please select at least one Grade.');
    if (!f.divs.length) return Alert.alert('Missing', 'Please select at least one Division.');
    if (!f.remark.trim()) return Alert.alert('Missing', 'Please enter Remarks.');
    setSaving(true);
    try {
      await saveExtraActivity(user, { title: f.title.trim(), sport: f.sport.trim(), covered_skill: f.covered_skill.trim(), objective: f.objective.trim(), school_id: f.school_id, grade: f.grades.join(','), divisions: f.divs.join(','), remark: f.remark.trim(), week: f.week, month_year: f.month_year }, photos);
      Alert.alert('Logged', 'Extra activity logged successfully!', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) { Alert.alert('Could not save', e.message); }
    finally { setSaving(false); }
  };

  const input = (k, ph, multi) => <TextInput value={f[k]} onChangeText={(t) => set(k, t)} placeholder={ph} placeholderTextColor={colors.iconMuted} multiline={multi} style={[st.input, multi && { minHeight: 80, textAlignVertical: 'top' }]} />;

  return (
    <View style={ui.screen}>
      <ImageBackground source={require('../../assets/curriculum/extra.jpg')} style={st.cover}>
        <LinearGradient colors={['rgba(0,0,0,0.15)', 'rgba(8,40,20,0.85)']} style={st.coverInner}>
          <Pressable onPress={() => navigation.goBack()} style={st.back}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <View style={st.pill}><Text style={st.pillText}>WEEK & MONTH TRACKING</Text></View>
          <Text style={st.coverTitle}>Log Extra Activity</Text>
          <Text style={st.coverSub}>Saved as Complete on the Weekly Report Card</Text>
        </LinearGradient>
      </ImageBackground>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={st.card}>
          <Text style={st.cardHead}>When</Text>
          <Field label="Week"><View style={st.wrap}>{WEEKS.map((w) => <Chip key={w} label={w} active={f.week === w} onPress={() => set('week', w)} />)}</View></Field>
          <Field label="Month"><View style={st.wrap}>{monthOpts.map((m) => <Chip key={m} label={m} active={f.month_year === m} onPress={() => set('month_year', m)} />)}</View></Field>
        </View>
        <View style={st.card}>
          <Text style={st.cardHead}>Activity</Text>
          <Field label="Activity Title">{input('title', 'e.g. Extra Basketball Drills, Yoga Session')}</Field>
          <Field label="Sport / Activity Type">{input('sport', 'e.g. Basketball, Football, Yoga')}</Field>
          <Field label="Covered Skill">{input('covered_skill', 'e.g. Chest Pass, Dribbling, Warm up')}</Field>
          <Field label="Objective">{input('objective', 'e.g. Develop coordination and passing', true)}</Field>
        </View>
        <View style={st.card}>
          <Text style={st.cardHead}>Class</Text>
          {schools.length > 1 && <Field label="School"><View style={st.wrap}>{schools.map((s) => <Chip key={s.id} label={s.name} active={f.school_id === s.id} onPress={() => setF((x) => ({ ...x, school_id: s.id, grades: [], divs: [] }))} />)}</View></Field>}
          {schools.length === 1 && <Text style={[ui.meta, { marginTop: 0, marginBottom: 12 }]}>{schools[0].name}</Text>}
          <Field label={`Grade / Standard (${f.grades.length} selected)`}>
            {grades.length ? <View style={st.wrap}>{grades.map((g) => <Chip key={g} label={/^\d+$/.test(g) ? `Grade ${g}` : g} active={f.grades.includes(g)} onPress={() => toggle('grades', g)} />)}</View> : <Text style={ui.meta}>No grades set up for this school.</Text>}
          </Field>
          <Field label={`Division (${f.divs.length} selected)`}>
            {divisions.length ? <View style={st.wrap}>{divisions.map((d) => <Chip key={d} label={d} active={f.divs.includes(d)} onPress={() => toggle('divs', d)} />)}</View> : <Text style={ui.meta}>No divisions set up for this school.</Text>}
          </Field>
        </View>
        <View style={st.card}>
          <Text style={st.cardHead}>Notes & photos</Text>
          <Field label="Remarks">{input('remark', 'How did the session go?', true)}</Field>
          <ScrollView horizontal>
            <Pressable onPress={pick} style={st.add}><Ionicons name="camera" size={22} color={colors.primary} /><Text style={st.addText}>Add</Text></Pressable>
            {photos.map((p, i) => <View key={p.uri}><Image source={{ uri: p.uri }} style={st.preview} /><Pressable onPress={() => setPhotos(photos.filter((_, j) => j !== i))} style={st.x}><Ionicons name="close" size={12} color="#fff" /></Pressable></View>)}
          </ScrollView>
        </View>
      </ScrollView>
      <View style={st.footer}>
        <Pressable disabled={saving} onPress={submit} style={[ui.btn, { flexDirection: 'row', justifyContent: 'center', gap: 8 }, saving && { opacity: 0.6 }]}>
          <Ionicons name="add-circle" size={18} color="#fff" /><Text style={ui.btnText}>{saving ? 'Saving...' : 'Log Activity'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const shadow = { shadowColor: '#0F3D1F', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 };
const st = themed(() => ({
  cover: { height: 210 },
  coverInner: { flex: 1, padding: 20, paddingTop: 48, justifyContent: 'flex-end' },
  back: { position: 'absolute', top: 44, left: 16, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  pill: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  pillText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  coverTitle: { color: '#fff', fontSize: 26, fontWeight: '900' },
  coverSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  card: { backgroundColor: colors.navyLight, borderRadius: 22, padding: 16, marginBottom: 14, ...shadow },
  cardHead: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  label: { color: colors.subtext, fontWeight: '700', marginBottom: 6, fontSize: 13 },
  input: { backgroundColor: colors.navy, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.navy },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.heading, fontWeight: '700', fontSize: 13 },
  add: { width: 72, height: 72, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  preview: { width: 72, height: 72, borderRadius: 16, marginRight: 8 },
  x: { position: 'absolute', top: 3, right: 11, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 9, padding: 2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 26, backgroundColor: colors.navy, borderTopWidth: 1, borderTopColor: colors.cardBorder },
}));