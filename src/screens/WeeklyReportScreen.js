import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert, Image, Modal, TextInput, KeyboardAvoidingView, Platform, RefreshControl, Linking } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { API_URL, getReportSchools, getReportFilters, getReportData, publishWeeklyReport, weeklyReportPdfUrl } from '../api';
import { Header } from '../components/ui';
import { Avatar, sportIcon, press, shadow } from '../components/teams';

// Port of web WeeklyReportPage (/curriculum/weekly-report): school -> week -> report; publish to principal by email.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parseMY = (my) => { const [m, y] = String(my).split(','); return { m: MON.findIndex((x) => x.toLowerCase() === String(m).trim().slice(0, 3).toLowerCase()), y: Number(y) }; };
const wNum = (w) => Number(String(w).match(/\d+/)?.[0] || 0);
const fmt = (d) => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : `${x.getDate()} ${MON[x.getMonth()]}`; };
const fmtTime = (t) => (t ? String(t).slice(0, 5) : '');
const img = (p) => (p ? (/^https?:/.test(p) ? p : `${API_URL}${p.startsWith('/') ? '' : '/'}${p}`) : null);
const RATING = { EXCELLENT: ['#16A34A', 'Excellent'], GOOD: ['#2563EB', 'Good'], AVERAGE: ['#D97706', 'Average'], POOR: ['#DC2626', 'Needs work'] };
const INDIGO = '#4F46E5';

