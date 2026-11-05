import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Image, RefreshControl, Modal, StyleSheet, Linking, useWindowDimensions, TextInput, ActivityIndicator, Alert, BackHandler, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors, themed } from '../theme/colors';
import { getSchoolGallery, getSchool, fileUrl, uploadGalleryPhotos } from '../api';
import { Header, Loading, ErrorBox, Empty, ui, formatDate } from '../components/ui';

const isVideo = (t) => /video|mp4|webm|mov|m4v|avi/.test(String(t || '').toLowerCase());

// Mirrors SchoolGalleryDetailPage.vue: GET /api/schools/:id + /api/school-gallery/:id
export default function GalleryDetailScreen({ route, navigation }) {
  const { schoolId, name, embedded } = route.params;
  const { width } = useWindowDimensions();
  const size = (width - 16 * 2 - 8 * 2) / 3;
  const [school, setSchool] = useState(null);
  const [items, setItems] = useState([]);
  const [album, setAlbum] = useState(null); // selected event name
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState(null);
  const [picked, setPicked] = useState(null); // assets waiting for an event name
  const [eventName, setEventName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [newEvent, setNewEvent] = useState(null); // null = closed, string = typing

  const pickPhotos = async (presetName) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Allow photo access to add photos.');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 20, quality: 0.8 });
    if (r.canceled || !r.assets?.length) return;
    setEventName(typeof presetName === 'string' ? presetName : album && album !== 'Other Photos' ? album : '');
    setPicked(r.assets);
  };
  const doUpload = async () => {
    const ev = eventName.trim();
    if (!ev) return Alert.alert('Event name', 'Pick or type an event, e.g. Sports Day.');
    setUploading(true);
    try {
      await uploadGalleryPhotos(schoolId, picked, ev);
      setPicked(null); setAlbum(ev); await load();
    } catch (e) { Alert.alert('Upload failed', e.message); }
    finally { setUploading(false); }
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, g] = await Promise.all([getSchool(schoolId).catch(() => null), getSchoolGallery(schoolId)]);
      setSchool(s); setItems(g);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);

  // Group photos into event albums by caption (e.g. "Sports Day"); uncaptioned go to "Other Photos"
  const albums = useMemo(() => {
    const map = new Map();
    items.forEach((i) => {
      const key = String(i.caption || i.category || '').trim() || 'Other Photos';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    });
    return Array.from(map, ([title, list]) => ({
      title, list,
      cover: list.find((x) => !isVideo(x.file_type)),
      latest: list.reduce((d, x) => (x.uploaded_at > d ? x.uploaded_at : d), ''),
    })).sort((a, b) => (a.title === 'Other Photos') - (b.title === 'Other Photos') || String(b.latest).localeCompare(String(a.latest)));
  }, [items]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (album) { setAlbum(null); return true; } return false; });
    return () => sub.remove();
  }, [album]);
  const current = album ? albums.find((a) => a.title === album) : null;
  const cardW = (width - 16 * 2 - 12) / 2;
  const refresh = <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />;

  return (
    <View style={ui.screen}>
      <Header
        title={current ? current.title : (school?.name || name)}
        subtitle={current ? `${school?.name || name}  •  ${current.list.length} photos & videos` : `${albums.length} events  •  ${items.length} photos & videos`}
        onBack={current ? () => setAlbum(null) : embedded ? undefined : () => navigation.goBack()}
      />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={() => { setLoading(true); load(); }} /> : !current ? (
        <FlatList
          key="albums"
          data={albums}
          keyExtractor={(a) => a.title}
          numColumns={2}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30, flexGrow: 1 }}
          columnWrapperStyle={{ gap: 12, marginBottom: 12 }}
          refreshControl={refresh}
          ListHeaderComponent={
            <Pressable style={styles.newEvent} onPress={() => setNewEvent('')}>
              <View style={styles.newIcon}><Ionicons name="add" size={22} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.albumTitle}>Create New Event</Text>
                <Text style={styles.albumMeta}>e.g. Sports Day, Annual Function</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.meta} />
            </Pressable>
          }
          ListEmptyComponent={<Empty icon="images-outline" text="No event galleries yet." />}
          renderItem={({ item: a }) => (
            <Pressable style={[styles.album, { width: cardW }]} onPress={() => setAlbum(a.title)}>
              {a.cover ? <Image source={{ uri: fileUrl(a.cover.file_path) }} style={styles.albumImg} />
                : <View style={[styles.albumImg, styles.video]}><Ionicons name="play-circle" size={36} color={colors.primary} /></View>}
              <View style={styles.countBadge}><Ionicons name="images" size={11} color="#fff" /><Text style={styles.countText}>{a.list.length}</Text></View>
              <View style={{ padding: 10 }}>
                <Text style={styles.albumTitle} numberOfLines={1}>{a.title}</Text>
                <Text style={styles.albumMeta} numberOfLines={1}>{a.latest ? formatDate(a.latest) : `${a.list.length} items`}</Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          key="photos"
          data={current.list}
          keyExtractor={(i) => String(i.id)}
          numColumns={3}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30, flexGrow: 1 }}
          columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
          refreshControl={refresh}
          ListEmptyComponent={<Empty icon="image-outline" text="No photos in this event yet." />}
          renderItem={({ item }) => (
            <Pressable onPress={() => isVideo(item.file_type) ? Linking.openURL(fileUrl(item.file_path)) : setViewer(item)}>
              {isVideo(item.file_type) ? (
                <View style={[styles.thumb, { width: size, height: size }, styles.video]}><Ionicons name="play-circle" size={34} color="#fff" /></View>
              ) : (
                <Image source={{ uri: fileUrl(item.file_path) }} style={[styles.thumb, { width: size, height: size }]} />
              )}
            </Pressable>
          )}
        />
      )}
      <Pressable style={styles.fab} onPress={() => pickPhotos()}><Ionicons name="add" size={30} color="#fff" /></Pressable>

      <Modal visible={!!picked} transparent animationType="slide" onRequestClose={() => !uploading && setPicked(null)}>
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add {picked?.length || 0} {picked?.length === 1 ? 'item' : 'items'} to event</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
              {(picked || []).map((a, i) => <Image key={i} source={{ uri: a.uri }} style={styles.prev} />)}
            </ScrollView>
            <Text style={styles.sheetLabel}>Event</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {albums.filter((a) => a.title !== 'Other Photos').map((a) => (
                <Pressable key={a.title} onPress={() => setEventName(a.title)} style={[styles.cat, eventName === a.title && { backgroundColor: colors.primary }]}>
                  <Text style={[styles.catText, eventName === a.title && { color: '#fff' }]}>{a.title}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={eventName} onChangeText={setEventName} placeholder="Or type a new event, e.g. Sports Day 2026" placeholderTextColor={colors.meta} style={styles.input} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable disabled={uploading} onPress={() => setPicked(null)} style={[styles.btn, styles.btnGhost]}><Text style={[styles.btnText, { color: colors.heading }]}>Cancel</Text></Pressable>
              <Pressable disabled={uploading} onPress={doUpload} style={styles.btn}>{uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Upload</Text>}</Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={newEvent !== null} transparent animationType="fade" onRequestClose={() => setNewEvent(null)}>
        <View style={[styles.sheetWrap, { justifyContent: 'center', padding: 24 }]}>
          <View style={[styles.sheet, { borderRadius: 24, paddingBottom: 20 }]}>
            <Text style={styles.sheetTitle}>New Event</Text>
            <Text style={[styles.albumMeta, { marginTop: 4 }]}>Name the event, then choose its photos.</Text>
            <TextInput autoFocus value={newEvent || ''} onChangeText={setNewEvent} placeholder="Event name, e.g. Sports Day 2026" placeholderTextColor={colors.meta} style={styles.input} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => setNewEvent(null)} style={[styles.btn, styles.btnGhost]}><Text style={[styles.btnText, { color: colors.heading }]}>Cancel</Text></Pressable>
              <Pressable onPress={() => { const n = String(newEvent || '').trim(); if (!n) return Alert.alert('Event name', 'Please type an event name.'); setNewEvent(null); pickPhotos(n); }} style={styles.btn}><Text style={styles.btnText}>Add Photos</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewer}>
          <Pressable style={styles.close} onPress={() => setViewer(null)} hitSlop={12}><Ionicons name="close" size={28} color="#fff" /></Pressable>
          {viewer && <Image source={{ uri: fileUrl(viewer.file_path) }} style={{ width: '100%', height: '70%' }} resizeMode="contain" />}
          {viewer && <Text style={styles.cap}>{[viewer.caption || viewer.category, viewer.description, formatDate(viewer.uploaded_at)].filter(Boolean).join('  |  ')}</Text>}
        </View>
      </Modal>
    </View>
  );
}

