import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, FlatList, Modal, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, themed } from '../theme/colors';
import { getSchoolStudents } from '../api';

// Shared pieces for Team Management + SDP
export const SPORTS = ['Football', 'Cricket', 'Basketball', 'Volleyball', 'Athletics', 'Badminton', 'Table Tennis', 'Chess', 'Skating', 'Handball', 'Kabaddi', 'Netball'];
const ICONS = [[/foot|soccer/i, 'soccer'], [/cricket/i, 'cricket'], [/basket/i, 'basketball'], [/volley/i, 'volleyball'], [/table/i, 'table-tennis'], [/chess/i, 'chess-knight'], [/skat/i, 'skate'], [/hand/i, 'handball'], [/athlet|run/i, 'run'], [/yoga/i, 'yoga'], [/badminton/i, 'badminton'], [/tennis/i, 'tennis'], [/netball/i, 'basketball-hoop-outline'], [/kabaddi/i, 'kabaddi']];
export const sportIcon = (s = '') => (ICONS.find(([r]) => r.test(s)) || [, 'trophy-outline'])[1];
const TINTS = ['#1E8E3E', '#2563EB', '#D97706', '#DB2777', '#7C3AED', '#0891B2', '#EA580C', '#059669'];
export const tintFor = (k = '') => TINTS[[...String(k)].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
export const initials = (n = '') => n.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
export const press = ({ pressed }) => pressed && { transform: [{ scale: 0.98 }], opacity: 0.95 };
export const shadow = { shadowColor: '#0F3D1F', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 };
export const classLabel = (p) => [p.std && `Class ${p.std}`, p.division].filter(Boolean).join(' · ');

export function Avatar({ name, size = 40 }) {
  const c = tintFor(name);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c + '22', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c, fontWeight: '800', fontSize: size * 0.36 }}>{initials(name)}</Text>
    </View>
  );
}

export function SportBadge({ sport }) {
  return (
    <View style={st.badge}><MaterialCommunityIcons name={sportIcon(sport)} size={12} color={colors.primary} /><Text style={st.badgeText} numberOfLines={1}>{sport || 'General'}</Text></View>
  );
}

export function EmptyState({ icon = 'account-group-outline', title, text, action, onAction }) {
  return (
    <View style={st.empty}>
      <View style={st.emptyIcon}><MaterialCommunityIcons name={icon} size={34} color={colors.primary} /></View>
      {!!title && <Text style={st.emptyTitle}>{title}</Text>}
      {!!text && <Text style={st.emptyText}>{text}</Text>}
      {!!action && <Pressable onPress={onAction} style={(s) => [st.emptyBtn, press(s)]}><Text style={st.emptyBtnText}>{action}</Text></Pressable>}
    </View>
  );
}

