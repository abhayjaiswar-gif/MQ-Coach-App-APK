import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, FlatList, ActivityIndicator, Alert, Linking, Modal, Share } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getFillMarksFilters, getStudents, getReportStudents, checkReportCards, getReportPreview, generateReportCard, reportCardPdfUrl, reportCardZipUrl, detailReportPdfUrl } from '../api';
import { Header } from '../components/ui';
import { Avatar, press, shadow } from '../components/teams';

// Port of web ReportCardPage (/reports/report-card). 3 steps: type -> class -> generate.
const TYPES = [
  { key: 'card', title: 'Report Card', desc: 'One-page result card to print or send to parents.', icon: 'file-document-outline', tint: '#1E8E3E', qr: false, lines: [1, 0.8, 0.9, 0.6] },
  { key: 'qr', title: 'Report Card with QR', desc: 'Same card with a QR code parents scan to see results online.', icon: 'qrcode-scan', tint: '#2563EB', qr: true, lines: [1, 0.7, 0.85] },
  { key: 'detail', title: 'Detailed Fitness Report', desc: 'Several pages explaining every test, for a full review.', icon: 'chart-box-outline', tint: '#7C3AED', lines: [0.9, 1, 0.7, 0.95, 0.6] },
];
const TERMS = [['both', 'Both terms'], ['term1', 'Term 1'], ['term2', 'Term 2']];
const sortNum = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const norm = (v) => String(v || '').trim().toLowerCase();
const classLabel = (g) => (/^\d+$/.test(String(g)) ? `Class ${g}` : String(g));