const styles = themed(() => ({
  thumb: { borderRadius: 12, backgroundColor: colors.navyLight },
  video: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.placeholder },
  album: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.navyLight, borderWidth: 1, borderColor: colors.cardBorder },
  albumImg: { width: '100%', aspectRatio: 1.1, backgroundColor: colors.placeholder },
  albumTitle: { color: colors.heading, fontWeight: '800', fontSize: 15 },
  albumMeta: { color: colors.meta, fontSize: 12, marginTop: 2 },
  countBadge: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  countText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  newEvent: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 12, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.primarySoft },
  newIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.navyLight, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: colors.navyLight, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 },
  sheetTitle: { color: colors.heading, fontSize: 18, fontWeight: '800' },
  sheetLabel: { color: colors.subtext, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  prev: { width: 64, height: 64, borderRadius: 10, marginRight: 8, backgroundColor: colors.placeholder },
  input: { marginTop: 12, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.heading, backgroundColor: colors.inputBg },
  btn: { flex: 1, backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.cardBorder },
  btnText: { color: '#fff', fontWeight: '800' },
  cat: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.navyLight, marginRight: 8 },
  catText: { color: colors.subtext, fontWeight: '600', fontSize: 13 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  close: { position: 'absolute', top: 50, right: 20 },
  cap: { color: colors.subtext, marginTop: 16, paddingHorizontal: 20, textAlign: 'center' },
}));


