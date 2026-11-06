import { useState } from 'react';
import { View, Text, Pressable, Modal, TextInput, FlatList, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, themed } from '../theme/colors';
import { matchReportPdfUrl } from '../api';
export const matchDate = d => {
  if (!d) return 'Date not recorded';
  const day = String(d).slice(0, 10);
  const dt = new Date(day + 'T12:00:00');
  return Number.isNaN(dt.getTime()) ? day : dt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};
export async function openMatchPdf(id) {
  try {
    await Linking.openURL(await matchReportPdfUrl(id));
  } catch (e) {
    Alert.alert('Could not open PDF', e.message);
  }
}
export function MatchHeader({
  title,
  sub,
  onBack,
  action
}) {
  const i = useSafeAreaInsets();
  return <View style={[ms.hero, {
    paddingTop: i.top + 10
  }]}><View style={ms.row}><Pressable accessibilityLabel="Go back" onPress={onBack} style={ms.back}><Ionicons name="chevron-back" size={23} color="#fff" /></Pressable><View style={{
        flex: 1
      }}><Text style={ms.heroTitle}>{title}</Text>{!!sub && <Text style={ms.heroSub}>{sub}</Text>}</View>{action}</View></View>;
}
export function MatchButton({
  label,
  onPress,
  disabled,
  secondary = false,
  icon
}) {
  return <Pressable disabled={disabled} onPress={onPress} style={({
    pressed
  }) => [ms.button, secondary && ms.secondary, disabled && {
    opacity: .45
  }, pressed && {
    opacity: .8
  }]}>{!!icon && <Ionicons name={icon} size={19} color={secondary ? colors.primary : '#fff'} />}<Text style={[ms.buttonText, secondary && {
      color: colors.primary
    }]}>{label}</Text></Pressable>;
}
export function MatchBadge({
  result
}) {
  const c = result === 'WIN' ? colors.success : result === 'LOSS' ? colors.error : result === 'DRAW' ? '#C48828' : colors.primary;
  return <View style={[ms.badge, {
    backgroundColor: c + '20'
  }]}><Text style={[ms.badgeText, {
      color: c
    }]}>{result === 'UPLOADED' ? 'PDF UPLOADED' : result || 'MATCH'}</Text></View>;
}
export function MatchDropdown({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Choose',
  disabled = false
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState('');
  const selected = options.find(x => String(x.id) === String(value));
  return <View><Text style={ms.label}>{label}</Text><Pressable disabled={disabled} onPress={() => {
      setQ('');
      setOpen(true);
    }} style={ms.inputRow}><Text style={[ms.body, {
        flex: 1
      }, !selected && {
        color: colors.iconMuted
      }]}>{selected?.name || placeholder}</Text><Ionicons name="chevron-down" size={18} color={colors.primary} /></Pressable><Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}><View style={ms.overlay}><Pressable style={{
          flex: 1
        }} onPress={() => setOpen(false)} /><View style={ms.sheet}><View style={ms.row}><Text style={[ms.title, {
              flex: 1
            }]}>{label}</Text><Pressable accessibilityLabel="Close picker" onPress={() => setOpen(false)}><Ionicons name="close" size={24} color={colors.heading} /></Pressable></View><TextInput value={q} onChangeText={setQ} placeholder="Search..." placeholderTextColor={colors.iconMuted} style={ms.input} /><FlatList keyboardShouldPersistTaps="handled" data={options.filter(x => x.name.toLowerCase().includes(q.toLowerCase()))} keyExtractor={x => String(x.id)} ListEmptyComponent={<Text style={ms.meta}>No choices found.</Text>} renderItem={({
            item
          }) => <Pressable onPress={() => {
            onSelect(item);
            setOpen(false);
          }} style={ms.option}><Text style={[ms.body, {
              flex: 1
            }]}>{item.name}</Text>{String(value) === String(item.id) && <Ionicons name="checkmark-circle" size={23} color={colors.primary} />}</Pressable>} /></View></View></Modal></View>;
}
export const ms = themed(() => ({
  screen: {
    flex: 1,
    backgroundColor: colors.navy
  },
  hero: {
    backgroundColor: colors.primaryDark,
    paddingHorizontal: 18,
    paddingBottom: 22,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  back: {
    height: 40,
    width: 40,
    backgroundColor: 'rgba(255,255,255,.15)',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center'
  },
  heroTitle: {
    fontSize: 23,
    fontWeight: '900',
    color: '#fff'
  },
  heroSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,.8)',
    marginTop: 4
  },
  card: {
    padding: 18,
    backgroundColor: colors.navyLight,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 14
  },
  title: {
    color: colors.heading,
    fontSize: 18,
    fontWeight: '800'
  },
  body: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 22
  },
  meta: {
    color: colors.meta,
    fontSize: 12,
    lineHeight: 19
  },
  label: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 7
  },
  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    color: colors.text,
    fontSize: 15,
    marginVertical: 5
  },
  inputRow: {
    backgroundColor: colors.inputBg,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800'
  },
  secondary: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1
  },
  score: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.heading,
    textAlign: 'center',
    marginVertical: 16
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,.45)',
    justifyContent: 'flex-end'
  },
  sheet: {
    backgroundColor: colors.navyLight,
    padding: 20,
    paddingBottom: 32,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    maxHeight: '75%'
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    gap: 10
  },
  footer: {
    padding: 16,
    backgroundColor: colors.navyLight,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    flexDirection: 'row',
    gap: 10
  },
  thumb: {
    width: 110,
    height: 100,
    borderRadius: 14
  },
  error: {
    padding: 16,
    color: colors.error
  },
  empty: {
    padding: 36,
    alignItems: 'center',
    gap: 12
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.navyLight
  },
  chipOn: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary
  },
  counter: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  player: {
    padding: 14,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.navyLight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  step: {
    height: 5,
    flex: 1,
    borderRadius: 4,
    backgroundColor: colors.cardBorder
  },
  stepOn: {
    backgroundColor: colors.primary
  },
  note: {
    backgroundColor: colors.primarySoft,
    padding: 14,
    borderRadius: 14,
    marginVertical: 12
  },
  photoRemove: {
    position: 'absolute',
    right: 3,
    top: 3,
    backgroundColor: 'rgba(0,0,0,.7)',
    borderRadius: 12,
    padding: 4
  }
}));
