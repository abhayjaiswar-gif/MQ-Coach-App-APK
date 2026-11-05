import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ImageBackground, Image, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed, currentMode } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getSchools, getCurriculumSports, getCurriculumGrades, getGradeLevelMap, getSportLessonPlans, fileUrl } from '../api';

// Native version of web SelectCurriculumPage (MQ Curriculum):
// Program -> School (only if >1) -> Sport -> Grade / Under group -> Lesson plans
export const PROGRAMS = [
  { id: 'inschool', name: 'In-School Program', badge: 'IN-SCHOOL', icon: 'school', tint: 'accentOrange', fg: '#C2410C', desc: 'PE framework for the regular school timetable', img: require('../../assets/curriculum/inschool.jpg') },
  { id: 'sdp', name: 'SDP · Specialized', badge: 'ACADEMY', icon: 'star', tint: 'accentBlue', fg: '#1D4ED8', desc: 'High-performance athlete development', img: require('../../assets/curriculum/sdp.jpg') },
  { id: 'msfc', name: 'MSFC · Multi Sport', badge: 'MULTI SPORT', icon: 'barbell', tint: 'accentGreen', fg: '#1E8E3E', desc: 'Holistic multi sport fitness curriculum', img: require('../../assets/curriculum/msfc.jpg') },
];
const HERO_DEFAULT = require('../../assets/curriculum/inschool.jpg');

const SPORT_ICONS = [
  [/foot|soccer/i, 'soccer'], [/cricket/i, 'cricket'], [/basket/i, 'basketball'], [/volley/i, 'volleyball'], [/table/i, 'table-tennis'],
  [/chess/i, 'chess-knight'], [/skat/i, 'skate'], [/hand/i, 'handball'], [/athlet|run|smart start/i, 'run'], [/yoga/i, 'yoga'],
  [/badminton/i, 'badminton'], [/tennis/i, 'tennis'],
];
const sportIcon = (s) => (SPORT_ICONS.find(([r]) => r.test(s)) || [, 'trophy'])[1];
const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const press = ({ pressed }) => pressed && { transform: [{ scale: 0.98 }], opacity: 0.95 };

const STEP_COPY = {
  Program: ['Choose a program', 'Pick the curriculum you are teaching today.'],
  School: ['Select your school', 'Which school is this session for?'],
  Sport: ['Pick a sport', 'Sports set up for this program and school.'],
  Grade: ['Select the grade', 'We will match it to the right curriculum level.'],
  'Under Group': ['Select the age group', 'Choose the under group you are coaching.'],
  'Lesson Plans': ['Lesson plans', 'Tap a plan to see details and mark it.'],
};

