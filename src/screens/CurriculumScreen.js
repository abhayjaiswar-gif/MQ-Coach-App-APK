import { View, Text, Pressable, ScrollView, ImageBackground } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, themed } from '../theme/colors';
import { Header, ui } from '../components/ui';

// MQ Curriculum home: program cards (same flow as SelectCurriculumPage.vue) + Extra Covered logger
const CARDS = [
  { key: 'inschool', title: 'In-School Program', sub: 'PE framework for the regular school timetable', badge: 'IN-SCHOOL', icon: 'school', img: require('../../assets/curriculum/inschool.jpg'), go: ['CurriculumBuilder', { program: 'inschool' }] },
  { key: 'sdp', title: 'SDP · Specialized', sub: 'High-performance athlete development', badge: 'ACADEMY', icon: 'star', img: require('../../assets/curriculum/sdp.jpg'), go: ['CurriculumBuilder', { program: 'sdp' }] },
  { key: 'msfc', title: 'MSFC · Multi Sport', sub: 'Holistic multi sport fitness curriculum', badge: 'MULTI SPORT', icon: 'barbell', img: require('../../assets/curriculum/msfc.jpg'), go: ['CurriculumBuilder', { program: 'msfc' }] },
];
const EXTRA = { key: 'extra', title: 'Extra Covered', sub: 'Log extra activities by week & month', badge: 'WEEKLY REPORT', icon: 'add-circle', img: require('../../assets/curriculum/extra.jpg'), go: ['ExtraCover'] };

function ImageCard({ c, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.98 }] }]}>
      <ImageBackground source={c.img} style={s.img} imageStyle={{ borderRadius: 22 }}>
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)', 'rgba(6,32,16,0.88)']} locations={[0, 0.4, 1]} style={s.grad}>
          <View style={s.pill}><Ionicons name={c.icon} size={11} color="#fff" /><Text style={s.pillText}>{c.badge}</Text></View>
          <View style={s.bottom}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{c.title}</Text>
              <Text style={s.sub} numberOfLines={1}>{c.sub}</Text>
            </View>
            <View style={s.arrow}><Ionicons name="arrow-forward" size={18} color={colors.primary} /></View>
          </View>
        </LinearGradient>
      </ImageBackground>
    </Pressable>
  );
}

export default function CurriculumScreen({ navigation }) {
  return (
    <View style={ui.screen}>
      <Header title="MQ Curriculum" subtitle="Choose a program to start a session" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
        <Text style={s.section}>Programs</Text>
        {CARDS.map((c) => <ImageCard key={c.key} c={c} onPress={() => navigation.navigate(...c.go)} />)}
        <Text style={s.section}>Extra Cover</Text>
        <ImageCard c={EXTRA} onPress={() => navigation.navigate(...EXTRA.go)} />
      </ScrollView>
    </View>
  );
}

const s = themed(() => ({
  section: { color: colors.meta, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 6, marginBottom: 10, marginLeft: 4 },
  card: { height: 180, borderRadius: 22, marginBottom: 16, backgroundColor: colors.navyLight, shadowColor: '#0F3D1F', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  img: { flex: 1 },
  grad: { flex: 1, borderRadius: 22, padding: 16, justifyContent: 'space-between' },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(30,142,62,0.9)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  title: { color: '#fff', fontSize: 21, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  arrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
}));