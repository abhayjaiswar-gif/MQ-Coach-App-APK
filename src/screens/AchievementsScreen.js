import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform, Image, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getAchievementFeed, createAchievement, getSchools } from '../api';
import { Header, Loading, ErrorBox, Empty, Button, ui } from '../components/ui';
import { PostCard, MediaViewer, CommentsSheet, feedBg } from '../components/AchievementPost';
import { useAchievementActions } from '../hooks/useAchievementActions';

// Single feed: GET /api/school-achievements/feed (likes/comments/saves stored in backend)
export default function AchievementsScreen({ navigation }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [commentsFor, setCommentsFor] = useState(null);

  const savedCount = items.filter((a) => a.saved_by_me).length;
  const { like, save, setCommentCount } = useAchievementActions(setItems);

  const load = useCallback(async () => {
    setError('');
    try { setItems(await getAchievementFeed()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  // Reload when returning to the tab (e.g. after un-saving on the Saved screen)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.screen, { backgroundColor: feedBg() }]}>
      <Header
        title="Achievements"
        subtitle="Celebrating wins across our schools"
        right={
          <Pressable onPress={() => navigation.navigate('SavedAchievements')} style={styles.folderBtn} hitSlop={8}>
            <Ionicons name="folder-open" size={22} color="#F28C28" />
            {savedCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{savedCount > 99 ? '99+' : savedCount}</Text></View>}
          </Pressable>
        }
      />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={() => { setLoading(true); load(); }} /> : (
        <FlatList
          data={items}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={{ paddingBottom: 100, paddingTop: 4, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
          ListEmptyComponent={<Empty icon="trophy-outline" text="No achievements yet. Tap + to share one." />}
          renderItem={({ item }) => (
            <PostCard item={item} onLike={like} onSave={save} onComment={setCommentsFor} onOpen={(media, index) => setViewer({ media, index })} />
          )}
        />
      )}
      <Pressable style={styles.fab} onPress={() => setShowAdd(true)}>
        <Ionicons name="add" size={30} color="#fff" />
      </Pressable>
      <MediaViewer viewer={viewer} onClose={() => setViewer(null)} />
      <CommentsSheet item={commentsFor} onClose={() => setCommentsFor(null)} onCountChange={setCommentCount} />
      <AddAchievement visible={showAdd} user={user} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
    </View>
  );
}
function AddAchievement({ visible, user, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [schools, setSchools] = useState([]);
  const [schoolId, setSchoolId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [media, setMedia] = useState([]);
  const pickMedia = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Allow photo access to add photos.');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 10 - media.length, quality: 0.8 });
    if (!r.canceled && r.assets?.length) setMedia((m) => [...m, ...r.assets].slice(0, 10));
  };

  useEffect(() => { if (visible && !schools.length) getSchools(user).then(setSchools).catch(() => {}); }, [visible]);

  const save = async () => {
    if (!title.trim()) return setErr('Title is required');
    setSaving(true); setErr('');
    try {
      await createAchievement(user, { title: title.trim(), description, school_id: schoolId, media });
      setTitle(''); setDescription(''); setSchoolId(null); setMedia([]);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={ui.cardTitle}>Add Achievement</Text>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.heading} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={ui.label}>Title *</Text>
            <TextInput style={ui.input} value={title} onChangeText={setTitle} placeholder="e.g. Won inter-school football cup" placeholderTextColor={colors.meta} />
            <Text style={ui.label}>Description</Text>
            <TextInput style={[ui.input, { height: 90, textAlignVertical: 'top' }]} multiline value={description} onChangeText={setDescription} placeholder="Details" placeholderTextColor={colors.meta} />
            {schools.length > 0 && <Text style={ui.label}>School</Text>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {schools.map((s) => (
                <Pressable key={s.id} onPress={() => setSchoolId(schoolId === s.id ? null : s.id)} style={[styles.pill, schoolId === s.id && { backgroundColor: colors.primary }]}>
                  <Text style={styles.pillText}>{s.name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={ui.label}>Photos / Videos ({media.length}/10)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              {media.length < 10 && (
                <Pressable onPress={pickMedia} style={styles.addMedia}>
                  <Ionicons name="camera-outline" size={24} color={colors.primary} />
                  <Text style={styles.addMediaText}>Add</Text>
                </Pressable>
              )}
              {media.map((a, i) => (
                <View key={a.uri + i} style={{ marginRight: 8 }}>
                  {a.type === 'video'
                    ? <View style={[styles.mediaThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }]}><Ionicons name="play-circle" size={28} color="#fff" /></View>
                    : <Image source={{ uri: a.uri }} style={styles.mediaThumb} />}
                  <Pressable onPress={() => setMedia((m) => m.filter((_, j) => j !== i))} style={styles.removeMedia} hitSlop={8}>
                    <Ionicons name="close" size={14} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            {!!err && <Text style={[ui.errorText, { marginBottom: 10 }]}>{err}</Text>}
            <Button title="Save Achievement" onPress={save} loading={saving} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themed(() => ({
  screen: { flex: 1 },
  addMedia: { width: 76, height: 76, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addMediaText: { color: colors.primary, fontWeight: '700', fontSize: 12, marginTop: 2 },
  mediaThumb: { width: 76, height: 76, borderRadius: 12, backgroundColor: colors.placeholder },
  removeMedia: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  folderBtn: { backgroundColor: colors.navyLight, borderRadius: 14, padding: 9, borderWidth: 1, borderColor: colors.cardBorder },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#e11d48', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: colors.navy, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%', borderWidth: 1, borderColor: colors.cardBorder },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  pillText: { color: colors.heading, fontSize: 12, fontWeight: '600' },
}));
