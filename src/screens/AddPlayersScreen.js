import { useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed } from '../theme/colors';
import { attachPlayers } from '../api';
import { Header, ui } from '../components/ui';
import { StudentPicker, press } from '../components/teams';

// Pick existing school students and attach them to a team
export default function AddPlayersScreen({ navigation, route }) {
  const { kind, team, existingIds = [] } = route.params;
  const insets = useSafeAreaInsets();
  const [sel, setSel] = useState([]);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const r = await attachPlayers(kind, team.id, sel);
      Alert.alert('Players added', r.message || `${sel.length} player(s) added`, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) { Alert.alert('Could not add players', e.message); }
    finally { setSaving(false); }
  };
  return (
    <View style={ui.screen}>
      <Header title="Add players" subtitle={team.name.trim()} onBack={() => navigation.goBack()} />
      <StudentPicker schoolId={team.school_id} selected={sel} onChange={setSel} excludeIds={existingIds} />
      <View style={[s.footer, { paddingBottom: 14 }]}>
        <Pressable disabled={!sel.length || saving} onPress={save} style={(p) => [s.cta, (!sel.length || saving) && { opacity: 0.45 }, press(p)]}>
          <Ionicons name="checkmark" size={18} color="#fff" /><Text style={s.ctaText}>{saving ? 'Adding...' : `Add ${sel.length || ''} player${sel.length === 1 ? '' : 's'}`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = themed(() => ({
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.navyLight, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  cta: { height: 52, borderRadius: 999, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
}));