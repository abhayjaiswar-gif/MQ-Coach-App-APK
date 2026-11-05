import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, FlatList, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getStudents, getLectureSchools, getServerDate, getStudentAttendance, saveStudentAttendance, markLecture } from '../api';
import { Avatar, press, shadow } from '../components/teams';

// Lecture attendance popup (bottom sheet over the current tab, tab bar stays visible).
// Web equivalents: Mark Lecture (POST /api/management/lectures) + Student Attendance (POST /api/student-attendance/upload).
// Easy flow: today, only school, last class/division/sport are auto-picked; everyone starts Present, tap to mark Absent.
const LAST_KEY = 'lecture_attendance_last';
const sortNum = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const toStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromStr = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = fromStr(s); d.setDate(d.getDate() + n); return toStr(d); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pretty = (s) => { const d = fromStr(s); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`; };
const weekNo = (s) => { const d = fromStr(s).getDate(); return d <= 7 ? 'Week 1' : d <= 14 ? 'Week 2' : d <= 21 ? 'Week 3' : 'Week 4'; };
const hhmm = (h) => `${String(h % 24).padStart(2, '0')}:00`;
const classLabel = (g) => (/^\d+$/.test(String(g)) ? `Class ${g}` : g);
const norm = (v) => String(v || '').trim().toLowerCase();
const SPORTS = ['Football', 'Cricket', 'Basketball', 'Athletics', 'Kabaddi', 'Yoga'];

export default function LectureAttendanceScreen({ navigation }) {
  const { user } = useAuth();
  const [all, setAll] = useState([]);
  const [schools, setSchools] = useState([]);
  const [today, setToday] = useState(null);
  const [date, setDate] = useState(null);
  const [school, setSchool] = useState(null);
  const [std, setStd] = useState(null);
  const [div, setDiv] = useState(null);
  const [sport, setSport] = useState('');
  const [absent, setAbsent] = useState(new Set());
  const [already, setAlready] = useState(false);
  const [picker, setPicker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const close = () => navigation.goBack();

  useEffect(() => { (async () => {
    try {
      const [st, sc, t, raw] = await Promise.all([getStudents(user), getLectureSchools(user).catch(() => []), getServerDate().catch(() => toStr(new Date())), SecureStore.getItemAsync(LAST_KEY).catch(() => null)]);
      const active = st.filter((x) => x.status === 1 || x.status === '1' || x.status === 'Active');
      setAll(active); setSchools(sc); setToday(t); setDate(t);
      let last = {}; try { last = raw ? JSON.parse(raw) : {}; } catch {}
      const names = [...new Set(active.map((x) => x.school_name).filter(Boolean))];
      const sch = names.includes(last.school) ? last.school : names[0] || null;
      setSchool(sch);
      const inSch = active.filter((x) => x.school_name === sch);
      if (inSch.some((x) => x.std === last.std)) {
        setStd(last.std);
        if (inSch.some((x) => x.std === last.std && x.division === last.div)) setDiv(last.div);
      }
      if (last.sport) setSport(last.sport);
    } catch (e) { Alert.alert('Could not load students', e.message); }
    finally { setLoading(false); }
  })(); }, []);

  const schoolNames = useMemo(() => [...new Set(all.map((x) => x.school_name).filter(Boolean))].sort(), [all]);
  const inSchool = useMemo(() => all.filter((x) => x.school_name === school), [all, school]);
  const stds = useMemo(() => [...new Set(inSchool.map((x) => x.std).filter(Boolean))].sort(sortNum), [inSchool]);
  const divs = useMemo(() => [...new Set(inSchool.filter((x) => x.std === std).map((x) => x.division).filter(Boolean))].sort(sortNum), [inSchool, std]);
  const kids = useMemo(() => (std && div ? inSchool.filter((x) => x.std === std && x.division === div).sort((a, b) => (a.name || '').localeCompare(b.name || '')) : []), [inSchool, std, div]);

  // Auto-pick the division when the class has only one.
  useEffect(() => { if (std && !div && divs.length === 1) setDiv(divs[0]); }, [std, divs]);

  // Overlay anything already saved for this class and day.
  useEffect(() => {
    setAbsent(new Set()); setAlready(false);
    if (!kids.length || !date) return;
    let live = true;
    getStudentAttendance(user, date, school).then((rows) => {
      if (!live) return;
      const a = new Set(); let hit = false;
      kids.forEach((k) => {
        const r = rows.find((x) => (k.mq_id && norm(x.mq_id) === norm(k.mq_id)) || (norm(x.student_name) === norm(k.name) && norm(x.standard) === norm(k.std) && norm(x.division) === norm(k.division)));
        if (r) { hit = true; if (r.status === 'absent') a.add(k.id); }
      });
      setAbsent(a); setAlready(hit);
    }).catch(() => {});
    return () => { live = false; };
  }, [kids, date]);

  const toggle = (id) => setAbsent((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const presentCount = kids.length - absent.size;

  const save = async () => {
    if (!sport.trim()) return Alert.alert('One more thing', 'Please choose or type the sport you taught.');
    const sc = schools.find((x) => x.name === school) || { id: inSchool[0]?.school_id };
    setSaving(true);
    try {
      const h = new Date().getHours();
      await saveStudentAttendance(user, kids.map((k) => ({ mq_id: k.mq_id || null, student_name: k.name, standard: String(k.std), division: k.division, school_name: school, attendance_date: date, status: absent.has(k.id) ? 'absent' : 'present' })));
      let lectureOk = true;
      if (!already) {
        try { await markLecture(user, { school_id: sc.id, sport: sport.trim(), lecture_date: date, start_time: hhmm(h), end_time: hhmm(h + 1), grade: std, division: div, week_no: weekNo(date) }); }
        catch { lectureOk = false; }
      }
      SecureStore.setItemAsync(LAST_KEY, JSON.stringify({ school, std, div, sport: sport.trim() })).catch(() => {});
      setDone({ present: presentCount, absentees: kids.filter((k) => absent.has(k.id)).map((k) => k.name), lectureOk, updated: already });
    } catch (e) { Alert.alert('Could not save', e.message); }
    finally { setSaving(false); }
  };

  const Dropdown = ({ label, value, empty, onPress, disabled }) => (
    <Pressable disabled={disabled} onPress={onPress} style={(p) => [s.dd, value && s.ddOn, disabled && { opacity: 0.5 }, press(p)]}>
      <View style={{ flex: 1 }}>
        <Text style={s.ddLabel}>{label}</Text>
        <Text style={[s.ddVal, !value && { color: colors.subtext }]} numberOfLines={1}>{value || empty}</Text>
      </View>
      <Ionicons name="chevron-down" size={20} color={value ? colors.primary : colors.iconMuted} />
    </Pressable>
  );

  const pickerOpts = picker === 'school' ? schoolNames : picker === 'class' ? stds : picker === 'div' ? divs : [];
  const pickerCur = picker === 'school' ? school : picker === 'class' ? std : div;
  const pick = (v) => {
    if (picker === 'school') { setSchool(v); setStd(null); setDiv(null); }
    else if (picker === 'class') { setStd(v); setDiv(null); }
    else setDiv(v);
    setPicker(null);
  };

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable style={s.backdrop} onPress={close} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheet}>
        <View style={s.handle} />
        {done ? (
          <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 18 }}>
            <View style={s.okIcon}><Ionicons name="checkmark" size={44} color="#fff" /></View>
            <Text style={s.okTitle}>{done.updated ? 'Attendance updated' : 'Attendance saved'}</Text>
            <Text style={s.okSub}>{classLabel(std)}-{div} · {pretty(date)} · {sport}</Text>
            <View style={s.okRow}>
              <View style={[s.okBox, { backgroundColor: colors.primarySoft }]}><Text style={[s.okNum, { color: colors.primary }]}>{done.present}</Text><Text style={s.okLbl}>Present</Text></View>
              <View style={[s.okBox, { backgroundColor: colors.errorBg }]}><Text style={[s.okNum, { color: colors.error }]}>{done.absentees.length}</Text><Text style={s.okLbl}>Absent</Text></View>
            </View>
            {done.absentees.length > 0 && <Text style={s.okList}>Absent: {done.absentees.join(', ')}</Text>}
            {!done.lectureOk && <Text style={[s.okList, { color: colors.error }]}>Attendance is saved, but the lecture entry could not be recorded.</Text>}
            <Pressable onPress={close} style={(p) => [s.save, { alignSelf: 'stretch', marginTop: 18 }, press(p)]}><Text style={s.saveText}>Done</Text></Pressable>
            <Pressable onPress={() => { setDone(null); setStd(null); setDiv(null); }} style={(p) => [s.ghost, press(p)]}><Text style={s.ghostText}>Take another class</Text></Pressable>
          </ScrollView>
        ) : (<>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Take attendance</Text>
              {!!date && (
                <View style={s.dateRow}>
                  <Pressable hitSlop={10} onPress={() => setDate(addDays(date, -1))} style={s.dateBtn}><Ionicons name="chevron-back" size={18} color={colors.primary} /></Pressable>
                  <Text style={s.dateText}>{date === today ? `Today, ${pretty(date).split(', ')[1]}` : pretty(date)}</Text>
                  <Pressable hitSlop={10} disabled={date >= today} onPress={() => setDate(addDays(date, 1))} style={[s.dateBtn, date >= today && { opacity: 0.3 }]}><Ionicons name="chevron-forward" size={18} color={colors.primary} /></Pressable>
                </View>
              )}
            </View>
            <Pressable onPress={close} hitSlop={8} style={s.x}><Ionicons name="close" size={22} color={colors.subtext} /></Pressable>
          </View>

          {loading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 40 }} /> : (<>
            {schoolNames.length > 1 && <View style={{ marginBottom: 10 }}><Dropdown label="School" value={school} empty="Choose school" onPress={() => setPicker('school')} /></View>}
            <View style={s.ddRow}>
              <Dropdown label="Class" value={std && classLabel(std)} empty="Choose" onPress={() => setPicker('class')} />
              <Dropdown label="Division" value={div && `Div ${div}`} empty="Choose" disabled={!std} onPress={() => setPicker('div')} />
            </View>
            <Text style={s.label}>Sport taught</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
              {[...new Set([sport.trim(), ...SPORTS].filter(Boolean))].map((x) => (
                <Pressable key={x} onPress={() => setSport(x)} style={(p) => [s.chip, norm(sport) === norm(x) && s.chipOn, press(p)]}><Text style={[s.chipText, norm(sport) === norm(x) && { color: '#fff' }]}>{x}</Text></Pressable>
              ))}
            </ScrollView>
            <TextInput value={sport} onChangeText={setSport} placeholder="Or type the sport" placeholderTextColor={colors.iconMuted} style={s.input} />

            {std && div ? (<>
              <View style={s.listHead}>
                <Text style={s.hint}>{already ? 'Already taken today. Tap to change.' : 'Everyone is Present. Tap a student who is absent.'}</Text>
                {absent.size > 0 && <Pressable hitSlop={8} onPress={() => setAbsent(new Set())}><Text style={s.allP}>All present</Text></Pressable>}
              </View>
              <FlatList
                data={kids}
                keyExtractor={(k) => String(k.id)}
                style={{ flexGrow: 0, maxHeight: 340 }}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={s.hint}>No students in this class.</Text>}
                renderItem={({ item: k }) => {
                  const a = absent.has(k.id);
                  return (
                    <Pressable onPress={() => toggle(k.id)} style={(p) => [s.kid, a ? s.kidA : s.kidP, press(p)]}>
                      <Avatar name={k.name} size={40} />
                      <Text style={s.kidName} numberOfLines={1}>{k.name}</Text>
                      <View style={[s.pill, { backgroundColor: a ? colors.error : colors.primary }]}>
                        <Ionicons name={a ? 'close' : 'checkmark'} size={16} color="#fff" />
                        <Text style={s.pillText}>{a ? 'Absent' : 'Present'}</Text>
                      </View>
                    </Pressable>
                  );
                }}
              />
            </>) : <Text style={[s.hint, { textAlign: 'center', marginVertical: 24 }]}>Choose a class and division to see students.</Text>}

            <View style={s.footer}>
              <View style={{ flex: 1 }}>
                <Text style={s.cntBig}><Text style={{ color: colors.primary }}>{std && div ? presentCount : 0}</Text> present</Text>
                <Text style={s.cntSmall}><Text style={{ color: colors.error, fontWeight: '900' }}>{absent.size}</Text> absent · {kids.length} total</Text>
              </View>
              <Pressable disabled={saving || !kids.length} onPress={save} style={(p) => [s.save, { flex: 1.3 }, (saving || !kids.length) && { opacity: 0.5 }, press(p)]}>
                {saving ? <ActivityIndicator color="#fff" /> : (<><Ionicons name="checkmark-done" size={20} color="#fff" /><Text style={s.saveText}>Save</Text></>)}
              </Pressable>
            </View>
          </>)}
        </>)}

        {!!picker && (
          <View style={s.pickWrap}>
            <Pressable style={s.pickBack} onPress={() => setPicker(null)} />
            <View style={s.pickSheet}>
              <Text style={s.title}>{picker === 'school' ? 'Choose school' : picker === 'class' ? 'Choose class' : 'Choose division'}</Text>
              <ScrollView style={{ marginTop: 10, maxHeight: 320 }}>
                {pickerOpts.map((o) => {
                  const on = pickerCur === o;
                  return (
                    <Pressable key={String(o)} onPress={() => pick(o)} style={(p) => [s.opt, on && s.optOn, press(p)]}>
                      <Text style={[s.optText, on && { color: colors.primary }]}>{picker === 'class' ? classLabel(o) : picker === 'div' ? `Division ${o}` : o}</Text>
                      {on && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                    </Pressable>
                  );
                })}
                {!pickerOpts.length && <Text style={s.hint}>Nothing to choose here yet.</Text>}
              </ScrollView>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const s = themed(() => ({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(8,15,12,0.45)' },
  sheet: { maxHeight: '94%', backgroundColor: colors.navyLight, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12, overflow: 'hidden' },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.cardBorder, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  title: { color: colors.heading, fontSize: 20, fontWeight: '900' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 4 },
  dateBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  dateText: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  x: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  ddRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  dd: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.navy, borderWidth: 1, borderColor: colors.cardBorder },
  ddOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  ddLabel: { fontSize: 11, fontWeight: '700', color: colors.subtext, letterSpacing: 0.4, textTransform: 'uppercase' },
  ddVal: { fontSize: 15, fontWeight: '800', color: colors.heading, marginTop: 2 },
  label: { color: colors.subtext, fontSize: 12.5, fontWeight: '800', marginBottom: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.navy, borderWidth: 1, borderColor: colors.cardBorder },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.heading, fontWeight: '700', fontSize: 13 },
  input: { backgroundColor: colors.navy, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: colors.text, marginBottom: 12 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  hint: { flex: 1, color: colors.meta, fontSize: 13, fontWeight: '600' },
  allP: { color: colors.primary, fontWeight: '900', fontSize: 13 },
  kid: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, borderRadius: 16, paddingHorizontal: 12, marginBottom: 8, borderWidth: 1.5 },
  kidP: { backgroundColor: colors.primarySoft, borderColor: colors.primary + '55' },
  kidA: { backgroundColor: colors.errorBg, borderColor: colors.error },
  kidName: { flex: 1, color: colors.heading, fontSize: 15, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minWidth: 96, justifyContent: 'center' },
  pillText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  cntBig: { color: colors.heading, fontSize: 18, fontWeight: '900' },
  cntSmall: { color: colors.meta, fontSize: 13, marginTop: 2 },
  save: { height: 56, borderRadius: 999, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...shadow },
  saveText: { color: '#fff', fontSize: 17, fontWeight: '900' },
  ghost: { height: 50, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ghostText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  okIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  okTitle: { color: colors.heading, fontSize: 22, fontWeight: '900', marginTop: 14 },
  okSub: { color: colors.meta, fontSize: 14, marginTop: 4, textAlign: 'center' },
  okRow: { flexDirection: 'row', gap: 12, marginTop: 18, alignSelf: 'stretch' },
  okBox: { flex: 1, borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  okNum: { fontSize: 30, fontWeight: '900' },
  okLbl: { color: colors.subtext, fontSize: 13, fontWeight: '800', marginTop: 2 },
  okList: { color: colors.subtext, fontSize: 13, marginTop: 14, textAlign: 'center' },
  pickWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' },
  pickBack: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(8,15,12,0.35)' },
  pickSheet: { backgroundColor: colors.navyLight, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 54, borderRadius: 14, marginBottom: 6, backgroundColor: colors.navy },
  optOn: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  optText: { fontSize: 16, fontWeight: '700', color: colors.heading },
}));