function StateBox({ icon, text, loading }) {
  return (
    <View style={styles.state}>
      <View style={styles.stateIcon}>{loading ? <ActivityIndicator color={colors.primary} /> : <MaterialCommunityIcons name={icon} size={30} color={colors.primary} />}</View>
      <Text style={styles.stateText}>{loading ? 'Loading...' : text}</Text>
    </View>
  );
}
export default function CurriculumBuilderScreen({ navigation, route }) {
  const { user } = useAuth();
  const [program, setProgram] = useState(route.params?.program || null);
  const [schools, setSchools] = useState([]);
  const [school, setSchool] = useState(null);
  const [sports, setSports] = useState([]);
  const [sport, setSport] = useState(null);
  const [grades, setGrades] = useState([]);
  const [grade, setGrade] = useState(null);
  const [plans, setPlans] = useState([]);
  const [step, setStep] = useState(route.params?.program ? 1 : 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const multiSchool = schools.length > 1;
  const isMsfc = program === 'msfc';
  // Same step list as the web stepper
  const steps = useMemo(() => {
    const s = ['Program'];
    if (multiSchool) s.push('School');
    if (!isMsfc) s.push('Sport', program === 'sdp' ? 'Under Group' : 'Grade');
    s.push('Lesson Plans');
    return s;
  }, [multiSchool, isMsfc, program]);
  const stepName = steps[step];

  const run = async (fn) => { setLoading(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setLoading(false); } };

  useEffect(() => { run(async () => { const s = await getSchools(user); setSchools(s); if (s.length === 1) setSchool(s[0]); }); }, [user]);

  const loadPlans = useCallback((p, sc, sp, gr) => run(async () => {
    let levelGrade = gr;
    if (p === 'inschool' && gr) {
      const { map, school_grade_map } = await getGradeLevelMap(sc.id, sp);
      const key = String(gr).match(/\d+/)?.[0] || gr;
      const hit = map[gr] || map[key] || school_grade_map[gr] || school_grade_map[key];
      const any = Object.values(map).find((m) => m?.level_grade && !/^n\/?a$/i.test(m.level_grade));
      levelGrade = hit?.level_grade || any?.level_grade || null;
    }
    setPlans(await getSportLessonPlans(p, { schoolId: sc.id, sport: sp, grade: levelGrade, schoolGrade: p === 'inschool' ? gr : undefined }));
  }), []);

  // Load the data each step needs when it becomes visible
  useEffect(() => {
    if (!program) return;
    if (stepName === 'Sport' && school) run(async () => setSports(await getCurriculumSports(program, school.id)));
    if ((stepName === 'Grade' || stepName === 'Under Group') && sport) run(async () => setGrades(await getCurriculumGrades(program, sport, school.id)));
    if (stepName === 'Lesson Plans' && school) {
      if (isMsfc) {
        // web auto-picks the first MSFC sport and group
        run(async () => {
          const sp = sport || (await getCurriculumSports('msfc'))[0];
          const gs = await getCurriculumGrades('msfc', sp);
          const gr = grade || gs[0];
          setSport(sp); setGrades(gs); setGrade(gr);
          setPlans(await getSportLessonPlans('msfc', { schoolId: school.id, sport: sp, grade: gr }));
        });
      } else loadPlans(program, school, sport, grade);
    }
  }, [stepName, program, school?.id]);

  const canNext = () => {
    if (stepName === 'Program') return !!program;
    if (stepName === 'School') return !!school;
    if (stepName === 'Sport') return !!sport;
    if (stepName === 'Grade' || stepName === 'Under Group') return !!grade;
    return false;
  };
  const back = () => (step === 0 ? navigation.goBack() : setStep(step - 1));

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((p) => [p.lp_no, p.skill, p.sub_skill, p.objective].join(' ').toLowerCase().includes(q));
  }, [plans, search]);

  const progName = PROGRAMS.find((p) => p.id === program)?.name || 'MQ Curriculum';

  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const GAP = 12; const inner = winW - 32;
  const w2 = Math.floor((inner - GAP) / 2); const w3 = Math.floor((inner - GAP * 2) / 3);
  const FOOTER_H = 54 + 28;
  const prog = PROGRAMS.find((p) => p.id === program);
  const [stepTitle, stepHelp] = STEP_COPY[stepName] || ['', ''];
  const pct = steps.length > 1 ? (step / (steps.length - 1)) * 100 : 100;
  const isGradeStep = stepName === 'Grade' || stepName === 'Under Group';
  const gradeLabel = (g) => (program === 'inschool' && /^\d+$/.test(String(g)) ? String(g) : String(g));

  return (
    <View style={styles.screen}>
      <ImageBackground source={prog?.img || HERO_DEFAULT} style={[styles.hero, { height: 160 + insets.top, paddingTop: insets.top + 8 }]}>
        <LinearGradient colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.15)', 'rgba(6,32,16,0.92)']} locations={[0, 0.35, 1]} style={StyleFill} />
        <View style={styles.heroTop}>
          <Pressable onPress={back} style={(s) => [styles.roundBtn, press(s)]} hitSlop={8}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <View style={styles.heroPill}><Text style={styles.heroPillText}>STEP {step + 1} / {steps.length}</Text></View>
        </View>
        <View style={{ marginTop: 'auto' }}>
          <Text style={styles.heroTitle} numberOfLines={1}>{prog?.name || 'MQ Curriculum'}</Text>
          <Text style={styles.heroSub} numberOfLines={1}>{stepName === 'Lesson Plans' ? [school?.name, sport, grade].filter(Boolean).join('  ·  ') : stepName}</Text>
          <View style={styles.track}><View style={[styles.trackFill, { width: `${pct}%` }]} /></View>
        </View>
      </ImageBackground>

      <View style={styles.stepsBar}>
        {steps.map((s, i) => {
          const done = i < step; const cur = i === step;
          return (
            <View key={s} style={{ flexDirection: 'row', alignItems: 'center' }}>
              {i > 0 && <View style={[styles.line, i <= step && { backgroundColor: colors.primary }]} />}
              {cur ? (
                <View style={[styles.stepPill, styles.stepCur]}><Text style={[styles.stepNo, { color: '#fff' }]}>{i + 1}</Text><Text style={[styles.stepText, { color: '#fff' }]} numberOfLines={1}>{s}</Text></View>
              ) : (
                <View style={[styles.dot, done && styles.dotDone]}>{done ? <Ionicons name="checkmark" size={13} color="#fff" /> : <Text style={styles.stepNo}>{i + 1}</Text>}</View>
              )}
            </View>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: (stepName === 'Lesson Plans' ? 24 : FOOTER_H + 16) }} keyboardShouldPersistTaps="handled" stickyHeaderIndices={stepName === 'Lesson Plans' ? [1] : []} showsVerticalScrollIndicator={false}>
        <View style={styles.titleBox}>
          <Text style={styles.stepTitle}>{stepTitle}</Text>
          <Text style={styles.stepHelp}>{stepHelp}</Text>
        </View>

        {stepName === 'Lesson Plans' ? (
          <View style={styles.stickyWrap}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={colors.primary} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search skill, objective, LP no." placeholderTextColor={colors.iconMuted} style={styles.searchInput} />
              {!!search && <Pressable onPress={() => setSearch('')}><Ionicons name="close-circle" size={18} color={colors.iconMuted} /></Pressable>}
            </View>
            {isMsfc && grades.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
                {grades.map((g) => (
                  <Pressable key={g} style={(s) => [styles.fChip, grade === g && styles.fChipOn, press(s)]} onPress={() => { setGrade(g); run(async () => setPlans(await getSportLessonPlans('msfc', { schoolId: school.id, sport, grade: g }))); }}>
                    <Text style={[styles.fChipText, grade === g && { color: '#fff' }]}>{g}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ) : <View />}

        {!!error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {stepName === 'Program' && PROGRAMS.map((p) => {
          const on = program === p.id;
          return (
            <Pressable key={p.id} onPress={() => { setProgram(p.id); setSport(null); setGrade(null); setPlans([]); }} style={(s) => [styles.imgCard, on && styles.imgCardOn, press(s)]}>
              <ImageBackground source={p.img} style={{ flex: 1 }} imageStyle={{ borderRadius: on ? 19 : 22 }}>
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)', 'rgba(6,32,16,0.9)']} locations={[0, 0.4, 1]} style={[styles.imgGrad, { borderRadius: on ? 19 : 22 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View style={styles.badge}><Ionicons name={p.icon} size={11} color="#fff" /><Text style={styles.badgeText}>{p.badge}</Text></View>
                    {on && <View style={styles.check}><Ionicons name="checkmark" size={16} color="#fff" /></View>}
                  </View>
                  <View style={styles.imgBottom}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.imgTitle}>{p.name}</Text>
                      <Text style={styles.imgSub} numberOfLines={1}>{p.desc}</Text>
                    </View>
                    <View style={styles.arrow}><Ionicons name="arrow-forward" size={18} color={colors.primary} /></View>
                  </View>
                </LinearGradient>
              </ImageBackground>
            </Pressable>
          );
        })}

        {stepName === 'School' && (loading ? <StateBox loading /> : schools.length ? schools.map((s) => {
          const on = school?.id === s.id;
          const img = fileUrl(s.school_image || s.school_logo);
          return (
            <Pressable key={s.id} onPress={() => { setSchool(s); setSport(null); setGrade(null); }} style={(p) => [styles.schoolCard, on && styles.cardOn, press(p)]}>
              {img ? <Image source={{ uri: img }} style={styles.schoolImg} /> : (
                <LinearGradient colors={[colors.primarySoft, currentMode === 'dark' ? '#1C211E' : '#FFFFFF']} style={styles.schoolImg}>
                  <Text style={styles.initials}>{initials(s.name)}</Text>
                </LinearGradient>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.schoolName} numberOfLines={2}>{s.name}</Text>
                {!!(s.city || s.address_line1) && <Text style={styles.schoolCity} numberOfLines={1}><Ionicons name="location-outline" size={12} /> {s.city || s.address_line1}</Text>}
              </View>
              <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? colors.primary : colors.iconMuted} />
            </Pressable>
          );
        }) : <StateBox icon="school-outline" text="No schools are assigned to you yet." />)}

        {stepName === 'Sport' && (loading ? <StateBox loading /> : sports.length ? (
          <View style={styles.grid2}>
            {sports.map((s) => {
              const on = sport === s;
              return (
                <Pressable key={s} onPress={() => { setSport(s); setGrade(null); }} style={(p) => [styles.sportTile, { width: w2 }, on && styles.tileOn, press(p)]}>
                  <View style={[styles.sportCircle, on && { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                    <MaterialCommunityIcons name={sportIcon(s)} size={32} color={on ? '#fff' : colors.primary} />
                  </View>
                  <Text style={[styles.sportName, on && { color: '#fff' }]} numberOfLines={2}>{s}</Text>
                  {on && <View style={styles.tileCheck}><Ionicons name="checkmark" size={12} color={colors.primary} /></View>}
                </Pressable>
              );
            })}
          </View>
        ) : <StateBox icon="trophy-outline" text="No sports set up for this school yet." />)}

        {isGradeStep && (loading ? <StateBox loading /> : grades.length ? (
          <View style={styles.grid3}>
            {grades.map((g) => {
              const on = grade === g;
              const numeric = program === 'inschool' && /^\d+$/.test(String(g));
              return (
                <Pressable key={g} onPress={() => setGrade(g)} style={(p) => [styles.gradeTile, { width: w3, height: w3 }, on && styles.tileOn, press(p)]}>
                  {numeric && <Text style={[styles.gradeCap, on && { color: 'rgba(255,255,255,0.8)' }]}>GRADE</Text>}
                  <Text style={[numeric ? styles.gradeNum : styles.gradeLabel, on && { color: '#fff' }]} numberOfLines={2} adjustsFontSizeToFit>{gradeLabel(g)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : <StateBox icon="account-group-outline" text={program === 'inschool' ? 'No grades are set up for this school yet.' : 'No groups found for this sport.'} />)}

        {stepName === 'Lesson Plans' && (loading ? <StateBox loading /> : shown.length ? (
          <>
            <Text style={styles.count}>{shown.length} lesson plan{shown.length === 1 ? '' : 's'}</Text>
            {shown.map((p, i) => {
              const st = String(p.lp_status || p.status || '').toLowerCase();
              const done = st === 'complete' || st === 'done' || p.is_done;
              return (
                <Pressable key={p.unique_id || p.lp_unique_id || i} onPress={() => navigation.navigate('LessonPlan', { plan: p, program, school, sport, grade, plans: shown, index: i })} style={(s) => [styles.lpCard, press(s)]}>
                  <View style={styles.lpAccent} />
                  <View style={styles.lpBadge}><Text style={styles.lpBadgeTop}>LP</Text><Text style={styles.lpBadgeNo} numberOfLines={1} adjustsFontSizeToFit>{p.lp_no}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lpTitle} numberOfLines={1}>{p.skill || 'Lesson Plan'}</Text>
                    {!!p.sub_skill && <Text style={styles.lpSub} numberOfLines={1}>{p.sub_skill}</Text>}
                    {!!p.objective && <Text style={styles.lpObj} numberOfLines={2}>{p.objective}</Text>}
                    <View style={styles.chipRow}>
                      {!!p.grade && <View style={styles.chip}><Text style={styles.chipText}>{p.grade}</Text></View>}
                      {!!p.week && <View style={[styles.chip, { backgroundColor: colors.accentBlue }]}><Text style={[styles.chipText, { color: '#1D4ED8' }]}>{p.week}</Text></View>}
                      {!!st && <View style={[styles.chip, { backgroundColor: done ? colors.primarySoft : colors.navy }]}><Text style={[styles.chipText, { color: done ? colors.primary : colors.meta }]}>{done ? 'Completed' : 'Pending'}</Text></View>}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
                </Pressable>
              );
            })}
          </>
        ) : <StateBox icon="clipboard-text-outline" text={search ? 'No plans match your search.' : 'No lesson plans found for this selection.'} />)}
      </ScrollView>

      {stepName !== 'Lesson Plans' && (
        <View style={[styles.footer, { paddingBottom: 14 }]}>
          {step > 0 && <Pressable style={(s) => [styles.ghost, press(s)]} onPress={back}><Ionicons name="arrow-back" size={16} color={colors.heading} /><Text style={styles.ghostText}>Back</Text></Pressable>}
          <Pressable disabled={!canNext()} onPress={() => setStep(step + 1)} style={(s) => [styles.cta, !canNext() && { opacity: 0.45 }, press(s)]}>
            <Text style={styles.ctaText}>{steps[step + 1] === 'Lesson Plans' ? 'Show Lesson Plans' : 'Continue'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const StyleFill = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 };
const shadow = { shadowColor: '#0F3D1F', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 };
const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.navy },
  hero: { paddingHorizontal: 18, paddingBottom: 16, overflow: 'hidden', borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  heroPill: { backgroundColor: 'rgba(30,142,62,0.9)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  heroPillText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', marginTop: 2 },
  track: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 12, overflow: 'hidden' },
  trackFill: { height: 5, borderRadius: 3, backgroundColor: '#4ADE80' },
  stepsBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, paddingHorizontal: 16 },
  line: { width: 14, height: 2, borderRadius: 1, backgroundColor: colors.cardBorder, marginHorizontal: 4 },
  dot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  stepDone: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  stepCur: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepNo: { color: colors.meta, fontSize: 11, fontWeight: '900' },
  stepText: { color: colors.meta, fontSize: 12, fontWeight: '700' },
  titleBox: { marginTop: 18, marginBottom: 14 },
  stepTitle: { color: colors.heading, fontSize: 20, fontWeight: '900' },
  stepHelp: { color: colors.meta, fontSize: 13, marginTop: 3 },
  stickyWrap: { backgroundColor: colors.navy, paddingBottom: 12 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.navyLight, borderRadius: 18, paddingHorizontal: 14, ...shadow },
  searchInput: { flex: 1, paddingVertical: 13, color: colors.text, fontSize: 14 },
  fChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  fChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  fChipText: { color: colors.heading, fontWeight: '700', fontSize: 13 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.errorBg, borderRadius: 16, padding: 14, marginBottom: 14 },
  errorText: { color: colors.error, fontWeight: '700', flex: 1 },
  imgCard: { height: 176, borderRadius: 22, overflow: 'hidden', marginBottom: 16, backgroundColor: colors.navyLight, ...shadow, shadowOpacity: 0.1, elevation: 2 },
  imgCardOn: { borderWidth: 2.5, borderColor: colors.primary },
  imgGrad: { flex: 1, padding: 16, justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(30,142,62,0.9)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  check: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  imgBottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  imgTitle: { color: '#fff', fontSize: 19, fontWeight: '900' },
  imgSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  arrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  schoolCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.navyLight, borderRadius: 22, padding: 14, marginBottom: 14, borderWidth: 2, borderColor: 'transparent', ...shadow },
  cardOn: { borderColor: colors.primary },
  schoolImg: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  schoolName: { color: colors.heading, fontSize: 16, fontWeight: '800' },
  schoolCity: { color: colors.meta, fontSize: 12, marginTop: 4 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
  sportTile: { height: 132, borderRadius: 22, backgroundColor: colors.navyLight, marginBottom: 14, alignItems: 'center', justifyContent: 'center', padding: 12, borderWidth: 2, borderColor: 'transparent', ...shadow },
  tileOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  sportCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  sportName: { color: colors.heading, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  tileCheck: { position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  grid3: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
  gradeTile: { borderRadius: 22, backgroundColor: colors.navyLight, marginBottom: 12, alignItems: 'center', justifyContent: 'center', padding: 8, borderWidth: 2, borderColor: 'transparent', ...shadow },
  gradeCap: { color: colors.meta, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  gradeNum: { color: colors.heading, fontSize: 28, fontWeight: '900' },
  gradeLabel: { color: colors.heading, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  count: { color: colors.meta, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginLeft: 2 },
  lpCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.navyLight, borderRadius: 18, padding: 16, paddingLeft: 20, marginBottom: 16, overflow: 'hidden', ...shadow },
  lpAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: colors.primary },
  lpBadge: { width: 54, height: 54, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  lpBadgeTop: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  lpBadgeNo: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  lpTitle: { color: colors.heading, fontSize: 15, fontWeight: '800' },
  lpSub: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 2 },
  lpObj: { color: colors.subtext, fontSize: 13, lineHeight: 18, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  state: { alignItems: 'center', paddingVertical: 50, paddingHorizontal: 30 },
  stateIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  stateText: { color: colors.meta, fontSize: 14, textAlign: 'center', fontWeight: '600' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14, backgroundColor: colors.navyLight, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...shadow, shadowOffset: { width: 0, height: -3 }, elevation: 6, borderTopWidth: 1, borderColor: colors.cardBorder },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, height: 54, borderRadius: 999, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.navy },
  ghostText: { color: colors.heading, fontWeight: '800' },
  cta: { flex: 1, height: 54, borderRadius: 999, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#1E8E3E', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '900' },
}));