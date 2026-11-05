import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Alert, useWindowDimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getSchools, createTeam, updateTeam, attachPlayers, getSchoolStudents } from '../api';
import { SPORTS, sportIcon, StudentPicker, Avatar, press, shadow, classLabel } from '../components/teams';

// Create (3 steps: Team -> Players -> Review) or edit (details only) a team / SDP team
export default function TeamFormScreen({ navigation, route }) {
  const { kind, team } = route.params || {};
  const isEdit = !!team;
  const isSdp = kind === 'sports-teams';
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tileW = Math.floor((width - 32 - 24) / 3);
  const [step, setStep] = useState(0);
  const [schools, setSchools] = useState([]);
  const [name, setName] = useState(team?.name?.trim() || '');
  const [sport, setSport] = useState(team?.sport || '');
  const [custom, setCustom] = useState(team?.sport && !SPORTS.includes(team.sport) ? team.sport : '');
  const [schoolId, setSchoolId] = useState(team?.school_id || null);
  const [notes, setNotes] = useState(team?.description || '');
  const [sel, setSel] = useState([]);
  const [students, setStudents] = useState([]);
  const [saving, setSaving] = useState(false);
  const steps = isEdit ? ['Team details'] : ['Team', 'Players', 'Review'];

  useEffect(() => { getSchools(user).then((s) => { setSchools(s); if (!schoolId && s.length) setSchoolId(s[0].id); }).catch(() => {}); }, [user]);
  useEffect(() => { if (step === 2 && schoolId) getSchoolStudents(schoolId).then(setStudents).catch(() => {}); }, [step, schoolId]);

  const finalSport = (custom.trim() || sport).trim();
  const school = schools.find((s) => s.id === schoolId);
  const picked = useMemo(() => students.filter((s) => sel.includes(s.id)), [students, sel]);
  const canNext = step === 0 ? !!name.trim() && !!finalSport && !!schoolId : true;

  const submit = async () => {
    setSaving(true);
    const payload = { name: name.trim(), sport: finalSport, school_id: schoolId, coach_id: team?.coach_id || user.id, description: notes.trim(), status: team?.status };
    try {
      if (isEdit) {
        await updateTeam(kind, team.id, payload);
        Alert.alert('Saved', 'Team updated.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } else {
        const r = await createTeam(kind, payload);
        if (sel.length && r.id) await attachPlayers(kind, r.id, sel);
        Alert.alert('Team created', `${payload.name} is ready with ${sel.length} player${sel.length === 1 ? '' : 's'}.`, [{ text: 'OK', onPress: () => navigation.goBack() }]);
      }
    } catch (e) { Alert.alert('Could not save', e.message); }
    finally { setSaving(false); }
  };
  const next = () => (step === steps.length - 1 ? submit() : setStep(step + 1));
  const back = () => (step === 0 ? navigation.goBack() : setStep(step - 1));

  const Hero = (
    <LinearGradient colors={['#166B2F', '#1E8E3E']} style={[s.hero, { paddingTop: insets.top + 8 }]}>
      <MaterialCommunityIcons name={sportIcon(finalSport)} size={140} color="rgba(255,255,255,0.08)" style={{ position: 'absolute', right: -16, bottom: -28 }} />
      <View style={s.heroTop}>
        <Pressable onPress={back} style={(p) => [s.round, press(p)]}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
        {!isEdit && <View style={s.stepPill}><Text style={s.stepPillText}>STEP {step + 1} / {steps.length}</Text></View>}
      </View>
      <Text style={s.heroTitle}>{isEdit ? 'Edit team' : `New ${isSdp ? 'SDP team' : 'team'}`}</Text>
      <Text style={s.heroSub}>{steps[step]}</Text>
      {!isEdit && (
        <View style={s.dots}>{steps.map((x, i) => <View key={x} style={[s.seg, i <= step && { backgroundColor: '#fff' }]} />)}</View>
      )}
    </LinearGradient>
  );

  const Footer = (
    <View style={[s.footer, { paddingBottom: 14 }]}>
      {step > 0 && <Pressable onPress={back} style={(p) => [s.ghost, press(p)]}><Ionicons name="arrow-back" size={16} color={colors.heading} /><Text style={s.ghostText}>Back</Text></Pressable>}
      <Pressable disabled={!canNext || saving} onPress={next} style={(p) => [s.cta, (!canNext || saving) && { opacity: 0.45 }, press(p)]}>
        <Text style={s.ctaText}>{saving ? 'Saving...' : isEdit ? 'Save changes' : step === 2 ? 'Create team' : step === 1 ? (sel.length ? `Continue with ${sel.length}` : 'Skip for now') : 'Continue'}</Text>
        <Ionicons name={step === steps.length - 1 ? 'checkmark' : 'arrow-forward'} size={18} color="#fff" />
      </Pressable>
    </View>
  );

  if (step === 1) {
    return (
      <View style={s.screen}>
        {Hero}
        <StudentPicker schoolId={schoolId} selected={sel} onChange={setSel} header={<View style={{ paddingTop: 16 }}><Text style={s.h}>Pick players</Text><Text style={s.help}>Choose students from {school?.name || 'your school'}.</Text></View>} />
        {Footer}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {Hero}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {step === 0 ? (
          <>
            <Text style={s.h}>Team details</Text>
            <Text style={s.help}>Give the team a name and choose its sport.</Text>
            <Text style={s.label}>Team name</Text>
            <TextInput value={name} onChangeText={setName} placeholder="e.g. U14 Football Squad" placeholderTextColor={colors.iconMuted} style={s.input} />
            <Text style={s.label}>Sport</Text>
            <View style={s.grid}>
              {SPORTS.map((sp) => {
                const on = !custom.trim() && sport === sp;
                return (
                  <Pressable key={sp} onPress={() => { setSport(sp); setCustom(''); }} style={(p) => [s.tile, { width: tileW }, on && s.tileOn, press(p)]}>
                    <View style={[s.tileIcon, on && { backgroundColor: 'rgba(255,255,255,0.2)' }]}><MaterialCommunityIcons name={sportIcon(sp)} size={24} color={on ? '#fff' : colors.primary} /></View>
                    <Text style={[s.tileText, on && { color: '#fff' }]} numberOfLines={1}>{sp}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput value={custom} onChangeText={setCustom} placeholder="Other sport (type it)" placeholderTextColor={colors.iconMuted} style={s.input} />
            {schools.length > 1 && (<>
              <Text style={s.label}>School</Text>
              {schools.map((sc) => (
                <Pressable key={sc.id} onPress={() => setSchoolId(sc.id)} style={(p) => [s.school, schoolId === sc.id && s.schoolOn, press(p)]}>
                  <Ionicons name="business" size={18} color={colors.primary} />
                  <Text style={s.schoolText} numberOfLines={1}>{sc.name}</Text>
                  <Ionicons name={schoolId === sc.id ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={schoolId === sc.id ? colors.primary : colors.iconMuted} />
                </Pressable>
              ))}
            </>)}
            <Text style={s.label}>Notes (optional)</Text>
            <TextInput value={notes} onChangeText={setNotes} placeholder="Practice schedule, objectives..." placeholderTextColor={colors.iconMuted} style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} multiline />
          </>
        ) : (
          <>
            <Text style={s.h}>Review</Text>
            <Text style={s.help}>Check everything before creating the team.</Text>
            <View style={s.review}>
              <View style={s.revIcon}><MaterialCommunityIcons name={sportIcon(finalSport)} size={28} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.revName}>{name.trim()}</Text>
                <Text style={s.revMeta}>{finalSport} · {school?.name || ''}</Text>
              </View>
              <Pressable onPress={() => setStep(0)}><Text style={s.edit}>Edit</Text></Pressable>
            </View>
            {!!notes.trim() && <Text style={s.notes}>{notes.trim()}</Text>}
            <View style={s.revHead}><Text style={s.label}>{sel.length} player{sel.length === 1 ? '' : 's'}</Text><Pressable onPress={() => setStep(1)}><Text style={s.edit}>Change</Text></Pressable></View>
            {picked.map((p) => (
              <View key={p.id} style={s.pRow}><Avatar name={p.name} size={34} /><Text style={s.pName} numberOfLines={1}>{p.name}</Text><Text style={s.pMeta}>{classLabel(p)}</Text></View>
            ))}
            {!sel.length && <Text style={s.help}>No players yet. You can add them later from the team page.</Text>}
          </>
        )}
      </ScrollView>
      {Footer}
    </KeyboardAvoidingView>
  );
}

const s = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.navy },
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  stepPill: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  stepPillText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  dots: { flexDirection: 'row', gap: 6, marginTop: 14 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  h: { color: colors.heading, fontSize: 20, fontWeight: '900' },
  help: { color: colors.meta, fontSize: 13, marginTop: 3, marginBottom: 14 },
  label: { color: colors.subtext, fontSize: 13, fontWeight: '800', marginBottom: 8, marginTop: 6 },
  input: { backgroundColor: colors.navyLight, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  tile: { height: 92, borderRadius: 18, backgroundColor: colors.navyLight, alignItems: 'center', justifyContent: 'center', padding: 6, borderWidth: 1.5, borderColor: 'transparent', ...shadow },
  tileOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tileIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  tileText: { color: colors.heading, fontSize: 12, fontWeight: '800' },
  school: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.navyLight, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent', ...shadow },
  schoolOn: { borderColor: colors.primary },
  schoolText: { flex: 1, color: colors.heading, fontWeight: '700' },
  review: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.navyLight, borderRadius: 20, padding: 14, ...shadow },
  revIcon: { width: 54, height: 54, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  revName: { color: colors.heading, fontSize: 17, fontWeight: '900' },
  revMeta: { color: colors.meta, fontSize: 12, marginTop: 2 },
  edit: { color: colors.primary, fontWeight: '800' },
  notes: { color: colors.subtext, fontSize: 13, marginTop: 10, lineHeight: 19 },
  revHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 },
  pRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.navyLight, borderRadius: 14, padding: 10, marginBottom: 8 },
  pName: { flex: 1, color: colors.heading, fontWeight: '700' },
  pMeta: { color: colors.meta, fontSize: 12 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.navyLight, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, height: 52, borderRadius: 999, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.navy },
  ghostText: { color: colors.heading, fontWeight: '800' },
  cta: { flex: 1, height: 52, borderRadius: 999, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
}));