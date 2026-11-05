import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, Modal, FlatList, TextInput, Linking, KeyboardAvoidingView, Platform, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, themed, currentMode } from '../theme/colors';
import { fileUrl, ROLES, getAchievementComments, postAchievementComment } from '../api';
import { formatDate } from './ui';

export const ORANGE = '#F28C28';

export function timeAgo(d) {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (isNaN(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(d);
}

const initialsOf = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const STOP = new Set(['the', 'a', 'an', 'of', 'at', 'in', 'on', 'for', 'and', 'to', 'by', 'with']);
function hashtag(item) {
  const words = String(item.title || '').replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase())).slice(0, 3);
  return words.length ? `#${words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')}` : '#MQAchievement';
}

export function Avatar({ uri, name, size = 46, dot = true }) {
  const [failed, setFailed] = useState(false);
  const st = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View>
      {uri && !failed ? (
        <Image source={{ uri }} style={[styles.avatar, st]} onError={() => setFailed(true)} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback, st]}><Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initialsOf(name)}</Text></View>
      )}
      {dot && <View style={styles.online} />}
    </View>
  );
}

export function PostCard({ item, onLike, onSave, onComment, onOpen }) {
  const { width } = useWindowDimensions();
  const media = item.media || [];
  const author = item.author?.name || item.schoolName || 'Marcosquay Sports';
  const sub = item.author
    ? [ROLES[Number(item.author.role_id)], item.schoolName].filter(Boolean).join(' | ')
    : 'School Achievement';
  const shown = media.slice(0, 3);
  const extra = media.length - shown.length;
  const gridW = width - 32 - 28;
  const gap = 6;
  const cellW = shown.length ? (gridW - gap * (shown.length - 1)) / shown.length : 0;
  const cellH = shown.length === 1 ? gridW * 0.6 : shown.length === 2 ? gridW * 0.45 : cellW * 1.05;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Avatar uri={item.author?.profile_pic ? fileUrl(item.author.profile_pic) : null} name={author} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.author} numberOfLines={1}>{author}</Text>
          <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
        </View>
        <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.meta} style={{ marginLeft: 8 }} />
      </View>

      {shown.length > 0 && (
        <View style={[styles.grid, { gap }]}>
          {shown.map((m, i) => (
            <Pressable key={m.path || i} onPress={() => (m.type === 'video' ? Linking.openURL(fileUrl(m.url)) : onOpen?.(media, i))}>
              {m.type === 'video' ? (
                <View style={[styles.photo, styles.videoCell, { width: cellW, height: cellH }]}><Ionicons name="play-circle" size={36} color="#fff" /></View>
              ) : (
                <Image source={{ uri: fileUrl(m.url) }} style={[styles.photo, { width: cellW, height: cellH }]} />
              )}
              {i === shown.length - 1 && extra > 0 && (
                <View style={[styles.more, { width: cellW, height: cellH }]}><Text style={styles.moreText}>+{extra}</Text></View>
              )}
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.caption}>{item.title}{item.description ? `\n${item.description}` : ''}</Text>
      <Text style={styles.tag}>{hashtag(item)}</Text>

      <View style={styles.footer}>
        <Pressable style={styles.action} onPress={() => onLike?.(item)} hitSlop={6}>
          <Ionicons name={item.liked_by_me ? 'heart' : 'heart-outline'} size={20} color={item.liked_by_me ? '#e11d48' : colors.subtext} />
          <Text style={styles.actionText}>Like ({item.like_count || 0})</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => onComment?.(item)} hitSlop={6}>
          <Ionicons name="chatbubble-outline" size={19} color={colors.subtext} />
          <Text style={styles.actionText}>Comment ({item.comment_count || 0})</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => onSave?.(item)} hitSlop={6}>
          <Ionicons name={item.saved_by_me ? 'bookmark' : 'bookmark-outline'} size={19} color={ORANGE} />
          <Text style={[styles.actionText, { color: ORANGE, fontWeight: '700' }]}>{item.saved_by_me ? 'Saved' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function MediaViewer({ viewer, onClose }) {
  const { width } = useWindowDimensions();
  const all = viewer?.media || [];
  const images = all.filter((m) => m.type !== 'video');
  const start = Math.max(0, images.indexOf(all[viewer?.index]));
  return (
    <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewer}>
        <Pressable style={styles.close} onPress={onClose} hitSlop={12}><Ionicons name="close" size={28} color="#fff" /></Pressable>
        {viewer && (
          <FlatList
            data={images}
            horizontal
            pagingEnabled
            initialScrollIndex={start}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(m, i) => m.path || String(i)}
            renderItem={({ item: m }) => <Image source={{ uri: fileUrl(m.url) }} style={{ width, height: '100%' }} resizeMode="contain" />}
          />
        )}
      </View>
    </Modal>
  );
}

export function CommentsSheet({ item, onClose, onCountChange }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const load = async () => {
    if (!item) return;
    setLoading(true); setError('');
    try { setList(await getAchievementComments(item.id)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { setList([]); setText(''); load(); }, [item?.id]);

  const post = async () => {
    const t = text.trim();
    if (!t || posting) return;
    setPosting(true); setError('');
    try {
      const r = await postAchievementComment(item.id, t);
      setList((l) => [...l, r.data]);
      setText('');
      onCountChange?.(item.id, r.comment_count);
    } catch (e) { setError(e.message); }
    finally { setPosting(false); }
  };

  return (
    <Modal visible={!!item} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.author}>Comments{list.length ? ` (${list.length})` : ''}</Text>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.heading} /></Pressable>
          </View>
          {loading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} /> : (
            <FlatList
              data={list}
              keyExtractor={(c) => String(c.id)}
              style={{ maxHeight: 380 }}
              ListEmptyComponent={<Text style={[styles.sub, { textAlign: 'center', marginVertical: 30 }]}>{error || 'No comments yet. Be the first!'}</Text>}
              renderItem={({ item: c }) => (
                <View style={styles.commentRow}>
                  <Avatar uri={c.profile_pic ? fileUrl(c.profile_pic) : null} name={c.name} size={34} dot={false} />
                  <View style={styles.bubble}>
                    <Text style={styles.commentName}>{c.name || 'User'} <Text style={styles.time}>  {timeAgo(c.created_at)}</Text></Text>
                    <Text style={styles.commentText}>{c.comment}</Text>
                  </View>
                </View>
              )}
            />
          )}
          {!!error && list.length > 0 && <Text style={{ color: colors.error, marginTop: 6 }}>{error}</Text>}
          <View style={styles.inputRow}>
            <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Write a comment..." placeholderTextColor={colors.meta} multiline maxLength={2000} />
            <Pressable onPress={post} disabled={!text.trim() || posting} style={[styles.send, (!text.trim() || posting) && { opacity: 0.5 }]}>
              {posting ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const feedBg = () => (currentMode === 'dark' ? colors.navy : '#F2F4F3');

const styles = themed(() => ({
  card: {
    backgroundColor: colors.navyLight, borderRadius: 22, padding: 14, marginHorizontal: 16, marginBottom: 16,
    borderWidth: currentMode === 'dark' ? 1 : 0, borderColor: colors.cardBorder,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: { borderWidth: 2, borderColor: colors.accentGreen },
  avatarFallback: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '800' },
  online: { position: 'absolute', right: 1, bottom: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.navyLight },
  author: { color: colors.heading, fontWeight: '800', fontSize: 16 },
  sub: { color: colors.meta, fontSize: 13, marginTop: 2 },
  time: { color: colors.meta, fontSize: 12, fontWeight: '400' },
  grid: { flexDirection: 'row', marginBottom: 12 },
  photo: { borderRadius: 12, backgroundColor: colors.placeholder },
  videoCell: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2937' },
  more: { position: 'absolute', top: 0, left: 0, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  moreText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  caption: { color: colors.text, fontSize: 15, lineHeight: 22 },
  tag: { color: colors.primary, fontWeight: '700', fontSize: 14, marginTop: 6 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.cardBorder, marginTop: 12, paddingTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { color: colors.subtext, fontSize: 14, fontWeight: '600' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)', justifyContent: 'center' },
  close: { position: 'absolute', top: 50, right: 20, zIndex: 2 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: colors.navyLight, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 28 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  bubble: { flex: 1, backgroundColor: colors.navy, borderRadius: 14, padding: 10 },
  commentName: { color: colors.heading, fontWeight: '700', fontSize: 13 },
  commentText: { color: colors.text, fontSize: 14, marginTop: 3, lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 },
  input: { flex: 1, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, color: colors.text, maxHeight: 100 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
}));