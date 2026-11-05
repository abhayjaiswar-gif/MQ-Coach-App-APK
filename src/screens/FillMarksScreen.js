import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, FlatList, ScrollView, ActivityIndicator, Alert, Animated, Linking, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getFillMarksFilters, getExamFormats, getFormatParams, getFillMarksStudents, saveFillMarks, fillMarksTemplateUrl, scanMarksSheet } from '../api';
import { Header } from '../components/ui';
import { Avatar, press, shadow } from '../components/teams';

// Port of web FillMarksPage (/exams/fill-marks) + photo autofill.
// Flow: school (auto if one) -> test -> class -> division -> term; then one card per student with big inputs.
// Scan sheet: photo of the printed template -> server reads it -> marks prefilled, unsure cells yellow. Never auto-saves.
const LAST_KEY = 'fill_marks_last';
const TERMS = ['Term 1', 'Term 2'];
const LOW = 0.75;
const sortNum = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const isYesNo = (p) => ['yes/no', 'boolean'].includes(String(p.ctype || '').toLowerCase());
const has = (v) => v !== '' && v !== null && v !== undefined;
const isHeight = (p) => { const t = (p.title || '').trim().toLowerCase(); return t.includes('height') || t.includes('hight') || t === 'ht'; };
const isWeight = (p) => { const t = (p.title || '').trim().toLowerCase(); return t.includes('weight') || t.includes('weth') || t.includes('weit') || t === 'wt'; };
const isBmi = (p) => { const t = (p.title || '').trim().toLowerCase(); return t.includes('bmi') || t.includes('body mass index'); };
const classLabel = (g) => (/^\d+$/.test(String(g)) ? `Class ${g}` : `Class ${g}`);

// Same range logic as the web: highest matching std, gender-specific first, else "All".
function rangeFor(ranges, st, pid) {
  const all = ranges.filter((r) => r.parameter_id == pid);
  if (!all.length) return null;
  const top = [...all].sort((a, b) => (b.std || 0) - (a.std || 0))[0].std;
  const same = all.filter((r) => r.std === top);
  const g = String(st?.gender || '').trim().toLowerCase();
  const gm = (r) => String(r.gender || 'All').trim().toLowerCase();
  let pick = same.filter((r) => (g === 'male' || g === 'boy' ? ['male', 'boy'].includes(gm(r)) : g === 'female' || g === 'girl' ? ['female', 'girl'].includes(gm(r)) : false));
  if (!pick.length) pick = same.filter((r) => gm(r) === 'all');
  if (!pick.length) pick = same;
  const mins = pick.map((r) => parseFloat(r.min_score)).filter((v) => !isNaN(v));
  const maxs = pick.map((r) => parseFloat(r.max_score)).filter((v) => !isNaN(v));
  return mins.length && maxs.length ? { min: Math.min(...mins), max: Math.max(...maxs) } : null;
}

