import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed } from '../theme/colors';

export function Header({ title, subtitle, onBack, right }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[ui.header, { paddingTop: insets.top + 14 }]}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={12} style={ui.back}>
          <Ionicons name="chevron-back" size={24} color={colors.heading} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text style={ui.title} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={ui.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 50 }} />;
}

export function ErrorBox({ message, onRetry }) {
  return (
    <View style={ui.errorBox}>
      <Text style={ui.errorText}>{message}</Text>
      {onRetry && <Pressable onPress={onRetry}><Text style={ui.retry}>Try again</Text></Pressable>}
    </View>
  );
}

export function Empty({ icon = 'file-tray-outline', text }) {
  return (
    <View style={ui.empty}>
      <Ionicons name={icon} size={46} color={colors.iconMuted} />
      <Text style={ui.emptyText}>{text}</Text>
    </View>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <View style={ui.seg}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[ui.segItem, value === o.value && ui.segActive]}>
          <Text style={[ui.segText, value === o.value && { color: '#fff' }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Button({ title, onPress, loading, disabled, style }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={[ui.btn, (disabled || loading) && { opacity: 0.6 }, style]}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={ui.btnText}>{title}</Text>}
    </Pressable>
  );
}

export function formatDate(d) {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x)) return String(d);
  return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const ui = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.navy },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14 },
  back: { marginRight: 8 },
  title: { color: colors.heading, fontSize: 24, fontWeight: '800' },
  subtitle: { color: colors.meta, fontSize: 13, marginTop: 2 },
  card: { backgroundColor: colors.navyLight, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 16, marginHorizontal: 16, marginBottom: 12 },
  cardTitle: { color: colors.heading, fontSize: 16, fontWeight: '700' },
  cardText: { color: colors.subtext, fontSize: 13, marginTop: 4, lineHeight: 19 },
  meta: { color: colors.meta, fontSize: 12, marginTop: 6 },
  chip: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  section: { color: colors.heading, fontSize: 18, fontWeight: '700', marginTop: 22, marginBottom: 12, paddingHorizontal: 20 },
  errorBox: { margin: 20, backgroundColor: colors.errorBg, borderRadius: 14, padding: 16 },
  errorText: { color: colors.error, fontWeight: '700' },
  retry: { color: colors.primary, fontWeight: '700', marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyText: { color: colors.meta, marginTop: 12, textAlign: 'center' },
  seg: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 14, backgroundColor: colors.navyLight, borderRadius: 14, padding: 4 },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary },
  segText: { color: colors.meta, fontWeight: '700', fontSize: 13 },
  input: { backgroundColor: colors.inputBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text, marginBottom: 12 },
  label: { color: colors.subtext, fontWeight: '600', marginBottom: 6, fontSize: 13 },
  btn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
}));