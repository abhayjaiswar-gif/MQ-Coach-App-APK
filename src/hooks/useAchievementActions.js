import { useCallback } from 'react';
import { Alert } from 'react-native';
import { toggleAchievementLike, toggleAchievementSave } from '../api';

// Optimistic like/save with revert on error. `setItems` updates the list shown.
export function useAchievementActions(setItems, { onSavedChange, removeOnUnsave = false } = {}) {
  const patch = useCallback((id, fn) => setItems((list) => list.map((a) => (a.id === id ? { ...a, ...fn(a) } : a))), [setItems]);

  const like = useCallback(async (item) => {
    const next = !item.liked_by_me;
    patch(item.id, (a) => ({ liked_by_me: next, like_count: Math.max(0, (a.like_count || 0) + (next ? 1 : -1)) }));
    try {
      const r = await toggleAchievementLike(item.id);
      patch(item.id, () => ({ liked_by_me: !!r.liked, like_count: Number(r.like_count) || 0 }));
    } catch (e) {
      patch(item.id, () => ({ liked_by_me: item.liked_by_me, like_count: item.like_count }));
      Alert.alert('Like failed', e.message);
    }
  }, [patch]);

  const save = useCallback(async (item) => {
    const next = !item.saved_by_me;
    patch(item.id, () => ({ saved_by_me: next }));
    onSavedChange?.(next ? 1 : -1, null);
    try {
      const r = await toggleAchievementSave(item.id);
      patch(item.id, () => ({ saved_by_me: !!r.saved }));
      onSavedChange?.(0, Number(r.saved_count));
      if (removeOnUnsave && !r.saved) setItems((list) => list.filter((a) => a.id !== item.id));
    } catch (e) {
      patch(item.id, () => ({ saved_by_me: item.saved_by_me }));
      onSavedChange?.(next ? -1 : 1, null);
      Alert.alert('Save failed', e.message);
    }
  }, [patch, onSavedChange, removeOnUnsave, setItems]);

  const setCommentCount = useCallback((id, n) => patch(id, () => ({ comment_count: Number(n) || 0 })), [patch]);

  return { like, save, setCommentCount };
}