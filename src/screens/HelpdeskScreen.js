import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, Modal, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getMyFeedback, sendFeedback, raiseTicket, getSchools } from '../api';
import { Header, Loading, ErrorBox, Empty, Button, Segmented, ui, formatDate } from '../components/ui';

// Mirrors UserFeedback.vue (list) + RaiseTicketCard/SupportDetailsModal (POST /api/support/ticket)
// and FeedbackSection (POST /api/support/feedback).
export default function HelpdeskScreen({ navigation, route }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // 'ticket' | 'feedback'
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setItems(await getMyFeedback(user)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={ui.screen}>
      <Header title="Help & Support" subtitle="We usually reply within a day" onBack={route?.name === 'HelpdeskPage' ? () => navigation.goBack() : undefined} />
      <FlatList
        data={loading || error ? [] : items}
        keyExtractor={(f) => String(f.id)}
        contentContainerStyle={{ paddingBottom: 30, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
        ListHeaderComponent={
          <>
            <View style={styles.hero}>
              <View style={styles.live}><View style={styles.dot} /><Text style={styles.liveText}>Success team online</Text></View>
              <Text style={styles.heroTitle}>Need help?</Text>
              <Text style={styles.heroText}>Connect with our success team for help with curriculum, technical setup, or school coordination.</Text>
              <Button title="Message Success Team" onPress={() => setForm('ticket')} style={{ marginTop: 14 }} />
              <Pressable onPress={() => setForm('feedback')} style={{ alignItems: 'center', marginTop: 12 }}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Send feedback</Text>
              </Pressable>
            </View>
            {!!toast && <Text style={styles.toast}>{toast}</Text>}
            <Text style={ui.section}>My Feedback</Text>
            {loading && <Loading />}
            {!!error && <ErrorBox message={error} onRetry={() => { setLoading(true); load(); }} />}
          </>
        }
        ListEmptyComponent={!loading && !error ? <Empty icon="chatbubbles-outline" text="You have not sent any feedback yet." /> : null}
        renderItem={({ item }) => (
          <View style={ui.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={ui.chip}><Text style={ui.chipText}>{item.subject || 'General'}</Text></View>
              <Text style={ui.meta}>{formatDate(item.created_at)}</Text>
            </View>
            <Text style={[ui.cardText, { marginTop: 10 }]}>{item.message}</Text>
          </View>
        )}
      />
      <SupportForm
        mode={form}
        user={user}
        onClose={() => setForm(null)}
        onSent={(msg) => { setForm(null); setToast(msg); setTimeout(() => setToast(''), 4000); load(); }}
      />
    </View>
  );
}

const SUBJECTS = ['Curriculum', 'Technical', 'School Coordination', 'Stock', 'Other'];

function SupportForm({ mode, user, onClose, onSent }) {
  const [type, setType] = useState('ticket');
  const [schools, setSchools] = useState([]);
  const [schoolId, setSchoolId] = useState(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!mode) return;
    setType(mode); setErr('');
    if (!schools.length) getSchools(user).then((s) => { setSchools(s); if (s.length === 1) setSchoolId(s[0].id); }).catch(() => {});
  }, [mode]);

  const submit = async () => {
    if (!subject.trim() || !message.trim()) return setErr('Subject and message are required');
    setSending(true); setErr('');
    try {
      if (type === 'ticket') {
        await raiseTicket(user, { school_id: schoolId, subject: subject.trim(), message: message.trim() });
        onSent('Message sent! Our success team will reach out to you shortly.');
      } else {
        await sendFeedback(user, { subject: subject.trim(), message: message.trim() });
        onSent('Thanks! Your feedback was submitted.');
      }
      setSubject(''); setMessage('');
    } catch (e) { setErr(e.message); }
    finally { setSending(false); }
  };

  return (
    <Modal visible={!!mode} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={ui.cardTitle}>{type === 'ticket' ? 'Raise a Ticket' : 'Send Feedback'}</Text>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.heading} /></Pressable>
          </View>
          <Segmented value={type} onChange={setType} options={[{ value: 'ticket', label: 'Ticket' }, { value: 'feedback', label: 'Feedback' }]} />
          <ScrollView keyboardShouldPersistTaps="handled">
            {type === 'ticket' && schools.length > 0 && (
              <>
                <Text style={ui.label}>School</Text>
                <View style={styles.pills}>
                  {schools.map((s) => (
                    <Pressable key={s.id} onPress={() => setSchoolId(s.id)} style={[styles.pill, schoolId === s.id && { backgroundColor: colors.primary }]}>
                      <Text style={styles.pillText}>{s.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            <Text style={ui.label}>Subject</Text>
            <View style={styles.pills}>
              {SUBJECTS.map((s) => (
                <Pressable key={s} onPress={() => setSubject(s)} style={[styles.pill, subject === s && { backgroundColor: colors.primary }]}>
                  <Text style={styles.pillText}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={ui.input} value={subject} onChangeText={setSubject} placeholder="Or type a subject" placeholderTextColor={colors.meta} />
            <Text style={ui.label}>Message</Text>
            <TextInput style={[ui.input, { height: 110, textAlignVertical: 'top' }]} multiline value={message} onChangeText={setMessage} placeholder="Describe your issue" placeholderTextColor={colors.meta} />
            <Text style={[ui.meta, { marginBottom: 12 }]}>Sending as {user.name} ({user.email})</Text>
            {!!err && <Text style={[ui.errorText, { marginBottom: 10 }]}>{err}</Text>}
            <Button title={type === 'ticket' ? 'Submit Ticket' : 'Send Feedback'} onPress={submit} loading={sending} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themed(() => ({
  hero: { margin: 16, marginTop: 4, padding: 18, borderRadius: 22, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  liveText: { color: colors.success, fontSize: 12, fontWeight: '700' },
  heroTitle: { color: colors.heading, fontSize: 22, fontWeight: '800', marginTop: 8 },
  heroText: { color: colors.subtext, fontSize: 13, marginTop: 6, lineHeight: 19 },
  toast: { marginHorizontal: 16, backgroundColor: colors.successSoft, color: colors.success, padding: 12, borderRadius: 12, fontWeight: '700' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: colors.navy, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%', borderWidth: 1, borderColor: colors.cardBorder },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  pillText: { color: colors.heading, fontSize: 12, fontWeight: '600' },
}));