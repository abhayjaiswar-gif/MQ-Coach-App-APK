import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, themed } from '../theme/colors';
import { Header, ui } from '../components/ui';

export default function ComingSoonScreen({ navigation, route }) {
  const { title = 'Coming soon', icon = 'construct' } = route.params || {};
  return (
    <View style={ui.screen}>
      <Header title={title} onBack={() => navigation.goBack()} />
      <View style={s.wrap}>
        <View style={s.circle}><Ionicons name={icon} size={40} color={colors.primary} /></View>
        <Text style={s.title}>Coming soon</Text>
        <Text style={s.sub}>{title} is on its way to the app. You can still use it on the web for now.</Text>
      </View>
    </View>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 80 },
  circle: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { color: colors.heading, fontSize: 20, fontWeight: '800' },
  sub: { color: colors.meta, fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
}));