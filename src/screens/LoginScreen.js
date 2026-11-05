import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { colors, themed } from '../theme/colors';
import { login } from '../api';

const validateEmail = (v) => {
  if (!v.trim()) return 'E-mail is required';
  if (/\s/.test(v)) return 'No spaces allowed';
  if (!/.+@.+\..+/.test(v)) return 'E-mail must be valid';
  return '';
};
const validatePassword = (v) => {
  if (!v) return 'Password is required';
  if (v !== v.trim()) return 'No spaces at start/end';
  if (v.length < 6) return 'Minimum 6 characters required';
  return '';
};

export default function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    const e = { email: validateEmail(email), password: validatePassword(password) };
    setErrors(e);
    setApiError('');
    if (e.email || e.password) return;
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      onLoggedIn?.(user);
    } catch (err) {
      setApiError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={styles.hero}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} />
          <Text style={styles.brand}>MQ Coach</Text>
          <Text style={styles.tagline}>Coach. Track. Grow.</Text>
          <View style={styles.accentBar} />
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to continue coaching and tracking progress.</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, errors.email && styles.inputError]}
            placeholder="name@academy.edu"
            placeholderTextColor={colors.muted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          {!!errors.email && <Text style={styles.fieldError}>{errors.email}</Text>}

          <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
          <View style={[styles.input, styles.row, errors.password && styles.inputError]}>
            <TextInput
              style={styles.passInput}
              placeholder="Enter your password"
              placeholderTextColor={colors.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              autoCapitalize="none"
              textContentType="password"
              onSubmitEditing={handleSubmit}
            />
            <Pressable onPress={() => setShowPass((s) => !s)} hitSlop={10}>
              <Text style={styles.toggle}>{showPass ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>
          {!!errors.password && <Text style={styles.fieldError}>{errors.password}</Text>}

          <Pressable style={styles.forgot}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.primaryDark }, loading && { opacity: 0.7 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log In</Text>}
          </Pressable>

          {!!apiError && (
            <View style={styles.alert}><Text style={styles.alertText}>{apiError}</Text></View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = themed(() => ({
  flex: { flex: 1, backgroundColor: colors.navy },
  scroll: { flexGrow: 1 },
  hero: { alignItems: 'center', paddingTop: 90, paddingBottom: 48 },
  logo: { width: 72, height: 72, borderRadius: 16, marginBottom: 12 },
  brand: { color: colors.heading, fontSize: 36, fontWeight: '800' },
  tagline: { color: colors.primary, fontSize: 16, fontWeight: '600', marginTop: 4 },
  accentBar: { width: 80, height: 3, backgroundColor: colors.primary, borderRadius: 2, marginTop: 14 },
  card: { flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingTop: 32 },
  title: { fontSize: 26, fontWeight: '800', color: colors.navy },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 6, marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, height: 52, fontSize: 15, color: colors.text, backgroundColor: colors.inputBg },
  inputError: { borderColor: colors.error },
  row: { flexDirection: 'row', alignItems: 'center' },
  passInput: { flex: 1, fontSize: 15, color: colors.text, height: '100%' },
  toggle: { color: colors.muted, fontWeight: '600' },
  fieldError: { color: colors.error, fontSize: 12, marginTop: 6 },
  forgot: { alignSelf: 'flex-end', marginTop: 12, marginBottom: 24 },
  forgotText: { color: colors.primary, fontWeight: '600' },
  button: { backgroundColor: colors.primary, height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  alert: { marginTop: 16, backgroundColor: colors.errorBg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#fecaca' },
  alertText: { color: colors.error, fontWeight: '700', fontSize: 13 },
}));