export default function ReportCardScreen({ navigation }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [type, setType] = useState(null);
  const [schools, setSchools] = useState([]);
  const [school, setSchool] = useState(null);
  const [stds, setStds] = useState([]);
  const [divs, setDivs] = useState([]);
  const [std, setStd] = useState(null);
  const [div, setDiv] = useState(null);
  const [term, setTerm] = useState('both');
  const [all, setAll] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fix, setFix] = useState(null);
  const T = TYPES.find((t) => t.key === type);
  const opts = { selectedTerm: term, showScanner: !!T?.qr };

  useEffect(() => { (async () => {
    try {
      const [f, st] = await Promise.all([getFillMarksFilters(user), getStudents(user).catch(() => [])]);
      setSchools(f.schools || []); setAll(st);
      if ((f.schools || []).length) setSchool(f.schools[0]);
    } catch (e) { setError(e.message); }
  })(); }, []);

  useEffect(() => { if (!school) return; (async () => {
    const f = await getFillMarksFilters(user, school.id).catch(() => null);
    const inSch = all.filter((x) => String(x.school_id) === String(school.id) || x.school_name === school.name);
    const sList = f ? (f.standards || []).map((x) => x.name || x.id) : [...new Set(inSch.map((x) => x.std))];
    setStds(sList.sort(sortNum)); setDivs(f ? [...(f.divisions || [])].sort(sortNum) : []);
    setStd(null); setDiv(null);
  })(); }, [school, all]);

  // Divisions that really exist for the chosen class (fallback: school list)
  const divOpts = useMemo(() => {
    const d = [...new Set(all.filter((x) => (String(x.school_id) === String(school?.id) || x.school_name === school?.name) && x.std === std).map((x) => x.division).filter(Boolean))].sort(sortNum);
    return d.length ? d : divs;
  }, [all, school, std, divs]);
  useEffect(() => { if (std && !div && divOpts.length === 1) setDiv(divOpts[0]); }, [std, divOpts]);

  const load = async () => {
    setLoading(true); setError(''); setRows([]);
    try {
      const withMarks = await getReportStudents({ school_id: school.id, std, division: div });
      const roster = all.filter((x) => (String(x.school_id) === String(school.id) || x.school_name === school.name) && x.std === std && x.division === div && (x.status === 1 || x.status === '1' || x.status === 'Active'));
      const chk = await checkReportCards(withMarks.map((x) => x.result_id));
      const byId = new Map(withMarks.map((x) => [x.id, x]));
      const list = [...withMarks.map((x) => ({ ...x, check: chk[x.result_id] }))];
      roster.forEach((r) => { if (!byId.has(r.id)) list.push({ id: r.id, name: r.name, mq_id: r.mq_id, std: r.std, division: r.division, result_id: null }); });
      list.forEach((x) => { x.state = !x.result_id ? 'none' : x.check?.ready ? 'ready' : 'fix'; });
      const order = { ready: 0, fix: 1, none: 2 };
      list.sort((a, b) => order[a.state] - order[b.state] || norm(a.name).localeCompare(norm(b.name)));
      setRows(list);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (step === 3 && school && std && div) load(); }, [step, std, div, school]);

  const ready = rows.filter((r) => r.state === 'ready');
  const counts = { ready: ready.length, fix: rows.filter((r) => r.state === 'fix').length, none: rows.filter((r) => r.state === 'none').length };

  const openOne = (r) => {
    if (r.state === 'none') return goFill();
    if (r.state === 'fix') return setFix(r);
    Linking.openURL(type === 'detail' ? detailReportPdfUrl(r.result_id) : reportCardPdfUrl(r.result_id, opts));
  };
  const goFill = () => navigation.navigate('FillMarks');

  const generateAll = async () => {
    if (!ready.length) return;
    if (type === 'detail') return Alert.alert('One at a time', 'Detailed reports are large, so open them one student at a time using the Open button.');
    setBulk({ done: 0, total: ready.length, ok: [], failed: [] });
    const ok = [], failed = [];
    for (let i = 0; i < ready.length; i++) {
      const r = ready[i];
      const d = await generateReportCard(r.result_id, opts).catch(() => ({ success: false }));
      (d.success ? ok : failed).push(r);
      setBulk({ done: i + 1, total: ready.length, ok: [...ok], failed: [...failed], current: r.name });
    }
    setBulk({ done: ready.length, total: ready.length, ok, failed, finished: true });
  };

  const openPreview = async (r) => {
    setPreview({ r, loading: true });
    try { const d = await getReportPreview(r.result_id); setPreview({ r, data: d }); }
    catch (e) { setPreview(null); Alert.alert('Could not load preview', e.message); }
  };

  const Steps = () => (
    <View style={s.steps}>
      {['Choose type', 'Choose class', 'Generate'].map((l, i) => {
        const n = i + 1, on = step === n, done = step > n;
        return (
          <Pressable key={l} disabled={n > step} onPress={() => setStep(n)} style={s.stepItem}>
            <View style={[s.stepDot, (on || done) && s.stepDotOn]}>{done ? <Ionicons name="checkmark" size={14} color="#fff" /> : <Text style={[s.stepNum, on && { color: '#fff' }]}>{n}</Text>}</View>
            <Text style={[s.stepLbl, on && { color: colors.heading }]}>{l}</Text>
            {i < 2 && <View style={[s.stepLine, done && { backgroundColor: colors.primary }]} />}
          </Pressable>
        );
      })}
    </View>
  );

  const DD = ({ k, label, value, empty, disabled }) => (
    <Pressable disabled={disabled} onPress={() => setPicker(k)} style={(p) => [s.dd, value && s.ddOn, disabled && { opacity: 0.5 }, press(p)]}>
      <View style={{ flex: 1 }}><Text style={s.ddLabel}>{label}</Text><Text style={[s.ddVal, !value && { color: colors.subtext }]} numberOfLines={1}>{value || empty}</Text></View>
      <Ionicons name="chevron-down" size={20} color={value ? colors.primary : colors.iconMuted} />
    </Pressable>
  );

  const pickerOpts = picker === 'school' ? schools.map((x) => [x, x.name]) : picker === 'class' ? stds.map((x) => [x, classLabel(x)]) : divOpts.map((x) => [x, `Division ${x}`]);
  const pickerCur = picker === 'school' ? school : picker === 'class' ? std : div;

  const STATE = {
    ready: { label: 'Ready', color: '#16A34A', icon: 'checkmark-circle' },
    fix: { label: 'Some marks missing', color: '#D97706', icon: 'alert-circle' },
    none: { label: 'No marks yet', color: colors.iconMuted, icon: 'ellipse-outline' },
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.navy }}>
      <Header title="Report Cards" subtitle={T ? T.title : 'Create and share'} onBack={() => (step > 1 ? setStep(step - 1) : navigation.goBack())} />
      <Steps />

      {step === 1 && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          <Text style={s.h}>What do you want to make?</Text>
          {TYPES.map((t) => (
            <Pressable key={t.key} onPress={() => { setType(t.key); setStep(2); }} style={(p) => [s.type, type === t.key && { borderColor: t.tint }, press(p)]}>
              <View style={[s.thumb, { borderColor: t.tint + '55' }]}>
                <View style={[s.thumbHead, { backgroundColor: t.tint }]} />
                {t.lines.map((w, i) => <View key={i} style={[s.thumbLine, { width: `${w * 80}%` }]} />)}
                {t.qr && <MaterialCommunityIcons name="qrcode" size={18} color={t.tint} style={{ position: 'absolute', right: 5, bottom: 5 }} />}
                {t.key === 'detail' && <MaterialCommunityIcons name="chart-bar" size={18} color={t.tint} style={{ position: 'absolute', right: 5, bottom: 5 }} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialCommunityIcons name={t.icon} size={20} color={t.tint} />
                  <Text style={s.typeTitle}>{t.title}</Text>
                </View>
                <Text style={s.typeDesc}>{t.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {step === 2 && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
          <Text style={s.h}>Which class?</Text>
          {schools.length > 1 && <View style={{ marginBottom: 10 }}><DD k="school" label="School" value={school?.name} empty="Choose school" /></View>}
          <View style={s.ddRow}>
            <DD k="class" label="Class" value={std && classLabel(std)} empty="Choose" />
            <DD k="div" label="Division" value={div && `Div ${div}`} empty="Choose" disabled={!std} />
          </View>
          {type !== 'detail' && (<>
            <Text style={s.label}>Show marks for</Text>
            <View style={s.seg}>
              {TERMS.map(([k, l]) => <Pressable key={k} onPress={() => setTerm(k)} style={[s.segBtn, term === k && s.segOn]}><Text style={[s.segText, term === k && { color: '#fff' }]}>{l}</Text></Pressable>)}
            </View>
          </>)}
          {!!error && <Text style={s.err}>{error}</Text>}
        </ScrollView>
      )}

      {step === 3 && (
        <FlatList
          data={loading ? [] : rows}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          ListHeaderComponent={!loading && rows.length > 0 ? (
            <View style={s.sumRow}>
              <View style={[s.sum, { backgroundColor: 'rgba(22,163,74,0.12)' }]}><Text style={[s.sumNum, { color: '#16A34A' }]}>{counts.ready}</Text><Text style={s.sumLbl}>Ready</Text></View>
              <View style={[s.sum, { backgroundColor: 'rgba(217,119,6,0.12)' }]}><Text style={[s.sumNum, { color: '#D97706' }]}>{counts.fix}</Text><Text style={s.sumLbl}>Missing marks</Text></View>
              <View style={[s.sum, { backgroundColor: colors.navyLight }]}><Text style={[s.sumNum, { color: colors.subtext }]}>{counts.none}</Text><Text style={s.sumLbl}>No marks</Text></View>
            </View>
          ) : null}
          ListEmptyComponent={loading ? <View style={s.empty}><ActivityIndicator color={colors.primary} /><Text style={s.emptyText}>Checking marks...</Text></View> : (
            <View style={s.empty}>
              <MaterialCommunityIcons name={error ? 'wifi-off' : 'clipboard-text-outline'} size={40} color={colors.iconMuted} />
              <Text style={s.emptyTitle}>{error ? "Couldn't load students" : 'No marks in this class yet'}</Text>
              <Text style={s.emptyText}>{error ? 'Check your connection and try again.' : 'Fill marks first, then come back to make report cards.'}</Text>
              <Pressable onPress={error ? load : goFill} style={(p) => [s.ghostBtn, press(p)]}><Text style={s.ghostText}>{error ? 'Try again' : 'Go to Fill Marks'}</Text></Pressable>
            </View>
          )}
          renderItem={({ item: r }) => {
            const st = STATE[r.state];
            return (
              <View style={s.row}>
                <Pressable disabled={r.state !== 'ready'} onPress={() => openPreview(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Avatar name={r.name} size={42} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{r.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <Ionicons name={st.icon} size={14} color={st.color} />
                      <Text style={[s.state, { color: st.color }]}>{st.label}{r.state === 'fix' ? ` (${(r.check?.missing || 0) + (r.check?.out_of_range || 0)})` : ''}</Text>
                    </View>
                  </View>
                </Pressable>
                <Pressable onPress={() => openOne(r)} style={(p) => [s.rowBtn, r.state === 'ready' ? { backgroundColor: T.tint } : s.rowBtnAlt, press(p)]}>
                  <Text style={[s.rowBtnText, r.state !== 'ready' && { color: colors.heading }]}>{r.state === 'ready' ? 'Open' : r.state === 'fix' ? 'See why' : 'Fill marks'}</Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}

      {step === 2 && (
        <View style={s.footer}>
          <Pressable disabled={!std || !div} onPress={() => setStep(3)} style={(p) => [s.big, { backgroundColor: T?.tint || colors.primary }, (!std || !div) && { opacity: 0.45 }, press(p)]}>
            <Text style={s.bigText}>{std && div ? `Show students of ${classLabel(std)}-${div}` : 'Choose class and division'}</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </Pressable>
        </View>
      )}
      {step === 3 && rows.length > 0 && (
        <View style={s.footer}>
          <Pressable disabled={!ready.length} onPress={generateAll} style={(p) => [s.big, { backgroundColor: T.tint }, !ready.length && { opacity: 0.45 }, press(p)]}>
            <MaterialCommunityIcons name="file-multiple-outline" size={20} color="#fff" />
            <Text style={s.bigText}>{ready.length ? `Generate all ${ready.length} ready` : 'Nobody is ready yet'}</Text>
          </Pressable>
        </View>
      )}

      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={s.backdrop} onPress={() => setPicker(null)} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>{picker === 'school' ? 'Choose school' : picker === 'class' ? 'Choose class' : 'Choose division'}</Text>
          <ScrollView style={{ maxHeight: 380, marginTop: 10 }}>
            {pickerOpts.map(([v, l]) => {
              const on = picker === 'school' ? pickerCur?.id === v.id : pickerCur === v;
              return (
                <Pressable key={String(l)} onPress={() => { if (picker === 'school') setSchool(v); else if (picker === 'class') { setStd(v); setDiv(null); } else setDiv(v); setPicker(null); }} style={(p) => [s.opt, on && s.optOn, press(p)]}>
                  <Text style={[s.optText, on && { color: colors.primary }]}>{l}</Text>
                  {on && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                </Pressable>
              );
            })}
            {!pickerOpts.length && <Text style={s.emptyText}>Nothing to choose here yet.</Text>}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!bulk} transparent animationType="fade" onRequestClose={() => bulk?.finished && setBulk(null)}>
        <View style={s.center}>
          <View style={s.dialog}>
            <MaterialCommunityIcons name={bulk?.finished ? 'check-decagram' : 'progress-clock'} size={42} color={T?.tint || colors.primary} />
            <Text style={s.sheetTitle}>{bulk?.finished ? 'Report cards ready' : 'Making report cards...'}</Text>
            <Text style={s.emptyText}>{bulk?.finished ? `${bulk.ok.length} made${bulk.failed.length ? `, ${bulk.failed.length} could not be made` : ''}.` : `${bulk?.done || 0} of ${bulk?.total || 0}${bulk?.current ? ` · ${bulk.current}` : ''}`}</Text>
            <View style={s.bar}><View style={[s.barFill, { width: `${bulk ? Math.round((bulk.done / Math.max(1, bulk.total)) * 100) : 0}%`, backgroundColor: T?.tint || colors.primary }]} /></View>
            {bulk?.finished && (<>
              {bulk.ok.length > 0 && <Pressable onPress={() => Linking.openURL(reportCardZipUrl(bulk.ok.map((r) => r.result_id), opts))} style={(p) => [s.big, { alignSelf: 'stretch', backgroundColor: T.tint, marginTop: 14 }, press(p)]}><Ionicons name="download-outline" size={20} color="#fff" /><Text style={s.bigText}>Download all (ZIP)</Text></Pressable>}
              <Pressable onPress={() => { setBulk(null); load(); }} style={s.ghostBtn}><Text style={s.ghostText}>Close</Text></Pressable>
            </>)}
          </View>
        </View>
      </Modal>

      <Modal visible={!!fix} transparent animationType="slide" onRequestClose={() => setFix(null)}>
        <Pressable style={s.backdrop} onPress={() => setFix(null)} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>{fix?.name}: marks to fix</Text>
          <Text style={s.emptyText}>The report card can be made once these marks are filled in or inside the allowed range.</Text>
          <ScrollView style={{ maxHeight: 300, marginTop: 10 }}>
            {(fix?.check?.items || []).map((it, i) => (
              <View key={i} style={s.fixRow}>
                <Text style={s.name} numberOfLines={1}>{String(it.parameter || '').replace(/_/g, ' ')}{it.test_display ? ` · ${it.test_display}` : ''}</Text>
                <Text style={s.state}>{it.missing ? `Empty (${it.term === 'term2' ? 'Term 2' : 'Term 1'})` : `${it.parameter_value} — allowed ${it.min_score} to ${it.max_score}`}</Text>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={() => { setFix(null); goFill(); }} style={(p) => [s.big, { backgroundColor: colors.primary, marginTop: 12 }, press(p)]}><Text style={s.bigText}>Go to Fill Marks</Text></Pressable>
        </View>
      </Modal>

      <Modal visible={!!preview} transparent animationType="slide" onRequestClose={() => setPreview(null)}>
        <Pressable style={s.backdrop} onPress={() => setPreview(null)} />
        <View style={[s.sheet, { maxHeight: '88%' }]}>
          <View style={s.handle} />
          {preview?.loading ? <ActivityIndicator color={colors.primary} style={{ margin: 30 }} /> : !!preview && (<>
            <View style={[s.pvHead, { backgroundColor: T.tint }]}>
              <Text style={s.pvSchool}>{preview.data?.student?.school}</Text>
              <Text style={s.pvName}>{preview.data?.student?.name}</Text>
              <Text style={s.pvMeta}>{classLabel(preview.data?.student?.std)}-{preview.data?.student?.division} · {preview.data?.student?.mq_id || 'MQ ID pending'}</Text>
            </View>
            <ScrollView style={{ maxHeight: 330 }}>
              {(preview.data?.results || []).map((x, i) => (
                <View key={i} style={s.pvRow}>
                  <Text style={[s.name, { flex: 1 }]} numberOfLines={1}>{String(x.title).trim()}</Text>
                  <Text style={s.pvVal}>{x.mark_status || (x.parameter_value != null ? parseFloat(x.parameter_value) : '-')}</Text>
                  {!!x.grade && <View style={[s.grade, { backgroundColor: T.tint + '1F' }]}><Text style={[s.gradeText, { color: T.tint }]}>{x.grade}</Text></View>}
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable onPress={() => { const u = type === 'detail' ? detailReportPdfUrl(preview.r.result_id) : reportCardPdfUrl(preview.r.result_id, opts); Share.share({ message: `${preview.data?.student?.name} - ${T.title}: ${u}`, url: u }); }} style={(p) => [s.big, s.rowBtnAlt, { flex: 1 }, press(p)]}><Ionicons name="share-social-outline" size={20} color={colors.heading} /><Text style={[s.bigText, { color: colors.heading }]}>Share</Text></Pressable>
              <Pressable onPress={() => openOne(preview.r)} style={(p) => [s.big, { flex: 1.4, backgroundColor: T.tint }, press(p)]}><Ionicons name="download-outline" size={20} color="#fff" /><Text style={s.bigText}>Open PDF</Text></Pressable>
            </View>
          </>)}
        </View>
      </Modal>
    </View>
  );
}

const s = themed(() => ({
  steps: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  stepItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.navyLight, borderWidth: 1.5, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  stepDotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepNum: { color: colors.subtext, fontWeight: '900', fontSize: 12 },
  stepLbl: { color: colors.meta, fontSize: 11.5, fontWeight: '800' },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.cardBorder, marginRight: 4 },
  h: { color: colors.heading, fontSize: 20, fontWeight: '900', marginBottom: 12 },
  type: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.navyLight, borderRadius: 20, padding: 14, marginBottom: 12, borderWidth: 1.5, borderColor: colors.cardBorder, ...shadow },
  thumb: { width: 64, height: 84, borderRadius: 8, borderWidth: 1.5, backgroundColor: '#FFFFFF', padding: 6, gap: 5 },
  thumbHead: { height: 12, borderRadius: 3, marginBottom: 2 },
  thumbLine: { height: 5, borderRadius: 3, backgroundColor: '#E2E8F0' },
  typeTitle: { color: colors.heading, fontSize: 16, fontWeight: '900' },
  typeDesc: { color: colors.subtext, fontSize: 13, marginTop: 4, lineHeight: 18 },
  ddRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  dd: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder, ...shadow },
  ddOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  ddLabel: { fontSize: 11, fontWeight: '700', color: colors.subtext, letterSpacing: 0.4, textTransform: 'uppercase' },
  ddVal: { fontSize: 15, fontWeight: '800', color: colors.heading, marginTop: 2 },
  label: { color: colors.subtext, fontSize: 12.5, fontWeight: '800', marginBottom: 8 },
  seg: { flexDirection: 'row', backgroundColor: colors.navyLight, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: colors.cardBorder },
  segBtn: { flex: 1, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.primary },
  segText: { color: colors.heading, fontWeight: '800', fontSize: 13.5 },
  err: { color: colors.error, marginTop: 12 },
  sumRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  sum: { flex: 1, borderRadius: 16, paddingVertical: 12, alignItems: 'center' },
  sumNum: { fontSize: 22, fontWeight: '900' },
  sumLbl: { color: colors.subtext, fontSize: 11.5, fontWeight: '800', marginTop: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.navyLight, borderRadius: 18, padding: 12, marginBottom: 10, ...shadow },
  name: { color: colors.heading, fontSize: 15, fontWeight: '800' },
  state: { color: colors.meta, fontSize: 12.5, fontWeight: '700' },
  rowBtn: { minWidth: 92, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  rowBtnAlt: { backgroundColor: colors.navy, borderWidth: 1, borderColor: colors.cardBorder },
  rowBtnText: { color: '#fff', fontWeight: '900', fontSize: 13.5 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 20 },
  emptyTitle: { color: colors.heading, fontSize: 16, fontWeight: '900' },
  emptyText: { color: colors.meta, fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
  ghostBtn: { height: 46, paddingHorizontal: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  ghostText: { color: colors.primary, fontWeight: '900', fontSize: 14.5 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.navyLight, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  big: { height: 56, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  bigText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  backdrop: { flex: 1, backgroundColor: 'rgba(8,15,12,0.45)' },
  sheet: { backgroundColor: colors.navyLight, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingTop: 10, paddingBottom: 28 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.cardBorder, marginBottom: 14 },
  sheetTitle: { color: colors.heading, fontSize: 18, fontWeight: '900', marginTop: 6, textAlign: 'center' },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 56, borderRadius: 14, marginBottom: 8, backgroundColor: colors.navy },
  optOn: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  optText: { fontSize: 16, fontWeight: '700', color: colors.heading },
  center: { flex: 1, backgroundColor: 'rgba(8,15,12,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { alignSelf: 'stretch', backgroundColor: colors.navyLight, borderRadius: 24, padding: 22, alignItems: 'center', gap: 6 },
  bar: { alignSelf: 'stretch', height: 10, borderRadius: 5, backgroundColor: colors.navy, overflow: 'hidden', marginTop: 10 },
  barFill: { height: 10, borderRadius: 5 },
  fixRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  pvHead: { borderRadius: 18, padding: 16, marginBottom: 10 },
  pvSchool: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  pvName: { color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 4 },
  pvMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  pvRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  pvVal: { color: colors.heading, fontSize: 15, fontWeight: '900', minWidth: 40, textAlign: 'right' },
  grade: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, minWidth: 40, alignItems: 'center' },
  gradeText: { fontWeight: '900', fontSize: 12.5 },
}));