export default function WeeklyReportScreen({ navigation }) {
  const { user } = useAuth();
  const [schools, setSchools] = useState([]);
  const [school, setSchool] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [idx, setIdx] = useState(-1);
  const [report, setReport] = useState(null);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [picker, setPicker] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => { (async () => {
    try { const sc = await getReportSchools(user); setSchools(sc); if (sc.length) setSchool(sc[0]); }
    catch (e) { Alert.alert('Could not load', e.message); }
    finally { setBooting(false); }
  })(); }, []);

  const loadWeeks = async (sc, keep) => {
    const f = await getReportFilters(sc.id);
    const list = [];
    Object.entries(f.filters).forEach(([my, ws]) => (ws || []).forEach((w) => list.push({ my, w, range: f.ranges?.[my]?.[w] })));
    list.sort((a, b) => { const A = parseMY(a.my), B = parseMY(b.my); return A.y - B.y || A.m - B.m || wNum(a.w) - wNum(b.w); });
    setWeeks(list); setStatuses(f.statuses);
    if (keep) return list;
    // Current week: the one whose dates include today, else this month's latest, else the newest.
    const now = new Date(); const t = now.getTime();
    let i = list.findIndex((x) => x.range && t >= new Date(x.range.start_date).setHours(0, 0, 0, 0) && t <= new Date(x.range.end_date).setHours(23, 59, 59, 999));
    if (i < 0) { const cm = list.map((x, j) => [x, j]).filter(([x]) => { const p = parseMY(x.my); return p.m === now.getMonth() && p.y === now.getFullYear(); }); i = cm.length ? cm[cm.length - 1][1] : list.length - 1; }
    setIdx(i);
    return list;
  };

  useEffect(() => { if (!school) return; setReport(null); setIdx(-1); loadWeeks(school).catch((e) => Alert.alert('Could not load weeks', e.message)); }, [school]);

  const wk = weeks[idx];
  const loadReport = async () => {
    if (!school || !wk) return;
    try { setReport(await getReportData(school.id, wk.my, wk.w)); }
    catch (e) { Alert.alert('Could not load report', e.message); }
  };
  useEffect(() => { if (!wk) return; setShowAll(false); setLoading(true); loadReport().finally(() => setLoading(false)); }, [idx, weeks]);

  const stats = useMemo(() => {
    if (!report) return null;
    const areas = (report.sports_reports || []).flatMap((s) => s.key_areas || []);
    const done = areas.filter((a) => /complete/i.test(a.status || '')).length;
    const photos = (report.sports_reports || []).reduce((n, s) => n + (s.gallery || []).length, 0);
    return { sessions: report.total_sessions || 0, coaches: (report.summary || []).length, sports: (report.sports_reports || []).length, areas: areas.length, done, photos };
  }, [report]);

  const published = !!report?.is_published;
  const status = wk ? statuses?.[wk.my]?.[wk.w] : null;

  const publish = () => {
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return Alert.alert('Check the email', "Please enter the principal's email address.");
    Alert.alert('Send report?', `The ${wk.w} report (${wk.my.replace(',', ' ')}) will be marked as published and emailed to ${e}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        setPublishing(true);
        try {
          await publishWeeklyReport(user, { school_id: school.id, month_year: wk.my, week_no: wk.w, email: e, school_name: school.name });
          setPublishOpen(false); setEmail('');
          await loadWeeks(school, true); await loadReport();
          Alert.alert('Report sent', `Published and emailed to ${e}.`);
        } catch (err) { Alert.alert('Could not publish', err.message); }
        finally { setPublishing(false); }
      } },
    ]);
  };

  const Stat = ({ icon, label, value, tint }) => (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: tint + '1F' }]}><MaterialCommunityIcons name={icon} size={20} color={tint} /></View>
      <Text style={s.statVal}>{value}</Text>
      <Text style={s.statLbl}>{label}</Text>
    </View>
  );

  const weekLabel = wk ? `${wk.w} · ${wk.my.replace(',', ' ')}` : 'No weeks yet';
  const rangeLabel = wk?.range ? `${fmt(wk.range.start_date)} – ${fmt(wk.range.end_date)}` : '';
  const sessions = report?.all_sessions || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.navy }}>
      <Header title="Weekly Report" subtitle={school?.name || 'Curriculum'} onBack={() => navigation.goBack()} />
      {booting ? <ActivityIndicator color={INDIGO} style={{ marginTop: 40 }} /> : !schools.length ? (
        <View style={s.empty}><Ionicons name="document-text-outline" size={36} color={colors.iconMuted} /><Text style={s.emptyText}>No schools with reports yet.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={refreshing} tintColor={INDIGO} colors={[INDIGO]} onRefresh={async () => { setRefreshing(true); await loadReport(); setRefreshing(false); }} />}>
          {schools.length > 1 && (
            <Pressable onPress={() => setPicker('school')} style={(p) => [s.dd, press(p)]}>
              <View style={{ flex: 1 }}><Text style={s.ddLabel}>School</Text><Text style={s.ddVal} numberOfLines={1}>{school?.name}</Text></View>
              <Ionicons name="chevron-down" size={20} color={INDIGO} />
            </Pressable>
          )}

          <View style={s.weekBar}>
            <Pressable hitSlop={8} disabled={idx <= 0} onPress={() => setIdx(idx - 1)} style={[s.arrow, idx <= 0 && { opacity: 0.3 }]}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
            <Pressable disabled={!weeks.length} onPress={() => setPicker('week')} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={s.weekTitle}>{weekLabel}</Text>
              {!!rangeLabel && <Text style={s.weekSub}>{rangeLabel}</Text>}
            </Pressable>
            <Pressable hitSlop={8} disabled={idx >= weeks.length - 1} onPress={() => setIdx(idx + 1)} style={[s.arrow, idx >= weeks.length - 1 && { opacity: 0.3 }]}><Ionicons name="chevron-forward" size={22} color="#fff" /></Pressable>
          </View>

          {loading ? <ActivityIndicator color={INDIGO} style={{ marginTop: 30 }} /> : !report ? (
            <View style={s.empty}><Ionicons name="calendar-outline" size={34} color={colors.iconMuted} /><Text style={s.emptyText}>{weeks.length ? 'No report for this week.' : 'Reports show up here once coaches mark lessons.'}</Text></View>
          ) : (<>
            <View style={[s.status, published ? s.statusOk : s.statusDraft]}>
              <Ionicons name={published ? 'checkmark-circle' : 'time-outline'} size={18} color={published ? '#16A34A' : '#D97706'} />
              <Text style={[s.statusText, { color: published ? '#16A34A' : '#D97706' }]}>
                {published ? `Published${report.published_at || status?.published_at ? ` on ${fmt(report.published_at || status?.published_at)}` : ''}${report.recipient_email ? ` · sent to ${report.recipient_email}` : ''}` : 'Not sent to the principal yet'}
              </Text>
            </View>

            <View style={s.stats}>
              <Stat icon="whistle-outline" label="Sessions" value={stats.sessions} tint={INDIGO} />
              <Stat icon="account-tie-outline" label="Coaches" value={stats.coaches} tint="#0EA5E9" />
              <Stat icon="basketball" label="Sports" value={stats.sports} tint="#EA7A0C" />
              <Stat icon="check-decagram-outline" label="Topics done" value={`${stats.done}/${stats.areas}`} tint="#16A34A" />
            </View>

            {(report.summary || []).length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Coaches this week</Text>
                {report.summary.map((c, i) => (
                  <View key={i} style={[s.coachRow, i > 0 && s.divider]}>
                    <Avatar name={c.coach} size={36} />
                    <View style={{ flex: 1 }}><Text style={s.coachName}>{String(c.coach).trim()}</Text><Text style={s.meta}>{String(c.sports || '').trim()}</Text></View>
                    <View style={s.countPill}><Text style={s.countText}>{c.total_lectures} sessions</Text></View>
                  </View>
                ))}
              </View>
            )}

            {(report.sports_reports || []).map((sp, i) => (
              <View key={i} style={s.card}>
                <View style={s.spHead}>
                  <View style={s.spIcon}><MaterialCommunityIcons name={sportIcon(sp.sport)} size={22} color={INDIGO} /></View>
                  <View style={{ flex: 1 }}><Text style={s.cardTitle}>{sp.sport}</Text><Text style={s.meta}>{String(sp.coach_name || '').trim()} · {sp.sessions_count || 0} sessions</Text></View>
                  {sp.coach_avatar ? <Image source={{ uri: img(sp.coach_avatar) }} style={s.coachImg} /> : null}
                </View>
                {!!sp.overview && <Text style={s.overview}>{sp.overview}</Text>}
                {(sp.key_areas || []).map((a, j) => {
                  const r = RATING[String(a.rating || '').toUpperCase()];
                  return (
                    <View key={a.tracking_id || j} style={s.area}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={s.areaName} numberOfLines={1}>{a.name}</Text>
                        <Text style={s.areaClass}>Class {a.grade}{a.divisions ? `-${a.divisions}` : ''}</Text>
                        {r && <View style={[s.rate, { backgroundColor: r[0] + '1F' }]}><Text style={[s.rateText, { color: r[0] }]}>{r[1]}</Text></View>}
                      </View>
                      {!!a.objective && <Text style={s.areaObj} numberOfLines={3}>{a.objective}</Text>}
                      {!!a.remark && <Text style={s.areaRemark}>“{a.remark}”</Text>}
                    </View>
                  );
                })}
                {(sp.gallery || []).length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
                    {sp.gallery.map((g, k) => {
                      const u = img(typeof g === 'string' ? g : g?.path || g?.url);
                      if (!u) return null;
                      return /\.(mp4|mov|webm|mkv)$/i.test(u)
                        ? <View key={k} style={[s.thumb, s.video]}><Ionicons name="play" size={22} color="#fff" /></View>
                        : <Pressable key={k} onPress={() => setPhoto(u)}><Image source={{ uri: u }} style={s.thumb} /></Pressable>;
                    })}
                  </ScrollView>
                )}
              </View>
            ))}

            {sessions.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>All sessions ({sessions.length})</Text>
                {(showAll ? sessions : sessions.slice(0, 5)).map((x, i) => (
                  <View key={x.id || i} style={[s.sess, i > 0 && s.divider]}>
                    <View style={s.sessDate}><Text style={s.sessDay}>{fmt(x.lecture_date || x.date)}</Text><Text style={s.meta}>{fmtTime(x.start_time)}</Text></View>
                    <View style={{ flex: 1 }}><Text style={s.coachName}>{String(x.sport || '').trim()} · Class {x.grade}{x.division ? `-${x.division}` : ''}</Text><Text style={s.meta} numberOfLines={1}>{String(x.coach_name || x.coach || '').trim()}{x.skill && x.skill !== 'Manual Entry' ? ` · ${x.skill}` : ''}</Text></View>
                    <Ionicons name={/complete/i.test(x.status || '') ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={/complete/i.test(x.status || '') ? '#16A34A' : colors.iconMuted} />
                  </View>
                ))}
                {sessions.length > 5 && <Pressable onPress={() => setShowAll(!showAll)} style={s.more}><Text style={s.moreText}>{showAll ? 'Show less' : `Show all ${sessions.length}`}</Text></Pressable>}
              </View>
            )}
          </>)}
        </ScrollView>
      )}

      {!!report && (
        <View style={s.footer}>
          <Pressable
            onPress={() => {
              if (!school || !wk) return;
              const url = weeklyReportPdfUrl({ schoolId: school.id, monthYear: wk.my, weekNo: wk.w });
              Linking.openURL(url).catch(() => Alert.alert('Could not open PDF', url));
            }}
            style={(p) => [s.pdfBtn, press(p)]}
          >
            <Ionicons name="document-text-outline" size={19} color={INDIGO} />
            <Text style={s.pdfBtnText}>View / Download PDF</Text>
          </Pressable>
          {published ? (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="mail-open-outline" size={22} color="#16A34A" />
              <Text style={[s.meta, { flex: 1, fontSize: 13 }]}>This week is already published{report.recipient_email ? ` to ${report.recipient_email}` : ''}.</Text>
            </View>
          ) : (
            <Pressable onPress={() => setPublishOpen(true)} style={(p) => [s.submit, { flex: 1 }, press(p)]}>
              <Ionicons name="paper-plane" size={19} color="#fff" /><Text style={s.submitText}>Send to principal</Text>
            </Pressable>
          )}
        </View>
      )}

      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={s.backdrop} onPress={() => setPicker(null)} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>{picker === 'school' ? 'Choose school' : 'Choose week'}</Text>
          <ScrollView style={{ maxHeight: 420, marginTop: 10 }}>
            {picker === 'school' ? schools.map((x) => (
              <Pressable key={x.id} onPress={() => { setSchool(x); setPicker(null); }} style={(p) => [s.opt, school?.id === x.id && s.optOn, press(p)]}>
                <Text style={[s.optText, school?.id === x.id && { color: INDIGO }]}>{x.name}</Text>
                {school?.id === x.id && <Ionicons name="checkmark-circle" size={22} color={INDIGO} />}
              </Pressable>
            )) : [...weeks].map((x, i) => [x, i]).reverse().map(([x, i]) => {
              const st = statuses?.[x.my]?.[x.w];
              return (
                <Pressable key={`${x.my}-${x.w}`} onPress={() => { setIdx(i); setPicker(null); }} style={(p) => [s.opt, idx === i && s.optOn, press(p)]}>
                  <View style={{ flex: 1 }}><Text style={[s.optText, idx === i && { color: INDIGO }]}>{x.w} · {x.my.replace(',', ' ')}</Text>{!!x.range && <Text style={s.meta}>{fmt(x.range.start_date)} – {fmt(x.range.end_date)}{st?.total_lessons ? ` · ${st.total_lessons} lessons` : ''}</Text>}</View>
                  <View style={[s.tag, { backgroundColor: st?.is_published ? '#16A34A1F' : '#D977061F' }]}><Text style={[s.tagText, { color: st?.is_published ? '#16A34A' : '#D97706' }]}>{st?.is_published ? 'Sent' : 'Draft'}</Text></View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={publishOpen} transparent animationType="slide" onRequestClose={() => setPublishOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setPublishOpen(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>Send to principal</Text>
          <Text style={s.sheetSub}>{wk?.w} · {wk?.my.replace(',', ' ')} · {stats?.sessions || 0} sessions. The principal gets an email and the week is marked as published.</Text>
          <Text style={s.label}>Principal's email</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="principal@school.com" placeholderTextColor={colors.iconMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={s.input} />
          <Pressable disabled={publishing} onPress={publish} style={(p) => [s.submit, { marginTop: 6 }, publishing && { opacity: 0.6 }, press(p)]}>
            {publishing ? <ActivityIndicator color="#fff" /> : <><Ionicons name="paper-plane" size={19} color="#fff" /><Text style={s.submitText}>Publish & send</Text></>}
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!photo} transparent animationType="fade" onRequestClose={() => setPhoto(null)}>
        <Pressable style={s.viewer} onPress={() => setPhoto(null)}>{!!photo && <Image source={{ uri: photo }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}</Pressable>
      </Modal>
    </View>
  );
}

const s = themed(() => ({
  dd: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder, marginBottom: 12, ...shadow },
  ddLabel: { fontSize: 11, fontWeight: '700', color: colors.subtext, letterSpacing: 0.4, textTransform: 'uppercase' },
  ddVal: { fontSize: 15, fontWeight: '800', color: colors.heading, marginTop: 2 },
  weekBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: INDIGO, borderRadius: 999, padding: 6, marginBottom: 14, shadowColor: INDIGO, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  arrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  weekTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  weekSub: { color: '#E0E7FF', fontSize: 12, marginTop: 1, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, marginBottom: 12 },
  statusOk: { backgroundColor: 'rgba(22,163,74,0.12)' },
  statusDraft: { backgroundColor: 'rgba(217,119,6,0.12)' },
  statusText: { flex: 1, fontSize: 13, fontWeight: '800' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 12 },
  stat: { width: '48.5%', backgroundColor: colors.navyLight, borderRadius: 18, padding: 14, ...shadow },
  statIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statVal: { color: colors.heading, fontSize: 24, fontWeight: '900' },
  statLbl: { color: colors.meta, fontSize: 12.5, fontWeight: '700', marginTop: 1 },
  card: { backgroundColor: colors.navyLight, borderRadius: 18, padding: 14, marginBottom: 12, ...shadow },
  cardTitle: { color: colors.heading, fontSize: 16, fontWeight: '900' },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.cardBorder },
  coachName: { color: colors.heading, fontSize: 14, fontWeight: '800' },
  meta: { color: colors.meta, fontSize: 12, marginTop: 1 },
  countPill: { backgroundColor: 'rgba(79,70,229,0.12)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  countText: { color: INDIGO, fontWeight: '800', fontSize: 12 },
  spHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  spIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(79,70,229,0.12)', alignItems: 'center', justifyContent: 'center' },
  coachImg: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.navy },
  overview: { color: colors.subtext, fontSize: 13, lineHeight: 18, marginBottom: 6 },
  area: { backgroundColor: colors.navy, borderRadius: 12, padding: 10, marginTop: 6 },
  areaName: { flexShrink: 1, color: colors.heading, fontSize: 13.5, fontWeight: '800' },
  areaClass: { color: colors.meta, fontSize: 12, fontWeight: '700' },
  rate: { marginLeft: 'auto', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  rateText: { fontSize: 11, fontWeight: '900' },
  areaObj: { color: colors.subtext, fontSize: 12.5, marginTop: 4, lineHeight: 17 },
  areaRemark: { color: colors.meta, fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  thumb: { width: 86, height: 86, borderRadius: 12, backgroundColor: colors.navy },
  video: { backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  sess: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  sessDate: { width: 56 },
  sessDay: { color: colors.heading, fontSize: 13, fontWeight: '900' },
  more: { alignItems: 'center', paddingTop: 10 },
  moreText: { color: INDIGO, fontWeight: '900', fontSize: 13 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { color: colors.meta, fontSize: 14, textAlign: 'center' },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5, borderColor: INDIGO, backgroundColor: '#EEF2FF' },
  pdfBtnText: { color: INDIGO, fontWeight: '700', fontSize: 14 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.navyLight, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  submit: { flex: 1, height: 54, borderRadius: 999, backgroundColor: INDIGO, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  backdrop: { flex: 1, backgroundColor: 'rgba(8,15,12,0.45)' },
  sheet: { backgroundColor: colors.navyLight, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingTop: 10, paddingBottom: 28 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.cardBorder, marginBottom: 14 },
  sheetTitle: { color: colors.heading, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.meta, fontSize: 13, marginTop: 4, marginBottom: 14, lineHeight: 18 },
  label: { color: colors.subtext, fontSize: 12.5, fontWeight: '800', marginBottom: 6 },
  input: { backgroundColor: colors.navy, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: colors.text, marginBottom: 12 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 58, borderRadius: 14, marginBottom: 8, backgroundColor: colors.navy },
  optOn: { backgroundColor: 'rgba(79,70,229,0.12)', borderWidth: 1, borderColor: INDIGO },
  optText: { fontSize: 15.5, fontWeight: '700', color: colors.heading },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  tagText: { fontSize: 11.5, fontWeight: '900' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
}));
