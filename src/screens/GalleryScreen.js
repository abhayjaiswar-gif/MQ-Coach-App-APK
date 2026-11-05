import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, Image, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { getGallerySchools, getSchools, fileUrl } from '../api';
import { Header, Loading, ErrorBox, Empty, ui } from '../components/ui';
import GalleryDetailScreen from './GalleryDetailScreen';

export default function GalleryScreen({ navigation }) {
  const { user } = useAuth();
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      // All schools assigned to this user, merged with gallery counts/images
      const [assigned, withGallery] = await Promise.all([getSchools(user).catch(() => []), getGallerySchools(user).catch(() => [])]);
      const g = new Map(withGallery.map((s) => [String(s.id), s]));
      const list = (assigned.length ? assigned : withGallery).map((s) => ({ ...s, ...(g.get(String(s.id)) || {}), name: s.name || s.school_name }));
      setSchools(list);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  // One school (typical coach): skip the school card and show its event albums directly
  if (!loading && !error && schools.length === 1) {
    return <GalleryDetailScreen navigation={navigation} route={{ params: { schoolId: schools[0].id, name: schools[0].name, embedded: true } }} />;
  }

  return (
    <View style={ui.screen}>
      <Header title="School Gallery" subtitle="Photos & videos from your schools" />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={() => { setLoading(true); load(); }} /> : (
        <FlatList
          data={schools}
          keyExtractor={(s) => String(s.id)}
          numColumns={2}
          columnWrapperStyle={{ paddingHorizontal: 12 }}
          contentContainerStyle={{ paddingBottom: 30, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
          ListEmptyComponent={<Empty icon="images-outline" text="No schools assigned yet." />}
          renderItem={({ item }) => (
            <Pressable style={styles.tile} onPress={() => navigation.navigate('GalleryDetail', { schoolId: item.id, name: item.name })}>
              {item.school_image ? <Image source={{ uri: fileUrl(item.school_image) }} style={styles.img} />
                : <View style={[styles.img, styles.ph]}><Ionicons name="images" size={34} color={colors.iconMuted} /></View>}
              <View style={{ padding: 10 }}>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                <Text style={ui.meta}>{item.gallery_count || 0} items</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = themed(() => ({
  tile: { flex: 1, margin: 6, backgroundColor: colors.navyLight, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.cardBorder, maxWidth: '47%' },
  img: { width: '100%', height: 110 },
  ph: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.placeholder },
  name: { color: colors.heading, fontWeight: '700', fontSize: 14 },
}));
