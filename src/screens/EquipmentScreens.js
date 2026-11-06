import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, RefreshControl, Alert, Image, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import { MatchHeader as Header, MatchButton as Button, MatchDropdown as Dropdown, ms } from '../components/matchReports';
import { fileUrl, getEquipmentSchools, getEquipmentStock, getEquipmentRecipients, getEquipmentLoans, getEquipmentMovements, getEquipmentRequests, saveEquipmentMovement, requestEquipment, retryEquipmentMissing } from '../api';
const actions = [['See stock', 'Usable, damaged and missing in one place', 'cube-outline', 'EquipmentStock'], ['Received items', 'Confirm what arrived at school', 'download-outline', 'receipt'], ['Give out / Return', 'Keep track of who has your equipment', 'swap-horizontal-outline', 'issue'], ['Report a problem', 'Damaged or missing? Tell us here', 'warning-outline', 'damage'], ['Request more', 'Ask for items and follow approvals', 'bag-add-outline', 'EquipmentRequests']];
const labels = {
  receipt: 'Received items',
  issue: 'Give out / Return',
  return: 'Return items',
  damage: 'Report a problem',
  missing: 'Report missing',
  request: 'Request more'
};
const token = () => `eq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
const dateLabel = v => v ? new Date(v).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
}) + ' IST' : '';
const rowLabel = r => r.equipment_name + (r.size ? ` · ${r.size}` : '');
const goodInt = v => /^\d+$/.test(String(v)) && Number(v) > 0 && Number(v) <= 1000000;
function Notice({
  children
}) {
  return <View style={ms.note}><Text style={ms.body}>{children}</Text></View>;
}
function ErrorBox({
  message,
  onRetry
}) {
  return message ? <View style={{
    padding: 16
  }}><Text style={{
      color: colors.error,
      marginBottom: 10
    }}>{message}</Text>{onRetry && <Button secondary label="Try again" onPress={onRetry} />}</View> : null;
}
function Count({
  label,
  value,
  color = colors.heading
}) {
  return <View style={{
    flex: 1
  }}><Text style={{
      color,
      fontSize: 24,
      fontWeight: '900'
    }}>{value}</Text><Text style={ms.meta}>{label}</Text></View>;
}
function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false
}) {
  return <View><Text style={ms.label}>{label}</Text><TextInput value={value} onChangeText={onChange} style={ms.input} placeholder={placeholder} placeholderTextColor={colors.iconMuted} multiline={multiline} maxLength={multiline ? 2000 : 255} /></View>;
}
function Counter({
  label,
  value,
  onChange,
  min = 1,
  max = 1000000
}) {
  return <View><Text style={ms.label}>{label}</Text><View style={ms.row}><Pressable accessibilityLabel={`Decrease ${label}`} style={ms.counter} onPress={() => onChange(String(Math.max(min, (Number(value) || min) - 1)))}><Ionicons name="remove" size={23} color={colors.primary} /></Pressable><TextInput accessibilityLabel={label} value={String(value)} onChangeText={v => onChange(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={7} style={[ms.input, {
        flex: 1,
        textAlign: 'center',
        fontSize: 24,
        fontWeight: '900'
      }]} /><Pressable accessibilityLabel={`Increase ${label}`} style={ms.counter} onPress={() => onChange(String(Math.min(max, (Number(value) || 0) + 1)))}><Ionicons name="add" size={23} color={colors.primary} /></Pressable></View></View>;
}
function Chips({
  value,
  options,
  onChange
}) {
  return <View style={[ms.row, {
    flexWrap: 'wrap',
    marginVertical: 12
  }]}>{options.map(x => <Pressable key={x.id} accessibilityRole="button" accessibilityState={{
      selected: value === x.id
    }} onPress={() => onChange(x.id)} style={[ms.chip, value === x.id && ms.chipOn]}><Text style={{
        color: value === x.id ? colors.primary : colors.text,
        fontWeight: '700'
      }}>{x.name}</Text></Pressable>)}</View>;
}
function Timeline({
  order
}) {
  const rejected = order.approve_ssgm === 0 || order.approve_admin === 0;
  const stages = ['Requested', 'SSGM checked', 'Admin approved', order.missing_movement_id ? 'Missing confirmed' : 'Received'];
  const done = [true, order.approve_ssgm === 1, order.approve_admin === 1 && order.approve_ssgm === 1, order.missing_movement_id ? order.missing_status === 'posted' : order.qty > 0 && Number(order.received_qty) >= order.qty];
  return <View style={{
    marginTop: 14
  }}>{stages.map((label, i) => <View key={label} style={[ms.row, {
      marginVertical: 4
    }]}><Ionicons name={done[i] ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={done[i] ? colors.success : colors.iconMuted} /><Text style={[ms.meta, {
        color: done[i] ? colors.text : colors.meta
      }]}>{label}</Text></View>)}{rejected && <Text style={{
      color: colors.error,
      marginTop: 6
    }}>Not approved</Text>}{!!order.received_qty && <Text style={ms.meta}>Received {order.received_qty} of {order.qty}</Text>}{order.status_delivery === 1 && !done[3] && <Text style={ms.meta}>Marked delivered on web. Confirm the physical receipt here.</Text>}</View>;
}
export function EquipmentHomeScreen({
  navigation
}) {
  const {
    user
  } = useAuth();
  const [schools, setSchools] = useState([]),
    [school, setSchool] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await getEquipmentSchools();
      setSchools(list);
      setSchool(prev => list.find(x => x.id === prev?.id) || list.find(x => Number(x.id) === Number(user?.school_id)) || list[0] || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user?.school_id]);
  useFocusEffect(useCallback(() => {
    load();
  }, [load]));
  return <View style={ms.screen}><Header title="Equipment" sub="Less paperwork. More play." onBack={() => navigation.goBack()} /><ScrollView contentContainerStyle={{
      padding: 18
    }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}>{loading && !schools.length && <ActivityIndicator color={colors.primary} />}<ErrorBox message={error} onRetry={load} />{!!schools.length && <Dropdown label="Your school" value={school?.id} options={schools} onSelect={setSchool} />}<Notice>School, your name and today's date are filled in automatically.</Notice>{!loading && !error && !schools.length && <Text style={ms.body}>No school assigned. Ask your stock manager to check your school assignment.</Text>}{actions.map(([title, sub, icon, go]) => <Pressable disabled={!school} key={title} onPress={() => navigation.navigate(go.startsWith('Equipment') ? go : 'EquipmentAction', {
        school,
        kind: go
      })} style={[ms.card, ms.row, {
        opacity: school ? 1 : .5
      }]}><View style={[ms.counter, {
          width: 52,
          height: 52
        }]}><Ionicons name={icon} size={25} color={colors.primary} /></View><View style={{
          flex: 1
        }}><Text style={ms.title}>{title}</Text><Text style={ms.meta}>{sub}</Text></View><Ionicons name="chevron-forward" size={19} color={colors.iconMuted} /></Pressable>)}</ScrollView></View>;
}
export function EquipmentStockScreen({
  navigation,
  route
}) {
  const {
    school
  } = route.params;
  const [data, setData] = useState(null),
    [moves, setMoves] = useState([]),
    [before, setBefore] = useState(null),
    [tab, setTab] = useState('stock'),
    [search, setSearch] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, b] = await Promise.all([getEquipmentStock(school.id), getEquipmentMovements(school.id)]);
      setData(a);
      setMoves(b.movements);
      setBefore(b.next_before);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [school.id]);
  useFocusEffect(useCallback(() => {
    load();
  }, [load]));
  const more = async () => {
    try {
      setLoading(true);
      const b = await getEquipmentMovements(school.id, before);
      setMoves(old => [...old, ...b.movements]);
      setBefore(b.next_before);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  return <View style={ms.screen}><Header title="See stock" sub={school.name} onBack={() => navigation.goBack()} /><ScrollView contentContainerStyle={{
      padding: 18
    }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}><Chips value={tab} onChange={setTab} options={[{
        id: 'stock',
        name: 'Current stock'
      }, {
        id: 'activity',
        name: 'Activity'
      }]} /><ErrorBox message={error} onRetry={load} />{tab === 'stock' ? <><Notice>Physical count includes damaged items. Usable = physical count − damaged. We use the latest count for each item and size, never add months together.</Notice><TextInput value={search} onChangeText={setSearch} placeholder="Find an item or size" placeholderTextColor={colors.iconMuted} style={ms.input} />{data?.not_counted_yet && <View style={ms.empty}><Ionicons name="cube-outline" size={46} color={colors.primary} /><Text style={ms.title}>Not counted yet</Text><Text style={ms.meta}>No stock record exists for this school. This is not the same as zero stock.</Text><Button label="Record received items" onPress={() => navigation.navigate('EquipmentAction', {
            school,
            kind: 'receipt'
          })} /><Text style={ms.meta}>For opening physical counts, use School Inventory on the web. Do not enter existing stock as a new delivery.</Text></View>}{(data?.stock || []).filter(r => rowLabel(r).toLowerCase().includes(search.toLowerCase())).map(r => <View key={r.variant_id} style={ms.card}><Text style={ms.title}>{rowLabel(r)}</Text><Text style={ms.meta}>Physical count {r.quantity} · latest record: {r.month} {r.year}</Text><View style={[ms.row, {
            marginVertical: 16
          }]}><Count label="Usable" value={r.usable} color={colors.success} /><Count label="Damaged" value={r.damaged} color={colors.error} /><Count label="Missing" value={r.missing || 0} color={colors.meta} /></View>{r.pending_missing > 0 && <Text style={ms.meta}>{r.pending_missing} reported missing · waiting for approval</Text>}{r.count_issue && <Text style={{
            color: colors.error
          }}>Count needs correcting on web: damaged exceeds physical count.</Text>}</View>)}{!!data?.stock?.length && <Text style={ms.meta}>Missing shows confirmed losses recorded here (all time). Missing items are not in the physical count. Loans temporarily reduce the school count.</Text>}</> : <>{!loading && !moves.length && <Text style={ms.body}>No equipment activity yet.</Text>}{moves.map(m => <View style={ms.card} key={m.id}><Text style={ms.title}>{labels[m.movement_type] || m.movement_type} · {m.quantity}</Text><Text style={ms.body}>{rowLabel(m)}</Text><Text style={ms.meta}>{m.recipient_name ? `${m.recipient_type}: ${m.recipient_name}\n` : ''}{m.status === 'posted' ? 'Confirmed' : m.status === 'pending' ? 'Waiting for SSGM → Admin' : m.status === 'needs_review' ? 'Approved, but stock needs checking' : 'Not approved'}{m.returned_damaged ? ` · ${m.returned_damaged} returned damaged` : ''}</Text>{m.after_quantity !== null && <Text style={ms.meta}>Physical count {m.before_quantity} → {m.after_quantity} · Damaged {m.before_damaged} → {m.after_damaged}</Text>}{!!m.note && <Text style={ms.body}>{m.note}</Text>}<Text style={ms.meta}>{m.user_name} · {dateLabel(m.created_at)}</Text>{m.status === 'needs_review' && <Button secondary label="Recheck stock and apply" onPress={async () => {
            try {
              await retryEquipmentMissing(m.id);
              load();
            } catch (e) {
              Alert.alert('Could not recheck', e.message);
            }
          }} />}</View>)}{!!before && <Button secondary disabled={loading} label="Load earlier activity" onPress={more} />}</>}</ScrollView></View>;
}
export function EquipmentRequestsScreen({
  navigation,
  route
}) {
  const {
    school
  } = route.params;
  const [orders, setOrders] = useState([]),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOrders(await getEquipmentRequests(school.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [school.id]);
  useFocusEffect(useCallback(() => {
    load();
  }, [load]));
  return <View style={ms.screen}><Header title="Request more" sub={school.name} onBack={() => navigation.goBack()} /><ScrollView contentContainerStyle={{
      padding: 18
    }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}><Button icon="add-circle-outline" label="New request" onPress={() => navigation.navigate('EquipmentAction', {
        school,
        kind: 'request'
      })} /><Notice>Requested → SSGM checked → Admin approved → Received. Stock changes only when the head coach confirms receipt. Pull to refresh web approvals.</Notice><ErrorBox message={error} onRetry={load} />{!loading && !error && !orders.length && <Text style={ms.body}>No requests yet.</Text>}{orders.map(o => <View style={ms.card} key={o.id}><Text style={ms.title}>{o.sku_name}{o.size ? ` · ${o.size}` : ''}</Text><Text style={ms.body}>{o.qty > 0 ? `${o.qty} items requested` : 'Photo-only request (legacy)'} · {o.status}</Text><Text style={ms.meta}>Request #{o.id} · {dateLabel(o.created_at)}</Text><Timeline order={o} />{!!o.image_path && <Pressable accessibilityLabel="View reference photo" onPress={() => setPreview(fileUrl(o.image_path))}><Image source={{
            uri: fileUrl(o.image_path)
          }} resizeMode="contain" style={{
            width: '100%',
            height: 180,
            borderRadius: 14,
            marginTop: 12
          }} /></Pressable>}{!o.missing_movement_id && o.approve_ssgm === 1 && o.approve_admin === 1 && o.remaining_qty > 0 && <View style={{
          marginTop: 14
        }}><Button label="Confirm items received" onPress={() => navigation.navigate('EquipmentAction', {
            school,
            kind: 'receipt',
            order: o
          })} /></View>}{o.missing_movement_id && <Text style={ms.meta}>Missing-item approval only. This is not a purchase request.</Text>}</View>)}</ScrollView><Modal visible={!!preview} animationType="slide" onRequestClose={() => setPreview(null)}><View style={{
        flex: 1,
        backgroundColor: '#000'
      }}><Header title="Reference photo" onBack={() => setPreview(null)} />{!!preview && <Image source={{
          uri: preview
        }} resizeMode="contain" style={{
          flex: 1,
          width: '100%'
        }} />}</View></Modal></View>;
}
export function EquipmentActionScreen({
  navigation,
  route
}) {
  const {
    school,
    order
  } = route.params;
  const {
    user
  } = useAuth();
  const initial = route.params.kind;
  const [kind, setKind] = useState(initial),
    [step, setStep] = useState(0),
    [stock, setStock] = useState([]),
    [loans, setLoans] = useState([]),
    [orders, setOrders] = useState([]),
    [people, setPeople] = useState({
      students: [],
      teams: [],
      coaches: []
    }),
    [selected, setSelected] = useState(null),
    [isNew, setIsNew] = useState(false),
    [name, setName] = useState(order?.sku_name || ''),
    [size, setSize] = useState(order?.size || ''),
    [qty, setQty] = useState('1'),
    [damaged, setDamaged] = useState('0'),
    [recipientType, setRecipientType] = useState('student'),
    [recipientId, setRecipientId] = useState(null),
    [loan, setLoan] = useState(null),
    [lossSource, setLossSource] = useState('school'),
    [linked, setLinked] = useState(order || null),
    [note, setNote] = useState(''),
    [photo, setPhoto] = useState(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const retryKey = useRef(token()),
    busy = useRef(false),
    lastPayload = useRef(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, b, c, d] = await Promise.all([getEquipmentStock(school.id), getEquipmentLoans(school.id), getEquipmentRecipients(school.id), getEquipmentRequests(school.id)]);
      setStock(a.stock);
      setLoans(b);
      setPeople(c);
      setOrders(d.filter(o => !o.missing_movement_id && o.approve_ssgm === 1 && o.approve_admin === 1 && o.remaining_qty > 0));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [school.id]);
  useEffect(() => {
    load();
  }, [load]);
  const useStock = r => {
    setSelected(r);
    setName(r.equipment_name);
    setSize(r.size || '');
  };
  const chooseKind = k => {
    setKind(k);
    setSelected(null);
    setLoan(null);
    setName('');
    setSize('');
    setLinked(null);
    setQty('1');
    setDamaged('0');
    setStep(0);
  };
  const who = (people[recipientType === 'student' ? 'students' : recipientType === 'team' ? 'teams' : 'coaches'] || []).find(p => p.id === recipientId);
  const pickPhoto = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return Alert.alert('Photos access needed', 'Allow photo access to attach an equipment photo.');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: .75
      });
      if (!result.canceled) setPhoto(result.assets[0]);
    } catch (e) {
      Alert.alert('Could not choose photo', e.message);
    }
  };
  const validate = () => {
    if (kind === 'return' || kind === 'missing' && lossSource === 'loan') {
      if (!loan) return 'Choose an outstanding loan';
    } else if (!name.trim()) return 'Choose or name an item';
    if (!goodInt(qty)) return 'Enter a whole quantity greater than zero';
    if (kind === 'return' && (!/^\d+$/.test(damaged) || Number(damaged) > Number(qty))) return 'Damaged returns must be between zero and the returned quantity';
    if (kind === 'issue' && !who) return 'Choose who is taking the equipment';
    if (['issue', 'damage', 'missing'].includes(kind) && !(kind === 'missing' && lossSource === 'loan') && !selected) return 'Choose an item already in stock';
    if (['issue', 'damage', 'missing'].includes(kind) && !(kind === 'missing' && lossSource === 'loan') && Number(qty) > selected.usable) return `Only ${selected.usable} usable items available`;
    if ((kind === 'return' || kind === 'missing' && lossSource === 'loan') && Number(qty) > Number(loan.outstanding)) return 'Return exceeds the outstanding quantity';
    if (linked && kind === 'receipt' && Number(qty) > Number(linked.remaining_qty)) return 'Received quantity exceeds the remaining request';
    return '';
  };
  const next = () => {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setStep(1);
  };
  const save = async () => {
    if (busy.current) return;
    const message = validate();
    if (message) {
      setStep(0);
      setError(message);
      return;
    }
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      let payload;
      if (kind === 'request') payload = {
        school_id: school.id,
        items: [{
          sku_name: name.trim(),
          size: size.trim(),
          qty: Number(qty)
        }]
      };else payload = {
        school_id: school.id,
        movement_type: kind,
        equipment_name: name.trim(),
        size: size.trim(),
        quantity: Number(qty),
        note: note.trim(),
        ...(kind === 'issue' ? {
          recipient_type: recipientType,
          recipient_id: recipientId
        } : {}),
        ...(kind === 'return' ? {
          linked_issue_id: loan.id,
          returned_damaged: Number(damaged)
        } : {}),
        ...(kind === 'missing' && lossSource === 'loan' ? {
          linked_issue_id: loan.id
        } : {}),
        ...(kind === 'receipt' && linked ? {
          linked_order_id: linked.id
        } : {})
      };
      const fingerprint = JSON.stringify({
        payload,
        photo: kind === 'request' ? photo?.uri : null
      });
      if (lastPayload.current && lastPayload.current !== fingerprint) retryKey.current = token();
      lastPayload.current = fingerprint;
      payload.idempotency_key = retryKey.current;
      if (kind === 'request') await requestEquipment(payload, photo);else await saveEquipmentMovement(payload);
      navigation.goBack();
      Alert.alert(kind === 'missing' || kind === 'request' ? 'Request recorded' : 'Stock updated', kind === 'missing' ? lossSource === 'loan' ? 'The loan closes only after SSGM and Admin approve. School stock is not deducted again.' : 'Missing items will be deducted only after SSGM and Admin approve.' : kind === 'request' ? 'Follow approval progress in Request more.' : 'Your school stock and the web inventory are in sync.');
    } catch (e) {
      setError(e.message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const setOrder = o => {
    if (!o || o.id === 0) {
      setLinked(null);
      setName('');
      setSize('');
      setSelected(null);
      return;
    }
    const found = orders.find(x => x.id === o.id) || order;
    setLinked(found);
    setName(found.sku_name);
    setSize(found.size || '');
    setQty(String(found.remaining_qty));
  };
  return <View style={ms.screen}><Header title={labels[initial] || 'Equipment'} sub={school.name} onBack={() => {
      if (!saving) step ? setStep(0) : navigation.goBack();
    }} /><KeyboardAvoidingView style={{
      flex: 1
    }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{
        padding: 18
      }}><View style={ms.row}>{[0, 1].map(n => <View key={n} style={[ms.step, step >= n && ms.stepOn]} />)}</View><Text style={[ms.title, {
          marginVertical: 16
        }]}>{step === 0 ? '1 · Tell us what happened' : '2 · Check and confirm'}</Text>{loading && <ActivityIndicator color={colors.primary} />}<ErrorBox message={error} onRetry={loading ? null : load} />{!loading && step === 0 ? <>
 {initial === 'issue' && <Chips value={kind} onChange={chooseKind} options={[{
            id: 'issue',
            name: 'Give out'
          }, {
            id: 'return',
            name: 'Return'
          }]} />}{initial === 'damage' && <Chips value={kind} onChange={chooseKind} options={[{
            id: 'damage',
            name: 'Damaged'
          }, {
            id: 'missing',
            name: 'Missing'
          }]} />}
 {kind === 'receipt' && <><Dropdown label="What delivery is this?" value={linked?.id || 0} options={[{
              id: 0,
              name: 'Other receipt · not linked to a request'
            }, ...orders.map(o => ({
              id: o.id,
              name: `#${o.id} · ${o.sku_name} · ${o.remaining_qty} still due`
            }))]} onSelect={setOrder} /><Notice>Record new arrivals only. Opening counts or stock corrections belong in School Inventory on the web.</Notice></>}
 {kind === 'missing' && <><Text style={ms.label}>Where are the missing items?</Text><Chips value={lossSource} onChange={v => {
              setLossSource(v);
              setSelected(null);
              setLoan(null);
              setName('');
              setSize('');
              setQty('1');
            }} options={[{
              id: 'school',
              name: 'School stock'
            }, {
              id: 'loan',
              name: 'An outstanding loan'
            }]} /></>}
 {kind === 'return' || kind === 'missing' && lossSource === 'loan' ? <><Dropdown label={kind === 'return' ? 'Who is returning equipment?' : 'Which loan is missing?'} value={loan?.id} options={loans.map(l => ({
              id: l.id,
              name: `${l.recipient_name} · ${rowLabel(l)} · ${l.outstanding} out`
            }))} onSelect={r => {
              const l = loans.find(x => x.id === r.id);
              setLoan(l);
              setName(l.equipment_name);
              setSize(l.size || '');
              setQty(String(l.outstanding));
            }} />{!loans.length && <Notice>No outstanding loans for this school. Record a Give out first.</Notice>}</> : linked && kind === 'receipt' ? <Notice>{name}{size ? ` · ${size}` : ''} · {linked.remaining_qty} still expected</Notice> : <>
 {['request', 'receipt'].includes(kind) && <Chips value={isNew ? 'new' : 'existing'} onChange={v => {
              setIsNew(v === 'new');
              setSelected(null);
              setName('');
              setSize('');
            }} options={[{
              id: 'existing',
              name: 'Choose an item'
            }, {
              id: 'new',
              name: 'New item'
            }]} />}
 {isNew && ['request', 'receipt'].includes(kind) ? <><Field label="Item name" value={name} onChange={setName} placeholder="For example, Football" /><Field label="Size (optional)" value={size} onChange={setSize} placeholder="For example, Size 5" /></> : <><Dropdown label="Item and size" value={selected?.variant_id} options={stock.map(r => ({
                id: r.variant_id,
                name: `${rowLabel(r)} · ${r.usable} usable`
              }))} onSelect={r => useStock(stock.find(x => x.variant_id === r.id))} />{!stock.length && <Notice>Not counted yet.{['receipt', 'request'].includes(kind) ? ' Choose New item to continue.' : ' Add a physical count in School Inventory on the web first.'}</Notice>}</>}
 </>}
 <Counter label={kind === 'request' ? 'How many do you need?' : kind === 'return' ? 'How many came back?' : 'How many items?'} value={qty} onChange={setQty} />{kind === 'return' && <Counter label="Of these, how many are damaged?" min={0} max={Number(qty) || 0} value={damaged} onChange={setDamaged} />}
 {kind === 'issue' && <><Text style={ms.label}>Give to</Text><Chips value={recipientType} onChange={t => {
              setRecipientType(t);
              setRecipientId(null);
            }} options={[{
              id: 'student',
              name: 'Student'
            }, {
              id: 'team',
              name: 'Team'
            }, {
              id: 'coach',
              name: 'Coach'
            }]} /><Dropdown label={`Choose ${recipientType}`} value={recipientId} options={people[recipientType === 'student' ? 'students' : recipientType === 'team' ? 'teams' : 'coaches'] || []} onSelect={p => setRecipientId(p.id)} /></>}
 {kind !== 'request' && <Field label="Anything else? (optional)" value={note} onChange={setNote} placeholder="Add a short note" multiline />}{kind === 'request' && <View style={{
            marginTop: 16
          }}><Button secondary icon="camera-outline" label={photo ? 'Change reference photo' : 'Add a reference photo (optional)'} onPress={pickPhoto} />{photo && <View style={{
              marginTop: 12
            }}><Image source={{
                uri: photo.uri
              }} style={ms.thumb} /><Button secondary label="Remove photo" onPress={() => setPhoto(null)} /></View>}</View>}
 <Notice>{kind === 'missing' ? lossSource === 'loan' ? 'The missing loan closes after SSGM and Admin approve. School stock is not deducted again.' : 'Stock stays unchanged until SSGM and Admin approve.' : kind === 'damage' ? 'Physical count stays the same. Damaged items move out of Usable.' : kind === 'issue' ? 'The school count goes down. The loan stays open until the items are returned.' : kind === 'return' ? 'Returned items go back into the school count. Damaged returns are not usable.' : kind === 'request' ? 'Your request goes to SSGM, then Admin. It does not change stock yet.' : 'The head coach confirms this receipt immediately. Stock increases once.'}</Notice><Button label="Review" disabled={loading} onPress={next} />
 </> : !loading && <><View style={ms.card}><Text style={ms.title}>{labels[kind]}</Text><Text style={ms.body}>{name}{size ? ` · ${size}` : ''}</Text><Text style={ms.body}>Quantity: {qty}</Text>{kind === 'return' && <Text style={ms.body}>Damaged on return: {damaged}</Text>}{kind === 'issue' && <Text style={ms.body}>Give to: {who?.name} ({recipientType})</Text>}{kind === 'return' && <Text style={ms.body}>Returned by: {loan?.recipient_name}</Text>}{kind === 'missing' && lossSource === 'loan' && <Text style={ms.body}>Missing from loan to: {loan?.recipient_name} ? no double deduction</Text>}{linked && kind === 'receipt' && <Text style={ms.body}>Request #{linked.id}</Text>}{!!note && kind !== 'request' && <Text style={ms.body}>{note}</Text>}{kind === 'request' && photo && <Image source={{
              uri: photo.uri
            }} style={[ms.thumb, {
              marginTop: 12
            }]} />}<Text style={[ms.meta, {
              marginTop: 16
            }]}>{school.name}{'\n'}Recorded by {user?.name || 'you'}{'\n'}{dateLabel(new Date())}</Text></View><Notice>{kind === 'missing' || kind === 'request' ? 'This needs SSGM → Admin approval.' : kind === 'damage' ? 'This confirms the damage immediately.' : 'Check carefully. This updates shared school stock.'}</Notice><Button disabled={saving} label={saving ? 'Saving…' : kind === 'missing' || kind === 'request' ? 'Confirm request' : 'Confirm stock update'} onPress={save} /><View style={{
            height: 12
          }} /><Button secondary disabled={saving} label="Edit details" onPress={() => setStep(0)} /></>}
 <View style={{
          height: 20
        }} /></ScrollView></KeyboardAvoidingView></View>;
}
