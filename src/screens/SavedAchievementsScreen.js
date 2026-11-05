import { useCallback, useEffect, useState } from 'react';
import { View, FlatList, RefreshControl } from 'react-native';
import { colors } from '../theme/colors';
import { getSavedAchievements } from '../api';
import { Header, Loading, ErrorBox, Empty } from '../components/ui';
import { PostCard, MediaViewer, CommentsSheet, feedBg } from '../components/AchievementPost';
import { useAchievementActions } from '../hooks/useAchievementActions';

// GET /api/school-achievements/saved - the user's saved "folder"
export default function SavedAchievementsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState(null);
  const [commentsFor, setCommentsFor] = useState(null);
  const { like, save, setCommentCount } = useAchievementActions(setItems, { removeOnUnsave: true });

  const load = useCallback(async () => {
    setError('');
    try { setItems(await getSavedAchievements()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: feedBg() }}>
      <Header title="Saved" subtitle={`${items.length} saved achievement${items.length === 1 ? '' : 's'}`} onBack={() => navigation.goBack()} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={() => { setLoading(true); load(); }} /> : (
        <FlatList
          data={items}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={{ paddingBottom: 30, paddingTop: 4, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
          ListEmptyComponent={<Empty icon="bookmark-outline" text="Nothing saved yet. Tap Save on a post to keep it here." />}
          renderItem={({ item }) => (
            <PostCard item={item} onLike={like} onSave={save} onComment={setCommentsFor} onOpen={(media, index) => setViewer({ media, index })} />
          )}
        />
      )}
      <MediaViewer viewer={viewer} onClose={() => setViewer(null)} />
      <CommentsSheet item={commentsFor} onClose={() => setCommentsFor(null)} onCountChange={setCommentCount} />
    </View>
  );
}