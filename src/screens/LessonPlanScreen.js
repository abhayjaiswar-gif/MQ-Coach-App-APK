import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Modal, Image, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { checkLessonDone, getLessonHistory, getSchoolDivisions, saveLessonStatus, fileUrl } from '../api';
import { Header, Loading, ui, formatDate } from '../components/ui';

// Lesson plan detail + "Mark Lesson" (web: currentLesson panel, check-done, lesson-history, save-lp-status)
const SECTIONS = [
  ['objective', 'Objective', 'flag'], ['warm_up', 'Warm Up', 'flame'], ['skill_implementation', 'Skill Implementation', 'football'],
  ['teaching_aids', 'Teaching Aids', 'construct'], ['cool_down', 'Cool Down', 'snow'], ['summarization', 'Summarization', 'list'], ['life_skill', 'Life Skill', 'heart'],
];
const STATUSES = ['Complete', 'Partially Complete', 'Pending'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = () => { const d = new Date(); return `${MONTHS[d.getMonth()]},${d.getFullYear()}`; };
const weekNo = () => { const d = new Date(); const s = new Date(d.getFullYear(), d.getMonth(), 1); return `Week ${Math.ceil((d.getDate() + s.getDay()) / 7)}`; };
const statusColor = (s) => { const x = String(s || '').toLowerCase(); return x === 'complete' || x === 'done' ? colors.primary : x.startsWith('partial') ? '#D97706' : colors.meta; };

function Chip({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export default function LessonPlanScreen({ navigation, route }) {
  const { user } = useAuth();
  const { plans = [], program, school, sport, grade } = route.params;
  const [index, setIndex] = useState(route.params.index || 0);
  const plan = plans[index] || route.params.plan;
  const lpId = plan.unique_id || plan.lp_unique_id;
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [divisions, setDivisions] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ status: 'Complete', remark: '', divs: [], week_no: weekNo(), month_year: monthYear() });
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);

  const scopeGrade = grade ? String(grade) : '';
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, h] = await Promise.all([
        checkLessonDone({ lpId, schoolId: school.id, grade: scopeGrade }),
        getLessonHistory({ lpId, schoolId: school.id, grade: scopeGrade }),
      ]);
      setStatus(c); setHistory(h);
    } catch (e) { setStatus(null); }
    finally { setLoading(false); }
  }, [lpId, school?.id, scopeGrade]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getSchoolDivisions(school.id, program === 'inschool' ? scopeGrade : undefined).then(setDivisions).catch(() => setDivisions([])); }, [school?.id]);

  const doneLabel = status?.isDone ? 'Completed' : status?.lessonStatus || 'Not started';
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 0.7 });
    if (!r.canceled) setPhotos((p) => [...p, ...r.assets].slice(0, 10));
  };
  const toggleDiv = (d) => setForm((f) => ({ ...f, divs: f.divs.includes(d) ? f.divs.filter((x) => x !== d) : [...f.divs, d] }));

  const submit = async () => {
    if (divisions.length && !form.divs.length) return Alert.alert('Select division', 'Please select at least one division.');
    if ((status?.isDone || form.status !== 'Complete') && !form.remark.trim()) return Alert.alert('Remark needed', 'Please add a remark / reason.');
    setSaving(true);
    try {
      await saveLessonStatus(user, {
        lp_no: plan.lp_no, lp_unique_id: lpId, sport: plan.sport || sport, grade: scopeGrade || plan.grade, status: form.status,
        remark: form.remark, school_id: school.id, divisions: form.divs.join(','), week_no: form.week_no, month_year: form.month_year,
      }, photos);
      setOpen(false); setPhotos([]); setForm((f) => ({ ...f, remark: '' }));
      Alert.alert('Saved', 'Lesson status updated successfully.');
      load();
    } catch (e) { Alert.alert('Could not save', e.message); }
    finally { setSaving(false); }
  };

  return (
    <View style={ui.screen}>
      <Header title={`LP ${plan.lp_no}`} subtitle={[sport || plan.sport, plan.grade].filter(Boolean).join(' | ')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={[ui.card, styles.hero]}>
          <Ionicons name="football" size={120} color="rgba(255,255,255,0.1)" style={{ position: 'absolute', right: -18, bottom: -24 }} />
          <Text style={styles.heroSkill}>{plan.skill || 'Lesson Plan'}</Text>
          {!!plan.sub_skill && <Text style={styles.heroSub}>{plan.sub_skill}</Text>}
          <View style={styles.statusRow}>
            {loading ? <Text style={styles.heroMeta}>Checking status...</Text> : (
              <View style={[styles.statusPill, { backgroundColor: '#ffffff26' }]}>
                <Ionicons name={status?.isDone ? 'checkmark-circle' : 'time'} size={14} color="#fff" />
                <Text style={styles.statusText}>{doneLabel}</Text>
              </View>
            )}
            <Text style={styles.heroMeta}>{school?.name}</Text>
          </View>
        </View>

        {SECTIONS.filter(([k]) => plan[k] && String(plan[k]).trim()).map(([k, label, icon]) => (
          <View key={k} style={ui.card}>
            <View style={styles.secHead}><View style={styles.secIcon}><Ionicons name={icon} size={16} color={colors.primary} /></View><Text style={ui.cardTitle}>{label}</Text></View>
            <Text style={styles.body}>{String(plan[k]).trim()}</Text>
          </View>
        ))}
        {!!plan.picture && /^(https?:|\/|uploads)/.test(plan.picture) && <Image source={{ uri: fileUrl(plan.picture) }} style={styles.pic} resizeMode="cover" />}

        <Text style={ui.section}>History</Text>
        {history.length ? history.map((h) => (
          <View key={h.id} style={[ui.card, { flexDirection: 'row', gap: 12 }]}>
            <View style={[styles.hDot, { backgroundColor: statusColor(h.status) }]} />
            <View style={{ flex: 1 }}>
              <Text style={[ui.cardTitle, { fontSize: 14, color: statusColor(h.status) }]}>{h.status}</Text>
              {!!h.remark && <Text style={ui.cardText}>{h.remark}</Text>}
              <Text style={ui.meta}>{[formatDate(h.created_at), h.divisions && `Div ${h.divisions}`, h.grade].filter(Boolean).join(' | ')}</Text>
              {!!h.evidence_photo && (
                <ScrollView horizontal style={{ marginTop: 8 }}>{String(h.evidence_photo).split(',').filter(Boolean).map((u) => <Image key={u} source={{ uri: fileUrl(u) }} style={styles.thumb} />)}</ScrollView>
              )}
            </View>
          </View>
        )) : <Text style={[ui.meta, { paddingHorizontal: 20 }]}>No sessions marked for this lesson yet.</Text>}

        {plans.length > 1 && (
          <View style={styles.nav}>
            <Pressable disabled={index === 0} onPress={() => setIndex(index - 1)} style={[styles.navBtn, index === 0 && { opacity: 0.4 }]}><Ionicons name="arrow-back" size={16} color={colors.primary} /><Text style={styles.navText}>Previous</Text></Pressable>
            <Text style={ui.meta}>{index + 1} / {plans.length}</Text>
            <Pressable disabled={index >= plans.length - 1} onPress={() => setIndex(index + 1)} style={[styles.navBtn, index >= plans.length - 1 && { opacity: 0.4 }]}><Text style={styles.navText}>Next</Text><Ionicons name="arrow-forward" size={16} color={colors.primary} /></Pressable>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[ui.btn, { flexDirection: 'row', justifyContent: 'center', gap: 8 }]} onPress={() => setOpen(true)}>
          <Ionicons name="checkmark-done" size={18} color="#fff" /><Text style={ui.btnText}>{status?.isDone ? 'Update Lesson Status' : 'Mark Lesson'}</Text>
        </Pressable>
      </View>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}><Text style={ui.cardTitle}>Mark LP {plan.lp_no}</Text><Pressable onPress={() => setOpen(false)}><Ionicons name="close" size={24} color={colors.heading} /></Pressable></View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={ui.label}>Status</Text>
              <View style={styles.wrap}>{STATUSES.map((s) => <Chip key={s} label={s} active={form.status === s} onPress={() => setForm({ ...form, status: s })} />)}</View>
              {divisions.length > 0 && (<>
                <Text style={ui.label}>Divisions</Text>
                <View style={styles.wrap}>{divisions.map((d) => <Chip key={d} label={d} active={form.divs.includes(d)} onPress={() => toggleDiv(d)} />)}</View>
              </>)}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Text style={ui.label}>Week</Text><TextInput style={ui.input} value={form.week_no} onChangeText={(t) => setForm({ ...form, week_no: t })} /></View>
                <View style={{ flex: 1 }}><Text style={ui.label}>Month</Text><TextInput style={ui.input} value={form.month_year} onChangeText={(t) => setForm({ ...form, month_year: t })} /></View>
              </View>
              <Text style={ui.label}>Remark {(status?.isDone || form.status !== 'Complete') ? '(required)' : '(optional)'}</Text>
              <TextInput style={[ui.input, { minHeight: 80, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.cardBorder }]} multiline value={form.remark} onChangeText={(t) => setForm({ ...form, remark: t })} placeholder="How did the session go?" placeholderTextColor={colors.iconMuted} />
              <Text style={ui.label}>Evidence photos</Text>
              <ScrollView horizontal style={{ marginBottom: 16 }}>
                <Pressable onPress={pick} style={styles.add}><Ionicons name="camera" size={22} color={colors.primary} /><Text style={styles.addText}>Add</Text></Pressable>
                {photos.map((p, i) => (
                  <View key={p.uri}><Image source={{ uri: p.uri }} style={styles.preview} /><Pressable onPress={() => setPhotos(photos.filter((_, j) => j !== i))} style={styles.x}><Ionicons name="close" size={12} color="#fff" /></Pressable></View>
                ))}
              </ScrollView>
              <Pressable disabled={saving} onPress={submit} style={[ui.btn, saving && { opacity: 0.6 }]}><Text style={ui.btnText}>{saving ? 'Saving...' : 'Save Status'}</Text></Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = themed(() => ({
  hero: { backgroundColor: colors.primary, borderColor: colors.primary, borderRadius: 22, padding: 20, overflow: 'hidden', shadowColor: '#1E8E3E', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  heroSkill: { color: '#fff', fontSize: 22, fontWeight: '900' },
  heroSub: { color: '#E8F5EC', fontSize: 14, fontWeight: '600', marginTop: 4 },
  heroMeta: { color: '#E8F5EC', fontSize: 12, flexShrink: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  secIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  body: { color: colors.subtext, fontSize: 14, lineHeight: 21 },
  pic: { height: 200, marginHorizontal: 16, borderRadius: 18, marginBottom: 12 },
  hDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  thumb: { width: 64, height: 64, borderRadius: 10, marginRight: 6 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 10 },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 12, backgroundColor: colors.primarySoft },
  navText: { color: colors.primary, fontWeight: '700' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 26, backgroundColor: colors.navy, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.navy, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '88%' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.navyLight },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.heading, fontWeight: '700', fontSize: 13 },
  add: { width: 70, height: 70, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  preview: { width: 70, height: 70, borderRadius: 14, marginRight: 8 },
  x: { position: 'absolute', top: 3, right: 11, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 9, padding: 2 },
}));