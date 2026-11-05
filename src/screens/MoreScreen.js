import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, themed } from '../theme/colors';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../api';
import { Header, ui } from '../components/ui';

// "More" tab (Head Coach): the remaining pages
const ITEMS = [
  { key: 'team', title: 'Team Management', sub: 'Teams, players and match records', icon: 'people', tint: 'accentBlue', fg: '#1D4ED8', go: ['Teams', { kind: 'teams' }] },
  { key: 'sdp', title: 'SDP', sub: 'SDP teams and daily attendance', icon: 'star', tint: 'accentOrange', fg: '#C2410C', go: ['Teams', { kind: 'sports-teams' }] },
  { key: 'help', title: 'Helpdesk', sub: 'Raise a ticket or view your requests', icon: 'help-buoy', tint: 'accentGreen', fg: '#1E8E3E', go: ['HelpdeskPage'] },
];

export default function MoreScreen({ navigation }) {
  const { user } = useAuth();
  return (
    <View style={ui.screen}>
      <Header title="More" subtitle={`${user?.name || ''} · ${ROLES[user?.role_id] || ''}`} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30 }}>
        <Text style={s.section}>Pages</Text>
        <View style={s.group}>
          {ITEMS.map((it, i) => (
            <Pressable key={it.key} onPress={() => navigation.navigate(...it.go)} style={({ pressed }) => [s.row, i > 0 && s.divider, pressed && { opacity: 0.7 }]}>
              <View style={[s.icon, { backgroundColor: colors[it.tint] }]}><Ionicons name={it.icon} size={20} color={it.fg} /></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={s.title} numberOfLines={1}>{it.title}</Text>
                  {it.soon && <View style={s.pill}><Text style={s.pillText}>Coming soon</Text></View>}
                </View>
                <Text style={s.sub} numberOfLines={1}>{it.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.iconMuted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = themed(() => ({
  section: { color: colors.meta, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4 },
  group: { backgroundColor: colors.navyLight, borderRadius: 20, borderWidth: 1, borderColor: colors.cardBorder, shadowColor: '#0F3D1F', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  divider: { borderTopWidth: 1, borderTopColor: colors.cardBorder },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.heading, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  sub: { color: colors.meta, fontSize: 12, marginTop: 2 },
  pill: { backgroundColor: colors.accentOrange, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { color: '#C2410C', fontSize: 10, fontWeight: '800' },
}));