// Bottom-sheet "⋯" menu: items [{ label, icon, onPress, danger }]
export function ActionSheet({ visible, title, items = [], onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose}>
        <Pressable style={st.sheet} onPress={() => {}}>
          <View style={st.grab} />
          {!!title && <Text style={st.sheetTitle} numberOfLines={1}>{title}</Text>}
          {items.map((it) => (
            <Pressable key={it.label} onPress={() => { onClose(); setTimeout(it.onPress, 200); }} style={(s) => [st.sheetRow, press(s)]}>
              <View style={[st.sheetIcon, { backgroundColor: it.danger ? colors.errorBg : colors.primarySoft }]}><Ionicons name={it.icon} size={18} color={it.danger ? colors.error : colors.primary} /></View>
              <Text style={[st.sheetLabel, it.danger && { color: colors.error }]}>{it.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={(s) => [st.cancel, press(s)]}><Text style={st.cancelText}>Cancel</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Student picker over existing school students: search, Grade/Division chips, tick boxes, select all
export function StudentPicker({ schoolId, selected, onChange, excludeIds = [], header }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState(null);
  const [div, setDiv] = useState(null);
  useEffect(() => { setLoading(true); getSchoolStudents(schoolId).then(setAll).catch(() => setAll([])).finally(() => setLoading(false)); }, [schoolId]);
  const ex = useMemo(() => new Set(excludeIds.map(Number)), [excludeIds]);
  const pool = useMemo(() => all.filter((s) => !ex.has(Number(s.id))), [all, ex]);
  const grades = useMemo(() => [...new Set(pool.map((s) => s.std).filter(Boolean))], [pool]);
  const divs = useMemo(() => [...new Set(pool.filter((s) => !grade || s.std === grade).map((s) => s.division).filter(Boolean))].sort(), [pool, grade]);
  const shown = useMemo(() => pool.filter((s) => (!grade || s.std === grade) && (!div || s.division === div) && (!q || s.name.toLowerCase().includes(q.toLowerCase()))), [pool, grade, div, q]);
  const sel = new Set(selected);
  const allOn = shown.length > 0 && shown.every((s) => sel.has(s.id));
  const toggle = (id) => onChange(sel.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleAll = () => {
    const ids = shown.map((s) => s.id);
    onChange(allOn ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])]);
  };
  const Chip = ({ label, on, onPress }) => <Pressable onPress={onPress} style={(s) => [st.chip, on && st.chipOn, press(s)]}><Text style={[st.chipText, on && { color: '#fff' }]}>{label}</Text></Pressable>;

  return (
    <FlatList
      data={loading ? [] : shown}
      keyExtractor={(s) => String(s.id)}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
      ListHeaderComponent={
        <View>
          {header}
          <View style={st.search}>
            <Ionicons name="search" size={18} color={colors.primary} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search students" placeholderTextColor={colors.iconMuted} style={st.searchInput} />
            {!!q && <Pressable onPress={() => setQ('')}><Ionicons name="close-circle" size={18} color={colors.iconMuted} /></Pressable>}
          </View>
          {grades.length > 0 && <FlatList horizontal data={[null, ...grades]} keyExtractor={(g) => String(g)} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
            renderItem={({ item: g }) => <Chip label={g ? (/^\d+$/.test(g) ? `Grade ${g}` : g) : 'All grades'} on={grade === g} onPress={() => { setGrade(g); setDiv(null); }} />} />}
          {divs.length > 1 && <FlatList horizontal data={[null, ...divs]} keyExtractor={(d) => String(d)} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
            renderItem={({ item: d }) => <Chip label={d ? `Div ${d}` : 'All divisions'} on={div === d} onPress={() => setDiv(d)} />} />}
          <View style={st.selRow}>
            <Text style={st.selCount}>{selected.length} selected · {shown.length} shown</Text>
            {shown.length > 0 && <Pressable onPress={toggleAll} style={(s) => [st.selAll, press(s)]}><Ionicons name={allOn ? 'checkbox' : 'square-outline'} size={18} color={colors.primary} /><Text style={st.selAllText}>{allOn ? 'Clear' : 'Select all'}</Text></Pressable>}
          </View>
        </View>
      }
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : <EmptyState icon="account-search-outline" title="No students found" text={pool.length ? 'Try another grade, division or name.' : 'This school has no students yet, or all of them are already in this team.'} />}
      renderItem={({ item: s }) => {
        const on = sel.has(s.id);
        return (
          <Pressable onPress={() => toggle(s.id)} style={(p) => [st.stu, on && st.stuOn, press(p)]}>
            <Avatar name={s.name} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={st.stuName} numberOfLines={1}>{s.name}</Text>
              <Text style={st.stuMeta} numberOfLines={1}>{classLabel(s)}</Text>
            </View>
            <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={on ? colors.primary : colors.iconMuted} />
          </Pressable>
        );
      }}
    />
  );
}

const st = themed(() => ({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start', maxWidth: 140 },
  badgeText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 50, paddingHorizontal: 30 },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: colors.heading, fontSize: 16, fontWeight: '800' },
  emptyText: { color: colors.meta, fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 19 },
  emptyBtn: { marginTop: 16, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11 },
  emptyBtnText: { color: '#fff', fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.navyLight, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 30 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.cardBorder, marginBottom: 12 },
  sheetTitle: { color: colors.meta, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginLeft: 4 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  sheetIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sheetLabel: { color: colors.heading, fontSize: 15, fontWeight: '700' },
  cancel: { marginTop: 8, alignItems: 'center', paddingVertical: 13, borderRadius: 999, backgroundColor: colors.navy },
  cancelText: { color: colors.heading, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.navyLight, borderRadius: 16, paddingHorizontal: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.cardBorder },
  searchInput: { flex: 1, paddingVertical: 12, color: colors.text, fontSize: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.heading, fontWeight: '700', fontSize: 12 },
  selRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 10 },
  selCount: { color: colors.meta, fontSize: 12, fontWeight: '700' },
  selAll: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.primarySoft },
  selAllText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  stu: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.navyLight, borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent', ...shadow },
  stuOn: { borderColor: colors.primary },
  stuName: { color: colors.heading, fontSize: 15, fontWeight: '700' },
  stuMeta: { color: colors.meta, fontSize: 12, marginTop: 2 },
}));