import { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, themed } from '../theme/colors';
import { Header, Empty, ui } from '../components/ui';

const PLAN_FIELDS = [
  ['warm_up', 'Warm Up'], ['skill_implementation', 'Skill Implementation'], ['cool_down', 'Cool Down'],
  ['teaching_aids', 'Teaching Aids'], ['summarization', 'Summarization'], ['life_skill', 'Life Skill'],
];

function Status({ value }) {
  const v = String(value || 'Pending');
  const done = v.toLowerCase() !== 'pending';
  return <View style={[styles.status, { backgroundColor: done ? colors.successSoft : colors.accentBlue }]}><Text style={{ color: done ? colors.success : colors.subtext, fontSize: 11, fontWeight: '700' }}>{v}</Text></View>;
}

function PlanCard({ lp }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable style={ui.card} onPress={() => setOpen(!open)}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={ui.meta}>{[lp.sport, lp.grade && `Grade ${lp.grade}`, lp.lp_id && `LP ${lp.lp_id}`].filter(Boolean).join('  |  ')}</Text>
          <Text style={[ui.cardTitle, { marginTop: 4 }]}>{lp.skill || 'Lesson plan'}{lp.sub_skill ? ` - ${lp.sub_skill}` : ''}</Text>
        </View>
        <Status value={lp.lp_status} />
      </View>
      {!!lp.objective && <Text style={ui.cardText}>{lp.objective}</Text>}
      {open && PLAN_FIELDS.filter(([k]) => lp[k]).map(([k, label]) => (
        <View key={k} style={{ marginTop: 10 }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={ui.cardText}>{String(lp[k])}</Text>
        </View>
      ))}
      {!!lp.lp_remark && open && <Text style={[ui.meta, { marginTop: 8 }]}>Remark: {lp.lp_remark}</Text>}
      <Text style={styles.more}>{open ? 'Hide details' : 'View plan'} <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} /></Text>
    </Pressable>
  );
}

export default function CurriculumDetailScreen({ route, navigation }) {
  const { type, week, curriculum, modules = [] } = route.params;

  if (type === 'week') {
    return (
      <View style={ui.screen}>
        <Header title={week.school_name} subtitle={`${week.week_no} | ${week.items.length} lesson plans`} onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          {week.items.length === 0 ? <Empty text="No plans" /> : week.items.map((lp, i) => <PlanCard key={`${lp.id}_${i}`} lp={lp} />)}
        </ScrollView>
      </View>
    );
  }

  // Curriculum: modules grouped by grade
  const byGrade = modules.reduce((acc, m) => { (acc[m.grade || 'General'] ||= []).push(m); return acc; }, {});
  return (
    <View style={ui.screen}>
      <Header title={curriculum.sport || 'Curriculum'} subtitle={`${modules.length} modules`} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {modules.length === 0 ? <Empty icon="book-outline" text="No modules found for this curriculum." /> :
          Object.entries(byGrade).map(([grade, list]) => (
            <View key={grade}>
              <Text style={styles.grade}>Grade {grade}</Text>
              {list.map((m) => (
                <View key={m.module_id} style={ui.card}>
                  <Text style={ui.meta}>LP {m.lp_no ?? '-'}</Text>
                  <Text style={[ui.cardTitle, { marginTop: 4 }]}>{m.skill}{m.sub_skill ? ` - ${m.sub_skill}` : ''}</Text>
                  {!!m.objective && <Text style={ui.cardText}>{m.objective}</Text>}
                </View>
              ))}
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = themed(() => ({
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  fieldLabel: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  more: { color: colors.primary, fontWeight: '700', fontSize: 12, marginTop: 10 },
  grade: { color: colors.primary, fontWeight: '800', paddingHorizontal: 20, marginTop: 10, marginBottom: 8 },
}));