export default function FillMarksScreen({ navigation }) {
  const { user } = useAuth();
  const [schools, setSchools] = useState([]);
  const [stds, setStds] = useState([]);
  const [divs, setDivs] = useState([]);
  const [formats, setFormats] = useState([]);
  const [school, setSchool] = useState(null);
  const [format, setFormat] = useState(null);
  const [std, setStd] = useState(null);
  const [div, setDiv] = useState(null);
  const [term, setTerm] = useState('Term 1');
  const [params, setParams] = useState([]);
  const [students, setStudents] = useState([]);
  const [ranges, setRanges] = useState([]);
  const [marks, setMarks] = useState({});
  const [flags, setFlags] = useState({});
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(null);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState(null);
  const [scanMenu, setScanMenu] = useState(false);
  const last = useRef({});
  const toast = useRef(new Animated.Value(0)).current;
  const [toastText, setToastText] = useState('');

  const flash = (t) => { setToastText(t); Animated.sequence([Animated.timing(toast, { toValue: 1, duration: 200, useNativeDriver: true }), Animated.delay(2200), Animated.timing(toast, { toValue: 0, duration: 250, useNativeDriver: true })]).start(); };

  // 1. Schools (+ last used choices)
  useEffect(() => { (async () => {
    try {
      const raw = await SecureStore.getItemAsync(LAST_KEY).catch(() => null);
      try { last.current = raw ? JSON.parse(raw) : {}; } catch { last.current = {}; }
      if (last.current.term) setTerm(last.current.term);
      const f = await getFillMarksFilters(user);
      setSchools(f.schools || []);
      const sc = (f.schools || []).find((x) => x.id === last.current.school) || (f.schools || [])[0];
      if (sc) setSchool(sc.id);
    } catch (e) { Alert.alert('Could not load', e.message); }
    finally { setBooting(false); }
  })(); }, []);

  // 2. Per school: classes, divisions, tests
  useEffect(() => {
    if (!school) return;
    let live = true;
    (async () => {
      try {
        const [f, fm] = await Promise.all([getFillMarksFilters(user, school), getExamFormats(user, school)]);
        if (!live) return;
        const sList = (f.standards || []).map((x) => x.name || x.id).sort(sortNum);
        setStds(sList); setDivs([...(f.divisions || [])].sort(sortNum)); setFormats(fm);
        const L = last.current;
        setFormat(fm.find((x) => x.id === L.format)?.id ?? (fm.length === 1 ? fm[0].id : null));
        setStd(sList.includes(L.std) ? L.std : null);
        setDiv((f.divisions || []).includes(L.div) ? L.div : (f.divisions || []).length === 1 ? f.divisions[0] : null);
      } catch (e) { Alert.alert('Could not load', e.message); }
    })();
    return () => { live = false; };
  }, [school]);

  const ready = school && format && std && div && term;
  const q = ready ? { school_id: school, std, division: div, format_id: format, term } : null;

  // 3. Parameters + students + existing marks
  useEffect(() => {
    setStudents([]); setMarks({}); setFlags({}); setScanInfo(null); setDirty(false);
    if (!ready) return;
    let live = true;
    setLoading(true);
    (async () => {
      try {
        const [p, r] = await Promise.all([getFormatParams(format), getFillMarksStudents(q)]);
        if (!live) return;
        const m = {};
        r.students.forEach((st) => {
          const mk = { ...(st.marks || {}) };
          p.forEach((x) => {
            if (isYesNo(x)) { const v = mk[x.id]; mk[x.id] = v === '1.00' || v == 1 ? 'Yes' : v === '0.00' || v === 0 || v === '0' ? 'No' : v == null ? 'Yes' : v; }
            else if (has(mk[x.id])) mk[x.id] = String(parseFloat(mk[x.id]));
          });
          m[st.id] = mk;
        });
        setParams(p); setStudents([...r.students].sort((a, b) => (a.name || '').localeCompare(b.name || ''))); setRanges(r.ranges); setMarks(m);
        last.current = { school, format, std, div, term };
        SecureStore.setItemAsync(LAST_KEY, JSON.stringify(last.current)).catch(() => {});
      } catch (e) { Alert.alert('Could not load students', e.message); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [school, format, std, div, term]);

  const bmiP = params.find(isBmi), hP = params.find(isHeight), wP = params.find(isWeight);
  const setMark = (sid, pid, v) => {
    setDirty(true);
    setFlags((f) => { if (!f[`${sid}:${pid}`]) return f; const n = { ...f }; delete n[`${sid}:${pid}`]; return n; });
    setMarks((m) => {
      const row = { ...(m[sid] || {}), [pid]: v };
      if (bmiP && hP && wP && (pid === hP.id || pid === wP.id)) {
        const h = parseFloat(row[hP.id]), w = parseFloat(row[wP.id]);
        if (h > 0 && w > 0) { const hm = h > 3 ? h / 100 : h; row[bmiP.id] = String(parseFloat((w / (hm * hm)).toFixed(2))); }
      }
      return { ...m, [sid]: row };
    });
  };

  const numParams = params.filter((p) => !isYesNo(p));
  const filled = students.filter((st) => numParams.length ? numParams.some((p) => has(marks[st.id]?.[p.id])) : true).length;
  const flagCount = Object.keys(flags).length;

  const save = async () => {
    const arr = [];
    students.forEach((st) => params.forEach((p) => {
      const v = marks[st.id]?.[p.id];
      if (isYesNo(p)) { arr.push({ student_id: st.id, parameter_id: p.id, value: has(v) ? String(v) : null }); return; }
      if (!has(v)) return;
      const n = Number(String(v).replace(',', '.'));
      if (Number.isFinite(n)) arr.push({ student_id: st.id, parameter_id: p.id, value: String(n) });
    }));
    if (!arr.length) return Alert.alert('Nothing to save', 'Enter at least one mark first.');
    const go = async () => {
      setSaving(true);
      try { await saveFillMarks({ ...q, marks: arr }); setDirty(false); setFlags({}); setScanInfo(null); flash(`Saved marks for ${filled} student${filled === 1 ? '' : 's'}`); }
      catch (e) { Alert.alert('Could not save', e.message); }
      finally { setSaving(false); }
    };
    if (flagCount) Alert.alert('Some marks need checking', `${flagCount} yellow value${flagCount === 1 ? '' : 's'} from the photo ${flagCount === 1 ? 'was' : 'were'} not read clearly. Save anyway?`, [{ text: 'Review', style: 'cancel' }, { text: 'Save', onPress: go }]);
    else go();
  };

  const scan = async (camera) => {
    setScanMenu(false);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', camera ? 'Allow camera access to take a photo of the sheet.' : 'Allow photo access to pick the sheet.');
    const opts = { mediaTypes: ['images'], quality: 0.85 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets?.length) return;
    setScanning(true);
    try {
      const d = await scanMarksSheet(q, r.assets[0]);
      const ids = new Set(students.map((x) => x.id));
      const fl = {}; let n = 0;
      setMarks((m) => {
        const nm = { ...m };
        (d.marks || []).forEach((x) => {
          if (!ids.has(x.student_id)) return;
          nm[x.student_id] = { ...(nm[x.student_id] || {}), [x.parameter_id]: String(x.value) };
          n++;
          const st = students.find((s) => s.id === x.student_id);
          const rg = rangeFor(ranges, st, x.parameter_id);
          const out = rg && !isNaN(parseFloat(x.value)) && (parseFloat(x.value) < rg.min || parseFloat(x.value) > rg.max);
          if ((x.confidence ?? 0) < LOW || out) fl[`${x.student_id}:${x.parameter_id}`] = true;
        });
        return nm;
      });
      setFlags(fl); setDirty(true);
      setScanInfo({ filled: n, unsure: Object.keys(fl).length, unmatched: d.unmatched || [], engine: d.engine });
      if (!n) Alert.alert('Nothing read', 'No marks could be read from this photo. Try a straight, bright photo of the printed sheet with all rows visible.');
    } catch (e) { Alert.alert('Could not read the photo', e.message); }
    finally { setScanning(false); }
  };

  const fmtName = (id) => formats.find((x) => x.id === id)?.test_name;
  const schoolName = (id) => schools.find((x) => x.id === id)?.name;
  const opts = picker === 'school' ? schools.map((x) => [x.id, x.name]) : picker === 'format' ? formats.map((x) => [x.id, x.test_name]) : picker === 'class' ? stds.map((x) => [x, classLabel(x)]) : picker === 'div' ? divs.map((x) => [x, `Division ${x}`]) : [];
  const cur = picker === 'school' ? school : picker === 'format' ? format : picker === 'class' ? std : div;
  const pick = (v) => {
    const apply = () => {
      if (picker === 'school') { setSchool(v); setFormat(null); setStd(null); setDiv(null); }
      else if (picker === 'format') setFormat(v);
      else if (picker === 'class') { setStd(v); }
      else setDiv(v);
      setPicker(null);
    };
    if (dirty && v !== cur) Alert.alert('Discard changes?', 'You have marks that are not saved yet.', [{ text: 'Keep editing', style: 'cancel', onPress: () => setPicker(null) }, { text: 'Discard', style: 'destructive', onPress: apply }]);
    else apply();
  };

  const DD = ({ k, label, value, empty, disabled }) => (
    <Pressable disabled={disabled} onPress={() => setPicker(k)} style={(p) => [s.dd, value && s.ddOn, disabled && { opacity: 0.5 }, press(p)]}>
      <View style={{ flex: 1 }}><Text style={s.ddLabel}>{label}</Text><Text style={[s.ddVal, !value && { color: colors.subtext }]} numberOfLines={1}>{value || empty}</Text></View>
      <Ionicons name="chevron-down" size={20} color={value ? colors.primary : colors.iconMuted} />
    </Pressable>
  );

  const header = (
    <View>
      {schools.length > 1 && <View style={{ marginBottom: 10 }}><DD k="school" label="School" value={schoolName(school)} empty="Choose school" /></View>}
      <View style={{ marginBottom: 10 }}><DD k="format" label="Test" value={fmtName(format)} empty={formats.length ? 'Choose test' : 'No tests for this school'} disabled={!formats.length} /></View>
      <View style={s.ddRow}>
        <DD k="class" label="Class" value={std && classLabel(std)} empty="Choose" />
        <DD k="div" label="Division" value={div && `Div ${div}`} empty="Choose" />
      </View>
      <View style={s.seg}>
        {TERMS.map((t) => <Pressable key={t} onPress={() => (dirty && t !== term ? Alert.alert('Discard changes?', 'You have marks that are not saved yet.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => setTerm(t) }]) : setTerm(t))} style={[s.segBtn, term === t && s.segOn]}><Text style={[s.segText, term === t && { color: '#fff' }]}>{t}</Text></Pressable>)}
      </View>
      {ready && students.length > 0 && (
        <View style={s.tools}>
          <Pressable onPress={() => Linking.openURL(fillMarksTemplateUrl(q))} style={(p) => [s.tool, press(p)]}>
            <Ionicons name="print-outline" size={22} color={colors.primary} /><View style={{ flex: 1 }}><Text style={s.toolTitle}>Print sheet</Text><Text style={s.toolSub}>Blank sheet with names</Text></View>
          </Pressable>
          <Pressable disabled={scanning} onPress={() => setScanMenu(true)} style={(p) => [s.tool, s.toolMain, press(p)]}>
            {scanning ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="camera-document" size={24} color="#fff" />}
            <View style={{ flex: 1 }}><Text style={[s.toolTitle, { color: '#fff' }]}>{scanning ? 'Reading...' : 'Scan sheet'}</Text><Text style={[s.toolSub, { color: '#E8F5EC' }]}>Fill marks from photo</Text></View>
          </Pressable>
        </View>
      )}
      {!!scanInfo && (
        <View style={[s.banner, scanInfo.unsure ? s.bannerWarn : null]}>
          <Ionicons name={scanInfo.unsure ? 'alert-circle' : 'checkmark-circle'} size={20} color={scanInfo.unsure ? '#B45309' : colors.primary} />
          <Text style={s.bannerText}>
            {scanInfo.filled} mark{scanInfo.filled === 1 ? '' : 's'} filled from the photo.{scanInfo.unsure ? ` Check the ${scanInfo.unsure} yellow box${scanInfo.unsure === 1 ? '' : 'es'}.` : ''}{scanInfo.unmatched.length ? ` ${scanInfo.unmatched.length} row${scanInfo.unmatched.length === 1 ? '' : 's'} could not be matched to a student.` : ''} Nothing is saved until you tap Save.
          </Text>
        </View>
      )}
      {ready && !loading && students.length > 0 && <Text style={s.count}>{students.length} students · {params.length} tests each</Text>}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.navy }}>
      <Header title="Fill Marks" subtitle={fmtName(format) || 'Exams'} onBack={() => {
        if (dirty) Alert.alert('Leave without saving?', 'Your unsaved marks will be lost.', [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() }]);
        else navigation.goBack();
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {booting ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={ready && !loading ? students : []}
            keyExtractor={(x) => String(x.id)}
            contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={header}
            removeClippedSubviews={false}
            ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : (
              <View style={s.empty}><Ionicons name={ready ? 'people-outline' : 'options-outline'} size={34} color={colors.iconMuted} /><Text style={s.emptyText}>{ready ? 'No students in this class and division.' : 'Choose the test, class and division to start.'}</Text></View>
            )}
            renderItem={({ item: st, index }) => (
              <View style={s.card}>
                <View style={s.cardHead}>
                  <Text style={s.num}>{index + 1}</Text>
                  <Avatar name={st.name} size={38} />
                  <View style={{ flex: 1 }}><Text style={s.name} numberOfLines={1}>{st.name}</Text><Text style={s.meta}>{st.mq_id || 'MQ-PEND'}{st.gender ? ` · ${st.gender}` : ''}</Text></View>
                </View>
                {params.map((p) => {
                  const v = marks[st.id]?.[p.id];
                  const flag = flags[`${st.id}:${p.id}`];
                  if (isYesNo(p)) return (
                    <View key={p.id} style={[s.prow, flag && s.flag]}>
                      <View style={{ flex: 1 }}><Text style={s.pTitle}>{p.title}</Text>{!!p.test_display && <Text style={s.pSub}>{p.test_display}</Text>}</View>
                      {['Yes', 'No'].map((o) => <Pressable key={o} onPress={() => setMark(st.id, p.id, o)} style={[s.yn, v === o && (o === 'Yes' ? s.ynYes : s.ynNo)]}><Text style={[s.ynText, v === o && { color: '#fff' }]}>{o}</Text></Pressable>)}
                    </View>
                  );
                  const rg = rangeFor(ranges, st, p.id);
                  const n = parseFloat(v);
                  const bad = has(v) && (isNaN(n) || (rg && (n < rg.min || n > rg.max)));
                  const auto = bmiP && hP && wP && p.id === bmiP.id;
                  return (
                    <View key={p.id} style={[s.prow, flag && s.flag]}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.pTitle}>{p.title}</Text>
                        <Text style={s.pSub} numberOfLines={1}>{[p.test_display, rg && `${rg.min} – ${rg.max}`, auto && 'auto'].filter(Boolean).join(' · ')}</Text>
                      </View>
                      <TextInput value={has(v) ? String(v) : ''} editable={!auto} onChangeText={(t) => setMark(st.id, p.id, t.replace(',', '.').replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="–" placeholderTextColor={colors.iconMuted}
                        style={[s.inp, bad && s.inpBad, flag && s.inpFlag, auto && { opacity: 0.7 }]} maxLength={7} selectTextOnFocus />
                    </View>
                  );
                })}
              </View>
            )}
          />
        )}
        {ready && students.length > 0 && (
          <View style={s.footer}>
            <View style={{ flex: 1 }}>
              <Text style={s.fBig}>{filled}<Text style={s.fSmall}> / {students.length} filled</Text></Text>
              <Text style={[s.fSmall, flagCount && { color: '#B45309', fontWeight: '800' }]}>{flagCount ? `${flagCount} to check` : dirty ? 'Unsaved changes' : 'All saved'}</Text>
            </View>
            <Pressable disabled={saving || !dirty} onPress={save} style={(p) => [s.save, (saving || !dirty) && { opacity: 0.5 }, press(p)]}>
              {saving ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark-done" size={20} color="#fff" /><Text style={s.saveText}>Save marks</Text></>}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      <Animated.View pointerEvents="none" style={[s.toast, { opacity: toast, transform: [{ translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
        <Ionicons name="checkmark-circle" size={20} color="#fff" /><Text style={s.toastText}>{toastText}</Text>
      </Animated.View>

      <Modal visible={!!picker || scanMenu} transparent animationType="slide" onRequestClose={() => { setPicker(null); setScanMenu(false); }}>
        <Pressable style={s.backdrop} onPress={() => { setPicker(null); setScanMenu(false); }} />
        <View style={s.sheet}>
          <View style={s.handle} />
          {scanMenu ? (<>
            <Text style={s.sheetTitle}>Scan marks sheet</Text>
            <Text style={s.sheetSub}>Use the printed sheet. Keep it flat, bright and fully in the photo.</Text>
            <Pressable onPress={() => scan(true)} style={(p) => [s.opt, press(p)]}><Ionicons name="camera" size={22} color={colors.primary} /><Text style={s.optText}>Take photo</Text></Pressable>
            <Pressable onPress={() => scan(false)} style={(p) => [s.opt, press(p)]}><Ionicons name="images" size={22} color={colors.primary} /><Text style={s.optText}>Choose from gallery</Text></Pressable>
          </>) : (<>
            <Text style={s.sheetTitle}>{{ school: 'Choose school', format: 'Choose test', class: 'Choose class', div: 'Choose division' }[picker]}</Text>
            <ScrollView style={{ maxHeight: 380, marginTop: 10 }}>
              {opts.map(([v, l]) => (
                <Pressable key={String(v)} onPress={() => pick(v)} style={(p) => [s.opt, cur === v && s.optOn, press(p)]}>
                  <Text style={[s.optText, { flex: 1 }, cur === v && { color: colors.primary }]}>{l}</Text>
                  {cur === v && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                </Pressable>
              ))}
              {!opts.length && <Text style={s.sheetSub}>Nothing to choose here yet.</Text>}
            </ScrollView>
          </>)}
        </View>
      </Modal>
    </View>
  );
}

const s = themed(() => ({
  ddRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  dd: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder, ...shadow },
  ddOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  ddLabel: { fontSize: 11, fontWeight: '700', color: colors.subtext, letterSpacing: 0.4, textTransform: 'uppercase' },
  ddVal: { fontSize: 15, fontWeight: '800', color: colors.heading, marginTop: 2 },
  seg: { flexDirection: 'row', backgroundColor: colors.navyLight, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: colors.cardBorder, marginBottom: 12 },
  segBtn: { flex: 1, height: 42, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.primary },
  segText: { color: colors.heading, fontWeight: '800', fontSize: 14 },
  tools: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tool: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder, minHeight: 62 },
  toolMain: { backgroundColor: colors.primary, borderColor: colors.primary },
  toolTitle: { color: colors.heading, fontSize: 14, fontWeight: '900' },
  toolSub: { color: colors.meta, fontSize: 11.5, marginTop: 1 },
  banner: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.primarySoft, marginBottom: 12, alignItems: 'flex-start' },
  bannerWarn: { backgroundColor: 'rgba(250,204,21,0.18)' },
  bannerText: { flex: 1, color: colors.heading, fontSize: 13, lineHeight: 18 },
  count: { color: colors.meta, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginLeft: 2 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 36 },
  emptyText: { color: colors.meta, fontSize: 14, textAlign: 'center' },
  card: { backgroundColor: colors.navyLight, borderRadius: 18, padding: 12, marginBottom: 12, ...shadow },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  num: { width: 22, color: colors.meta, fontWeight: '900', fontSize: 13, textAlign: 'center' },
  name: { color: colors.heading, fontSize: 15.5, fontWeight: '900' },
  meta: { color: colors.meta, fontSize: 12, marginTop: 1 },
  prow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: colors.cardBorder, borderRadius: 10 },
  flag: { backgroundColor: 'rgba(250,204,21,0.16)' },
  pTitle: { color: colors.heading, fontSize: 14, fontWeight: '700' },
  pSub: { color: colors.meta, fontSize: 11.5, marginTop: 1 },
  inp: { width: 92, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.cardBorder, backgroundColor: colors.navy, color: colors.heading, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  inpBad: { borderColor: colors.error, color: colors.error },
  inpFlag: { borderColor: '#EAB308', backgroundColor: 'rgba(250,204,21,0.22)' },
  yn: { width: 62, height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy },
  ynYes: { backgroundColor: colors.primary, borderColor: colors.primary },
  ynNo: { backgroundColor: colors.error, borderColor: colors.error },
  ynText: { color: colors.heading, fontWeight: '900', fontSize: 14 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.navyLight, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  fBig: { color: colors.primary, fontSize: 20, fontWeight: '900' },
  fSmall: { color: colors.meta, fontSize: 13, fontWeight: '600' },
  save: { flex: 1.2, height: 54, borderRadius: 999, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  toast: { position: 'absolute', left: 20, right: 20, bottom: 90, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center' },
  toastText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(8,15,12,0.45)' },
  sheet: { backgroundColor: colors.navyLight, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingTop: 10, paddingBottom: 28 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.cardBorder, marginBottom: 14 },
  sheetTitle: { color: colors.heading, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.meta, fontSize: 13, marginTop: 4, marginBottom: 12 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 56, borderRadius: 14, marginBottom: 8, backgroundColor: colors.navy },
  optOn: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  optText: { fontSize: 16, fontWeight: '700', color: colors.heading },
}));
