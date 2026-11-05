import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, FlatList, ScrollView, RefreshControl, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getStudents, getSchools, createStudent, updateStudent, deleteStudent } from '../api';
import { Header, ui } from '../components/ui';
import { Avatar, EmptyState, press, shadow } from '../components/teams';

// Port of web StudentsListPage (/student): list scoped to assigned schools, search name/MQ ID,
// school / standard / division filters, add / edit / delete (hidden for principal, role 8).
const sortNum = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const isActive = (s) => s.status === 1 || s.status === '1' || s.status === 'Active';
const GENDERS = ['Male', 'Female', 'Other'];

export default function StudentListScreen({ navigation }) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const canEdit = String(user?.role_id) !== '8';
  const [list, setList] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [school, setSchool] = useState(null);
  const [std, setStd] = useState(null);
  const [div, setDiv] = useState(null);
  const [picker, setPicker] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [st, sc] = await Promise.all([getStudents(user), getSchools(user).catch(() => [])]);
      setList(st); setSchools(sc);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const scoped = useMemo(() => (school ? list.filter((s) => s.school_name === school) : list), [list, school]);
  const stds = useMemo(() => [...new Set(scoped.map((s) => s.std).filter(Boolean))].sort(sortNum), [scoped]);
  const divList = useMemo(() => [...new Set(scoped.filter((s) => !std || s.std === std).map((s) => s.division).filter(Boolean))].sort(sortNum), [scoped, std]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return scoped.filter((s) => (!t || (s.name || '').toLowerCase().includes(t) || (s.mq_id || '').toLowerCase().includes(t))
      && (!std || s.std === std) && (!div || s.division === div));
  }, [scoped, q, std, div]);
  const schoolNames = useMemo(() => [...new Set(list.map((s) => s.school_name).filter(Boolean))].sort(), [list]);
  const active = list.filter(isActive).length;

  const Chip = ({ label, on, onPress }) => <Pressable onPress={onPress} style={(p) => [s.chip, on && s.chipOn, press(p)]}><Text style={[s.chipText, on && { color: '#fff' }]}>{label}</Text></Pressable>;

  const askDelete = (st) => Alert.alert('Delete student?', `"${st.name}" will be removed permanently.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteStudent(st.id); setDetail(null); load(); } catch (e) { Alert.alert('Could not delete', e.message); } } },
  ]);

  return (
    <View style={ui.screen}>
      <Header title="Students" subtitle={`${list.length} students · ${active} active${schoolNames.length > 1 ? ` · ${schoolNames.length} schools` : ''}`} onBack={() => navigation.goBack()} />
      <FlatList
        data={loading ? [] : shown}
        keyExtractor={(x) => String(x.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View style={s.search}>
              <Ionicons name="search" size={18} color={colors.primary} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search by name or MQ ID" placeholderTextColor={colors.iconMuted} style={s.searchInput} />
              {!!q && <Pressable onPress={() => setQ('')}><Ionicons name="close-circle" size={18} color={colors.iconMuted} /></Pressable>}
            </View>
            {schoolNames.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
                {[null, ...schoolNames].map((n) => <Chip key={String(n)} label={n || 'All schools'} on={school === n} onPress={() => { setSchool(n); setStd(null); setDiv(null); }} />)}
              </ScrollView>
            )}
            <View style={s.ddRow}>
              {[['Class', 'class', std, (g) => (/^\d+$/.test(g) ? `Class ${g}` : g), 'All classes'], ['Division', 'div', div, (d) => `Div ${d}`, 'All divisions']].map(([label, key, val, fmt, all]) => (
                <Pressable key={key} onPress={() => setPicker(key)} style={(p) => [s.dd, val && s.ddOn, press(p)]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.ddLabel}>{label}</Text>
                    <Text style={[s.ddVal, !val && { color: colors.subtext }]} numberOfLines={1}>{val ? fmt(val) : all}</Text>
                  </View>
                  <Ionicons name="chevron-down" size={18} color={val ? colors.primary : colors.iconMuted} />
                </Pressable>
              ))}
            </View>
            {!loading && !error && <Text style={s.count}>{shown.length} of {list.length} shown</Text>}
          </View>
        }
        ListEmptyComponent={loading ? <EmptyState icon="timer-sand" text="Loading students..." />
          : error ? <EmptyState icon="wifi-off" title="Couldn't load students" text={error} action="Try again" onAction={() => { setLoading(true); load(); }} />
          : <EmptyState icon="account-search-outline" title={list.length ? 'No matches' : 'No students yet'} text={list.length ? 'Try another name, class or division.' : 'Students of your schools will show here.'} />}
        renderItem={({ item: st }) => (
          <Pressable onPress={() => setDetail(st)} style={(p) => [s.card, press(p)]}>
            <Avatar name={st.name} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>{st.name}</Text>
              <Text style={s.meta} numberOfLines={1}>{[st.std && `Class ${st.std}${st.division ? `-${st.division}` : ''}`, st.school_name].filter(Boolean).join(' · ')}</Text>
              <View style={s.tags}>
                <View style={s.tag}><Text style={s.tagText}>#{st.mq_id || 'MQ-PEND'}</Text></View>
                {!!st.gender && st.gender !== 'TBD' && <View style={[s.tag, { backgroundColor: colors.accentBlue }]}><Text style={[s.tagText, { color: '#2563EB' }]}>{st.gender}</Text></View>}
                {!isActive(st) && <View style={[s.tag, { backgroundColor: colors.errorBg }]}><Text style={[s.tagText, { color: colors.error }]}>Inactive</Text></View>}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.iconMuted} />
          </Pressable>
        )}
      />
      {canEdit && (
        <Pressable onPress={() => setForm({ name: '', gender: '', school_name: schools.length === 1 ? schools[0].name : '', standard: '', division: '', gr_number: '', mq_id: '' })} style={(p) => [s.fab, { bottom: 24 }, press(p)]}>
          <Ionicons name="person-add" size={18} color="#fff" /><Text style={s.fabText}>Add student</Text>
        </Pressable>
      )}

      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <Pressable style={s.backdrop} onPress={() => setDetail(null)} />
        {!!detail && (
          <View style={[s.sheet, { paddingBottom: 20 + insets.bottom }]}>
            <View style={s.handle} />
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <Avatar name={detail.name} size={68} />
              <Text style={s.dName}>{detail.name}</Text>
              <View style={[s.tag, { marginTop: 6, backgroundColor: isActive(detail) ? colors.primarySoft : colors.errorBg }]}><Text style={[s.tagText, { color: isActive(detail) ? colors.primary : colors.error }]}>{isActive(detail) ? 'Active' : 'Inactive'}</Text></View>
            </View>
            {[['Student ID', detail.mq_id || 'MQ-PEND', 'id-card'], ['School', detail.school_name || 'Unassigned', 'business'], ['Standard', detail.std || '-', 'school'], ['Division', detail.division || '-', 'grid'], ['Gender', detail.gender || '-', 'person'], ['GR / Roll no.', detail.roll_number || '-', 'list']].map(([k, v, i]) => (
              <View key={k} style={s.field}><View style={s.fIcon}><Ionicons name={i} size={15} color={colors.primary} /></View><Text style={s.fKey}>{k}</Text><Text style={s.fVal} numberOfLines={1}>{v}</Text></View>
            ))}
            {canEdit && (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <Pressable onPress={() => askDelete(detail)} style={(p) => [s.del, press(p)]}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
                <Pressable onPress={() => { const d = detail; setDetail(null); setForm({ id: d.id, name: d.name || '', gender: d.gender || '', school_name: d.school_name || '', standard: d.std || '', division: d.division || '', gr_number: d.roll_number || '', mq_id: d.mq_id || '', status: isActive(d) ? 'Active' : 'Inactive' }); }} style={(p) => [s.cta, { flex: 1 }, press(p)]}>
                  <Ionicons name="create-outline" size={18} color="#fff" /><Text style={s.ctaText}>Edit student</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </Modal>

      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={s.backdrop} onPress={() => setPicker(null)} />
        {!!picker && (() => {
          const isC = picker === 'class';
          const opts = [null, ...(isC ? stds : divList)];
          const cur = isC ? std : div;
          const pick = (v) => { if (isC) { setStd(v); setDiv(null); } else setDiv(v); setPicker(null); };
          return (
            <View style={[s.sheet, { maxHeight: '60%', paddingBottom: 16 + insets.bottom }]}>
              <View style={s.handle} />
              <Text style={s.formTitle}>{isC ? 'Select class' : 'Select division'}</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 10 }}>
                {opts.map((o) => {
                  const on = cur === o;
                  const label = o == null ? (isC ? 'All classes' : 'All divisions') : isC ? (/^\d+$/.test(o) ? `Class ${o}` : o) : `Division ${o}`;
                  return (
                    <Pressable key={String(o)} onPress={() => pick(o)} style={(p) => [s.opt, on && s.optOn, press(p)]}>
                      <Text style={[s.optText, on && { color: colors.primary }]}>{label}</Text>
                      {on && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                    </Pressable>
                  );
                })}
                {opts.length === 1 && <Text style={[s.count, { textAlign: 'center' }]}>No {isC ? 'classes' : 'divisions'} available</Text>}
              </ScrollView>
            </View>
          );
        })()}
      </Modal>

      <StudentForm form={form} schools={schools} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />
    </View>
  );
}

function StudentForm({ form, schools, onClose, onSaved }) {
  const insets = useSafeAreaInsets();
  const [f, setF] = useState(form);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setF(form); }, [form]);
  if (!f) return null;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const isEdit = !!f.id;
  const save = async () => {
    if (!f.name.trim()) return Alert.alert('Missing', 'Please enter the student name.');
    if (!f.gender) return Alert.alert('Missing', 'Please select a gender.');
    const sd = String(f.standard || '').trim();
    if (!sd || sd.length > 30) return Alert.alert('Invalid', 'Please enter a valid standard (e.g. 5, Jr. Kg, Nursery).');
    if (f.division && !/^[A-Z0-9-]+$/.test(f.division.trim())) return Alert.alert('Invalid', 'Division must be uppercase letters or numbers only.');
    if (!f.school_name) return Alert.alert('Missing', 'Please select a school.');
    setSaving(true);
    const body = { name: f.name.trim(), gender: f.gender, school_name: f.school_name, standard: sd, division: (f.division || '').trim(), gr_number: f.gr_number, mq_id: f.mq_id };
    try {
      if (isEdit) await updateStudent(f.id, { ...body, status: f.status || 'Active' }); else await createStudent(body);
      onSaved();
    } catch (e) { Alert.alert('Could not save', e.message); }
    finally { setSaving(false); }
  };
  const Chip = ({ label, on, onPress }) => <Pressable onPress={onPress} style={(p) => [s.chip, on && s.chipOn, press(p)]}><Text style={[s.chipText, on && { color: '#fff' }]}>{label}</Text></Pressable>;
  const Input = ({ k, label, ph, caps }) => (
    <View style={{ flex: 1 }}><Text style={s.label}>{label}</Text><TextInput value={f[k]} onChangeText={(t) => set(k, caps ? t.toUpperCase() : t)} placeholder={ph} placeholderTextColor={colors.iconMuted} style={s.input} autoCapitalize={caps ? 'characters' : 'words'} /></View>
  );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.sheet, { maxHeight: '90%', paddingBottom: 16 + insets.bottom }]}>
        <View style={s.handle} />
        <View style={s.formHead}><Text style={s.formTitle}>{isEdit ? 'Edit student' : 'Add student'}</Text><Pressable onPress={onClose} style={s.x}><Ionicons name="close" size={20} color={colors.subtext} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {Input({ k: 'name', label: 'Full name *', ph: 'Student name' })}
          <Text style={s.label}>Gender *</Text>
          <View style={[s.row, { paddingBottom: 12 }]}>{GENDERS.map((g) => <Chip key={g} label={g} on={f.gender === g} onPress={() => set('gender', g)} />)}</View>
          <Text style={s.label}>School *</Text>
          <View style={[s.row, { flexWrap: 'wrap', paddingBottom: 12 }]}>{schools.map((sc) => <Chip key={sc.id} label={sc.name} on={f.school_name === sc.name} onPress={() => set('school_name', sc.name)} />)}</View>
          <View style={{ flexDirection: 'row', gap: 10 }}>{Input({ k: 'standard', label: 'Standard *', ph: 'e.g. 5' })}{Input({ k: 'division', label: 'Division', ph: 'e.g. A', caps: true })}</View>
          <View style={{ flexDirection: 'row', gap: 10 }}>{Input({ k: 'gr_number', label: 'GR number', ph: 'Optional' })}{Input({ k: 'mq_id', label: 'MQ ID', ph: 'Optional', caps: true })}</View>
          {isEdit && (<>
            <Text style={s.label}>Status</Text>
            <View style={[s.row, { paddingBottom: 12 }]}>{['Active', 'Inactive'].map((x) => <Chip key={x} label={x} on={f.status === x} onPress={() => set('status', x)} />)}</View>
          </>)}
          <Pressable disabled={saving} onPress={save} style={(p) => [s.cta, { marginTop: 6 }, saving && { opacity: 0.5 }, press(p)]}>
            <Ionicons name="checkmark" size={18} color="#fff" /><Text style={s.ctaText}>{saving ? 'Saving...' : isEdit ? 'Save changes' : 'Add student'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themed(() => ({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.navyLight, borderRadius: 16, paddingHorizontal: 14, marginBottom: 10, ...shadow },
  searchInput: { flex: 1, paddingVertical: 12, color: colors.text, fontSize: 14 },
  row: { flexDirection: 'row', gap: 8, paddingBottom: 8 },
  ddRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  dd: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder, ...shadow },
  ddOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  ddLabel: { fontSize: 11, fontWeight: '700', color: colors.subtext, letterSpacing: 0.4, textTransform: 'uppercase' },
  ddVal: { fontSize: 14, fontWeight: '700', color: colors.heading, marginTop: 2 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, marginBottom: 6, backgroundColor: colors.navyLight },
  optOn: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  optText: { fontSize: 15, fontWeight: '600', color: colors.heading },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.heading, fontWeight: '700', fontSize: 12 },
  count: { color: colors.meta, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 4, marginBottom: 10, marginLeft: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.navyLight, borderRadius: 18, padding: 12, marginBottom: 10, ...shadow },
  name: { color: colors.heading, fontSize: 15, fontWeight: '800' },
  meta: { color: colors.meta, fontSize: 12, marginTop: 2 },
  tags: { flexDirection: 'row', gap: 6, marginTop: 6 },
  tag: { backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  tagText: { color: colors.primary, fontSize: 10.5, fontWeight: '800' },
  fab: { position: 'absolute', right: 18, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2563EB', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 14, shadowColor: '#2563EB', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(8,15,12,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.navyLight, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.cardBorder, marginBottom: 14 },
  dName: { color: colors.heading, fontSize: 19, fontWeight: '900', marginTop: 10, textAlign: 'center' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  fIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  fKey: { color: colors.meta, fontSize: 13, fontWeight: '700', width: 100 },
  fVal: { flex: 1, color: colors.heading, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  del: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.errorBg, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 52, borderRadius: 999, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  formHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  formTitle: { color: colors.heading, fontSize: 18, fontWeight: '900' },
  x: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.subtext, fontSize: 12.5, fontWeight: '800', marginBottom: 6 },
  input: { backgroundColor: colors.navy, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: colors.text, marginBottom: 12 },
}));